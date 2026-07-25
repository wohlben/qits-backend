# Bidirectional auto-sync — the daemon auto-pushes commits, and pulls host merges on notification

## Introduction

[Daemon-driven working-tree status](2026-07-24_daemon-git-status-monitoring.md) made the
in-container `workspace-daemon` the sole detector of working-tree change: on every commit/edit its
`GitStatusMonitor` recomputes the working-tree marker and reports a `GitStatus{clean, head}`. That
report already _sees every commit_ (a commit moves `.git/index`/`HEAD`/`refs`, which the watch keeps
watched) — but nothing acted on it, and the container's checkout only reconciled with origin
reactively, on the next host git op. This feature closes both gaps by keeping the checkout and its
origin ref in sync **both ways**:

1. **Auto-push (container → origin).** When the daemon observes the branch is ahead of
   `origin/<branch>` — the after-effect of any commit the coding agent or a merge-into-this-workspace
   makes — it pushes right away, so committed work is durable on origin without waiting for a host op.
2. **Incoming pull (origin → container).** When the host runs an integration/merge that advances a
   workspace's branch on origin out-of-band, it sends the daemon a new `PullBranch`; the daemon
   fast-forwards its checkout so it catches up immediately instead of lagging.

Related / dependent plans:

- **Part of [qits-workspace-daemon](../epic.md)** — extends the just-landed
  [daemon-git-status-monitoring](2026-07-24_daemon-git-status-monitoring.md): the auto-push reuses
  that monitor's per-commit `GitStatus` signal as its trigger, and the incoming pull re-uses the
  same in-container git-fork model.
- **Rides the clean-gate of
  [gate-operations-on-dirty-workspace](2026-07-25_gate-operations-on-dirty-workspace.md)** — the host
  only integrates/merges when the operation's workspace is clean, which is what makes an incoming
  pull a safe fast-forward. The residual race (a tree that turns dirty in the window between the
  gate and the daemon's pull) is an **accepted, documented risk** — see below.
- **Precedes [in-container-git-verbs-over-socket](../feature-ideas/in-container-git-verbs-over-socket.md)
  (Part 4)** — that part will move the host's _own_ `docker exec git push/fetch/merge` paths onto
  the socket. Until then host and daemon push the same branch to the same origin concurrently; the
  auto-push's conflict handling is what makes that coexistence safe.

## What was built

### Protocol — a new `PullBranch` (workspace-daemon-protocol)

`PullBranch{correlationId, branch}` — qits → daemon, telling the workspace that _owns_ `branch` to
fast-forward its checkout to origin. Added to `DaemonMessage` permits, `DaemonProtocol.Type.PULL_BRANCH`
(reusing `Field.BRANCH`), and both `DaemonCodec` arms (compiler-forced by the exhaustive switches);
`DaemonMessageCodec` bridges it on the host unchanged. Not a request/reply round-trip — no `Ack` is
expected: the daemon's own `GitStatus` watch re-reports the new `HEAD` once the fast-forward moves
the tree. The auto-push half needs **no** new message — it is daemon-autonomous.

### Daemon — `OriginSync` (workspace-daemon)

A new `OriginSync` owns both directions behind a small package-private `GitRunner` seam (fork `git`
in `/workspace`, stderr merged into stdout so a rejected push's diagnostics are classifiable). It
runs push and pull on **one single-thread scheduler**, so an auto-push and an incoming pull in the
same container never interleave against git.

- **Auto-push trigger.** `ControlSocket` wires the `GitStatusMonitor`'s `send` through a wrapper that
  calls `OriginSync.onWorkingTreeSettled()` on every emitted `GitStatus` — i.e. every marker move,
  which includes every commit. That opens a coalescing window
  (`qits.workspace-daemon.auto-push.coalesce-ms`, default 500ms); when it closes, `pushIfAhead()`
  does a cheap local `git rev-list --count origin/<branch>..HEAD` and pushes only if ahead (a
  content-only edit finds nothing and no-ops). Requires no changes to `GitStatusMonitor` itself.
- **Push conflicts.** The host still pushes the same branch to the same bare origin from several
  paths (`mergeWorkspace`'s pre-integration push, `fastForwardWorkspace`, `updateWorkspaceFromParent`,
  the stop-time `pushBranch`), so two pushes can race on origin's ref lock. `pushWithRetry()`
  classifies a rejected push from its output:
  - **transient** (`cannot lock ref`, `failed to lock`, connection/`hung up`, …) → retried with
    capped exponential backoff (`auto-push.max-attempts` ×, `backoff-initial-ms`…`backoff-max-ms`) —
    the "delay this automatic push" the design calls for;
  - **non-fast-forward** (`fetch first`, `non-fast-forward`, `[rejected]`, `remote rejected`) →
    reconciled with a `git fetch` + `git merge --ff-only` before **one** more push, **never** a
    force; a tree that won't fast-forward is left exactly as-is (`DIVERGED`) for the next host op to
    reconcile;
  - **fatal** → give up this cycle (logged).
- **Incoming pull.** On `PullBranch` the daemon runs `applyIncomingPull(branch)` on the sync thread:
  `git fetch origin <branch>` + `git merge --ff-only origin/<branch>`. It refuses anything but a
  fast-forward — a tree that turned dirty leaves the checkout **intact** (`REFUSED`) rather than
  clobbering it — and validates the branch name (rejecting blank/flag-shaped). Independent of the
  auto-push kill switch.
- **Kill switch + knobs.** `qits.workspace-daemon.auto-push-enabled` (default true) disables only the
  autonomous push; the host injects it as `QITS_WORKSPACE_DAEMON_AUTO_PUSH_ENABLED` from
  `qits.workspace.auto-push.enabled` via `WorkspaceContainerFactory`, mirroring the bootstrap/services
  kill switches. `OriginSync` is created alongside the monitor once the checkout is provisioned and
  closed in `@PreDestroy`.

### Host — the `WorkspaceGitSync` SPI + the merge trigger (domain + service)

- A new framework-free `domain` SPI `WorkspaceGitSync{ pullFromOrigin(workspaceId, branch) }` — the
  inbound complement of `WorkspaceGitStatus`. `WorkspaceDaemonRegistry` implements it (sends a
  `PullBranch` to the live daemon; a **no-op** when none is connected, since the checkout syncs on
  its next host git op — a missed notification never loses data) and gains the defensive
  `case PullBranch ignored -> {}` in its exhaustive `onMessage`.
- `WorkspaceService` injects `Instance<WorkspaceGitSync>` (empty in cli/tests, like `gitStatus`) and,
  after a **clean** `mergeIntoTarget` in both `mergeBranch` (integrate) and `mergeWorkspace`, calls a
  private `notifyIncomingMerge(repoId, resolvedTarget)` — which looks up the workspace that owns the
  target branch (if any) and asks its daemon to pull. Both merge paths funnel their target advance
  through this one helper.

### The accepted race condition

Both the incoming pull and the auto-push's non-ff reconcile are `git merge --ff-only`, which is a
safe fast-forward **only** while the target tree is clean. The host gates integrate/merge on the
workspace being clean, so at operation time it is — but there is a tiny window between that gate (or
the host reading `HEAD`) and the daemon actually running the fast-forward in which the coding agent
or a user could dirty the tree. **This is an accepted risk:** the failure mode is benign — `--ff-only`
simply _refuses_ and the checkout is left exactly as it was (no data loss, no clobber), and the next
host git op (`fastForwardWorkspace` / `updateWorkspaceFromParent`, both of which already run their own
`merge --ff-only origin/<branch>` sync step) reconciles it. A push that races the same way backs off
and retries, or defers to the pull path. No locking spans the host↔daemon boundary to close the
window, by design — the cost (a cross-boundary lock on every commit/merge) is not worth eliminating a
race whose worst outcome is a one-op-delayed sync.

## Testing

- **Protocol** — `DaemonCodecTest` round-trips `PullBranch`.
- **Daemon** — `OriginSyncTest` drives the package-private `pushIfAhead`/`pushWithRetry`/
  `applyIncomingPull` seams with a scripted `GitRunner` (no real repo, 0 backoff): nothing-to-push
  when not ahead, push when ahead / when there's no tracking ref yet, disabled no-ops, non-ff
  reconcile-then-push, non-ff-that-can't-reconcile left as `DIVERGED`, transient retry-then-success
  and retry-exhaustion, fatal stop, and the pull's fast-forward / refuse-on-non-ff /
  refuse-on-fetch-fail / skip-blank / independent-of-the-push-kill-switch cases.
  `GitStatusMonitorTest` is unchanged (the monitor was not touched).
- **Host** — `DaemonControlSocketTest` adds: `pullFromOrigin` sends a `PullBranch{branch}` frame to
  the live daemon, and is a safe no-op with no daemon connected.
- **Domain** — `IncomingMergePullNotificationTest` (real cloned fixture through `FakeContainerRuntime`,
  a `@Mock FakeWorkspaceGitSync` capturing calls): integrating a branch into a workspace-backed target
  fires exactly one `pullFromOrigin(targetWorkspaceId, targetBranch)`; integrating into a branch no
  workspace owns fires none.
