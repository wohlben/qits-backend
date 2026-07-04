# Disposable workspace containers: recreate on demand, retire the host-checkout remnants

## Introduction

Builds on [workspace containers](2026-07-04_workspace-containers.md) (Phase 1). After that phase a
worktree was a **branch ref in the bare origin** plus a **container** that clones the branch into
`/workspace` over qits' in-process JGit HTTP server — but the code still treated the *container* as
the source of truth for whether a worktree existed, so a container lost for a mundane reason (daemon
restart, `docker rm`, a failed `docker run`) got the worktree marked ABANDONED even though the branch
— the real work — was safe in origin. This feature makes the container a **recreatable derivative of
the durable branch**: losing it is a non-event, and the last host-checkout assumptions are removed.

Related / dependent:

- **Phase 1 — [workspace-containers](2026-07-04_workspace-containers.md)**: the `docker run` +
  clone-from-`/git` lifecycle, `Worktree.branch` as a stored column, container-label reconciliation.
- **Phase 2 — [container-file-access](2026-07-04_container-file-access.md)** and **Phase 3 —
  [container-agent-sessions](2026-07-04_container-agent-sessions.md)**: their entry points inherited
  the "container missing → hard fail" problem this fixes (now they lazily re-provision).
- Reworks reconciliation from [repository-discovery](2026-05-01_repository-discovery.md) and the
  ACTIVE/ABANDONED lifecycle from [worktree-history](2026-06-30_worktree-history.md).
- **Deferred follow-up**: the worktree→workspace **rename** (§G of the original idea) is parked as
  [worktree-to-workspace-rename](../backlog-ideas/worktree-to-workspace-rename.md) — kept out of this
  behaviour diff on purpose.

## The through-line

**The durable branch is the source of truth; the container is a cache of it, provisioned on demand.**

## What was implemented

### Runtime status (§C data model)

`WorktreeRuntimeStatus { RUNNING, STOPPED, PROVISIONING, FAILED }`, a persisted `runtime_status`
column (+ `runtime_error`) on `Worktree` (Flyway `V21`), distinct from the lifecycle `WorktreeStatus`.
`WorktreeService.listWorktrees` computes `RUNNING` live from the container listing (one `docker ps`)
and falls back to the persisted value, so the status is accurate even when docker state changed
out-of-band while the `FAILED`/`PROVISIONING` signal survives.

### `ensureContainer(repoId, worktreeId)` (§A)

`WorktreeService.ensureContainer` — idempotent provisioning:

- container already running → stamp `RUNNING`, no-op. A live container is **never** re-cloned over, so
  unpushed `/workspace` commits are safe (the §D guard).
- container absent but the branch ref survives in origin → re-materialize from the branch (the
  existing `createContainerWorktree(…, createBranchRef=false)` path `createMainWorktree` uses).
- branch ref gone from origin → the work no longer exists anywhere: the worktree is ABANDONED here —
  now the **only** path to abandonment — and a 404 is thrown. Each status transition commits in its
  own `QuarkusTransaction.requiringNew()` so a FAILED/ABANDONED outcome persists even though the
  method then throws.

Called lazily at every container entry point: `CommandService.prepare` (replacing the old "container
is not running" 400 — this fixes the "Configure with Claude" dead-end, since every launch funnels
through `prepare`), the file browser (`WorktreeFilesService`), the worktree-local git verbs
(`fastForwardWorktree`, `updateWorktreeFromParent`), and the agent chat sign-in probe.

### Branch-keyed reconciliation (§B)

`RepositoryDiscoveryService.discover` decides ABANDONED-vs-alive purely by whether the branch ref
exists: a container-less-but-live-branch ACTIVE row becomes `STOPPED` (lazy re-provision on next use —
no eager `docker run` at boot), and only a row whose branch is gone from origin is ABANDONED.

### Unpushed-work protection (§D)

- Guard: `ensureContainer` only creates when the container is absent.
- `stopContainer()` — a lossless graceful stop: pushes the branch to origin first (`pushBranch`), then
  removes the container, leaving the worktree ACTIVE/`STOPPED` for lazy recreate.
- `doDiscard` documents that discard is **intentionally** lossy (the branch is deleted right after, so
  there is nothing to preserve).
- Documented below: an *unexpected* container death still loses unpushed commits — recreation restores
  origin state only.

### Retired vestigial host-checkout probes (§E)

The dead `Path.of(dataDir, repoId, "worktrees", worktreeId)` host-checkout probes are gone:
`CommitService` (incoming-commits branch + parent resolution) and `ResolveConflictService` read the
stored `Worktree.branch` column; `DaemonSupervisor` tails log sources **inside the container** via a
new `ContainerTailSource` (`<runtime> exec … tail -F`) instead of a host `FileTailSource` rooted at the
dead path. (The `.tmp-merge-…` ephemeral host merge tree is legitimate and untouched.)

### Containerized prompt refinement (§F)

`PromptRefinementService` now runs `claude` **inside the worktree container**
(`<runtime> exec -w /workspace -e HOME=<claude-mount> … bash -lc <claude>`), reusing the container's
`claude` and the shared credential volume, instead of on the host. It is driven through
`ProcessExecutor` (not `ContainerRuntime.exec`) so stdout/stderr stay separate — the refined prompt is
stdout only — and timeouts still work. Branch context comes from the stored column.

### UI (§C)

Endpoints `POST …/worktrees/{id}/ensure-container` (start/recreate) and `…/stop-container` (graceful
stop), each returning the refreshed `WorktreeDto`. The branch row shows a runtime-status badge (with
the failure reason on hover) and a **Start / Recreate / Stop** control; the repo-level "Configure with
Claude" launch **surfaces its error in a banner** instead of the old silent no-op.

## Deviations from the original idea

- **§C toast → inline banner.** No toaster exists in the app; the launch error is surfaced as an
  inline banner (repository-detail) and a text error line (branch-list) rather than adding a new toast
  dependency. Same outcome — the failure is no longer swallowed.
- **A "Stop" control was added** alongside Start/Recreate, so `stopContainer` (the lossless graceful
  stop) is user-reachable rather than an internal-only lever.
- **`doDiscard` does not auto-push.** The idea listed "auto-push on graceful stop *and discard*"; on
  discard the branch is deleted immediately after, so a push would be pointless — the lossless path is
  `stopContainer`. Discard stays intentionally lossy.
- **§F kept on `ProcessExecutor`.** Rather than route the refinement through `ContainerRuntime.exec`
  (which combines stdout+stderr), it runs the container-exec argv via `ProcessExecutor` to preserve
  stdout/stderr separation and timeout handling.
- **§G rename deferred** to [worktree-to-workspace-rename](../backlog-ideas/worktree-to-workspace-rename.md).

## Loss window (important)

Recreation restores **origin state only**. Commits made in a container but never pushed die with it.
The live-container guard protects the graceful case (`ensureContainer` never re-clones over a running
container) and `stopContainer` pushes before removing, but an *unexpected* container death (host reboot,
`docker rm`, a crash) still loses unpushed commits. A periodic checkpoint-push to bound that window is a
deferred open question.

## Prerequisites (git-host is auto-resolved)

`ensureContainer` clones over HTTP, so the container must be able to reach this app. That address now
**auto-resolves** (`qits.workspace.git-host=auto`, the default — see `GitHostResolver`):
`host.docker.internal` on plain Linux docker (wired via `--add-host=…:host-gateway`), or the WSL2
distro's **eth0 IP** on WSL2 + Docker Desktop, where `host.docker.internal` isn't container-reachable.
So it just works on both with no per-machine override; the old gitignored `service/.env` pin is no
longer needed (and can't go stale across WSL2 restarts). Set an explicit IP/hostname only if the
auto-detection picks the wrong interface (multi-homed host / VPN). §C's error surfacing still makes any
remaining misconfiguration diagnosable instead of a silent abandon-loop.

## Testing

- **Unit (no docker)** — `WorktreeContainerLifecycleServiceTest`: recreate-from-branch, no-op when
  running, ABANDON when the branch is gone, `stopContainer` round-trip, reconcile→STOPPED (not
  ABANDONED), and the §D lossless-stop vs lossy-unexpected-death pair. `RepositoryDiscoveryServiceTest`
  covers the abandon-only-when-branch-gone rule. `CommandServiceTest` covers lazy re-provision in
  `prepare`. `PromptRefinementServiceTest` covers the containerized run. `DaemonSupervisorTest` covers
  the container tail. Because `FakeContainerRuntime` runs **real host git processes**, the clone /
  push / recreate logic is genuinely exercised — only the literal `docker exec` transport is faked.
- **Controller** — `WorktreeControllerTest`: the ensure/stop endpoints round-trip the runtime status.
- **Frontend** — `branch-row.component.spec.ts`: the status badge + Start/Stop/Recreate controls.
- **Real docker (extended)** — two `@Tag("extended")` ITs, opt in with `./mvnw verify -Pextended`
  (both self-skip when docker/the image/reachability is absent):
  - `WorkspaceContainerIT` — the `docker run`/exec/rm + PTY + credential-volume mechanics.
  - `WorkspaceRecreateIT` — the **full end-to-end recreate round-trip** (`@QuarkusIntegrationTest`, so
    the real `DockerExecutor` runs, not the fake): create a repo + worktree over REST, push a commit
    and make an unpushed one through the container, `docker rm -f` it, then `POST …/ensure-container`
    and assert the recreated container is a fresh clone at the **pushed** commit while the **unpushed**
    commit is gone (the §D loss window). It clones/pushes over the real `/git` server; the git-host
    auto-resolves (§ Prerequisites) so it just runs on both Linux and WSL2 with no override, and
    self-skips only if docker/the image is absent or the resolved host still isn't reachable.

  Build the image first: `docker build -t qits/workspace docker/workspace`. Run:
  `./mvnw -pl service verify -Pextended -Dtest=__none__ -Dsurefire.failIfNoSpecifiedTests=false
  -Dit.test=WorkspaceRecreateIT`.
