# Disposable worktree containers: recreate on demand, retire the host-checkout remnants

## Introduction

After [workspace containers](../features/2026-07-04_workspace-containers.md) (Phase 1), a worktree is
a **branch ref in the bare origin** plus a **container** that clones that branch into `/workspace`
over qits' in-process JGit HTTP server and pushes back the same way. There is no persistent host
working tree — the transport model people expect ("the container clones and pushes itself") is
already in place. What is *not* in place is the lifecycle robustness that makes that model actually
hold up: today the **container is treated as the source of truth for whether a worktree exists**, but
containers are disposable and vanish for mundane reasons — so a worktree "dies" while its real work
(the branch) is sitting safe in the durable origin. This feature makes the container a **recreatable
derivative of the durable branch**: losing it becomes a non-event, and the last host-checkout
assumptions in the code are removed. It also **renames the concept from "worktree" to "workspace"**
(§G) — a git worktree is a host checkout, which this model no longer has, so the name has become
actively misleading.

Related / dependent plans:

- **Builds on Phase 1 — [workspace-containers](../features/2026-07-04_workspace-containers.md)**: the
  `docker run` + clone-from-`/git` lifecycle, `Worktree.branch` as a stored column, and the
  container-label reconciliation this reworks.
- **Phase 2 — [container-file-access](../features/2026-07-04_container-file-access.md)** and
  **Phase 3 — [container-agent-sessions](../features/2026-07-04_container-agent-sessions.md)** both
  assume a running container; every one of their entry points inherits the "container missing → hard
  fail" problem this fixes.
- Reworks the reconciliation added over
  [repository-discovery](../features/2026-05-01_repository-discovery.md) and the worktree lifecycle
  from [worktree-history](../features/2026-06-30_worktree-history.md) (ACTIVE/ABANDONED semantics).
- Touches the launch precondition in the [command registry](../features/2026-06-30_command-registry.md)
  (`CommandService.prepare`'s "Worktree container is not running" 400).

## What is already achieved (so we don't re-litigate it)

- **No persistent host working tree.** `WorktreeService.worktreePathForBranch` / `findWorktreePathForBranch`
  return empty by design; branches have no host checkout.
- **The container clones and pushes itself over HTTP** (`http://<git-host>:<port>/git/<repoId>`,
  JGit smart-HTTP — not SSH). Verified end-to-end: a container commit pushes back through receive-pack
  and shows up origin-side.
- **The host keeps only the bare origin** (`<data>/<repoId>/origin`, `--mirror`) as the durable ref
  store, plus **ephemeral throwaway worktrees** created and deleted per merge/integration op.

So the remaining work is lifecycle + cleanup, not transport.

## The problems

### 1. Container loss = worktree death (the big one)

`RepositoryDiscoveryService.discover` reconciles DB worktree rows against **live containers** (by
`qits.*` labels). An ACTIVE row whose container is absent is marked **ABANDONED** — one-way, no
recovery — *even though the branch ref still exists in the durable origin*. Containers disappear for
routine reasons this doesn't distinguish from real deletion:

- Docker Desktop / daemon restart, host reboot without a restart policy, `docker system prune`, a
  stray `docker rm`.
- A container that **never came up** because `docker run`/clone failed (e.g. the WSL2 + Docker-Desktop
  `git-host` reachability trap — `host.docker.internal` unreachable from the container). The worktree
  row lands ACTIVE-but-container-less and gets abandoned on the next reconcile.

The branch — the actual work, minus unpushed commits — is safe the whole time. qits throws the
worktree away anyway.

### 2. No recreate path — not even for the main worktree

`createMainWorktree` runs **only** on clone (`RepositoryService`), and `createWorktree` always does
`git branch <new> <parent>` (it can't re-materialize an *existing* branch). Once a container is gone
there is no supported way to bring the worktree back. This is what makes the repo-level **"Configure
with Claude"** dead-end: it launches in the main worktree, and when that container is gone the launch
hits `CommandService.prepare`'s `BadRequestException("Worktree container is not running")`.

### 3. The failure is invisible in the UI

The frontend mutations swallow it: `repository-detail`'s `agentMutation` throws
`'No worktree backs branch <main>'` when no worktree is found, and neither that nor the backend 400
surfaces a toast — the button just **silently does nothing**. (This is the symptom that reads as "the
feature is broken" when the real cause is "there is no container to run in.")

### 4. Vestigial host-checkout code

Several call sites still probe `Path.of(dataDir, repoId, "worktrees", worktreeId)` — a host checkout
that no longer exists — as a dead or latent-buggy fallback:

- `agent/control/PromptRefinementService.java` (branch lookup)
- `repository/control/CommitService.java` (two sites — commit/diff reads)
- `daemon/control/DaemonSupervisor.java` (daemon cwd)
- `repository/control/ResolveConflictService.java`

(`WorktreeService`'s `.tmp-merge-…` under the same dir is legitimate — an ephemeral host merge tree,
not a worktree checkout.) These should read through the container (`docker exec`, per Phase 2) or the
bare origin, and the dead fallbacks removed.

### 5. Unpushed work is silently ephemeral

Because `/workspace` lives only in the container, **commits not yet pushed to origin die with the
container**. The `canCleanupBranch` "fully pushed" invariant guards *cleanup*, but nothing guards
*unexpected* container loss. If we make containers freely recreatable, we must be explicit that
recreation restores origin state and that unpushed commits are lost — and ideally protect them.

## Proposed design

The through-line: **the durable branch is the source of truth; the container is a cache of it,
provisioned on demand.**

### A. `ensureContainer(repoId, worktreeId)` — idempotent provisioning

A single operation that guarantees a running container for a worktree whose branch still exists:

- If the container is running → no-op.
- If it's absent → `docker run` + clone the (existing) branch from `/git/<repoId>` + set the
  `qits@local` identity (the `createContainerWorktree` body, generalized to re-materialize an existing
  branch — the `createMainWorktree` "no branch-create" path).
- If the **branch ref is gone** from origin → the worktree is genuinely dead; *this* is when it
  becomes ABANDONED.

Call it **lazily** at every point that needs the container — `CommandService.prepare`, the agent
launch, the file browser, worktree-local git verbs — so the container-missing 400 turns into a
transparent re-provision. Call it **eagerly** during reconciliation (below) and optionally on a
"start worktree" UI action.

### B. Reconciliation keys off the branch, not the container

`RepositoryDiscoveryService.discover` stops abandoning on missing container. New rule per ACTIVE row:

| branch ref in origin? | container? | action |
|---|---|---|
| yes | yes | healthy (upsert labels, as today) |
| yes | no | **re-provision** via `ensureContainer` (or mark `PROVISIONING`/`STOPPED` for lazy recreate) |
| no | — | ABANDONED (the only path to abandonment) |

Reconciliation should not block startup on a slow fleet of `docker run`s — prefer marking rows
`STOPPED`/`PROVISIONING` and letting lazy `ensureContainer` (or a background provisioner) bring them
up, so the abandonment decision is purely "does the branch still exist."

### C. Surface container state in the UI (no more silent no-op)

- Add a worktree **container/runtime status** (`RUNNING` / `STOPPED` / `PROVISIONING` / `FAILED`) to
  `WorktreeDto`, distinct from the lifecycle `WorktreeStatus`.
- The frontend shows it, offers a **"Start / recreate container"** action (calls `ensureContainer`),
  and — minimally, independently — **surfaces the launch error** instead of swallowing it, so a failed
  provision (e.g. git-host unreachable) tells the user *why*.
- The repo-level "Configure with Claude" first ensures the main worktree's container (via A), so it
  stops dead-ending.

### D. Protect unpushed work so recreation is lossless

Recreating from origin restores only pushed state. To make container loss a true non-event:

- **Auto-push on graceful stop / discard** (extend the existing "fully pushed" logic), and/or a
  **periodic checkpoint push** of the container's branch to origin so an unexpected death loses at most
  the last interval.
- At minimum, **document** that unpushed container commits are ephemeral and have `ensureContainer`
  never silently overwrite a *live* container's unpushed work (it only creates when absent).

### E. Retire the vestigial host-checkout code

Remove the dead `worktrees/<id>` host-path probes in §4, routing each through the container or the
bare origin. This is the concrete "filesystem worktrees are redundant" cleanup — after it, no product
code assumes a host checkout exists.

### F. (Optional, related) Containerize `PromptRefinementService`

It's the last thing that runs `claude` on the **host** (via `ProcessExecutor`, neutral cwd, host
auth). It's out of the sandbox by design today; folding it into the worktree container would make
"all agent execution is containerized" literally true, at the cost of a container round-trip for a
pure text-rewrite. List as a follow-up, not a blocker.

### G. Rename **worktree → workspace** (the whole concept)

"Worktree" is now actively misleading: it's a git term for a host checkout, and there is no host
checkout. The thing is a branch's **isolated working environment** — which the infrastructure already
calls a *workspace*: the clone mounts at `/workspace`, the config namespace is `qits.workspace.*`, the
image is `qits/workspace`. Renaming the domain concept to **workspace** makes the entity match the
substrate. (Rejected: **container** — the domain deliberately abstracts the runtime via
`ContainerRuntime` for podman/remote later, so naming the entity after docker leaks the implementation.)

This is a broad, mostly-mechanical rename; do it as one focused pass, ideally alongside this feature
since the lifecycle code is being rewritten here anyway:

- **Domain**: `Worktree` → `Workspace`, and `WorktreeService` / `WorktreeRepository` / `WorktreeDto` /
  `WorktreeMapper` / `WorktreeMetadata` / `WorktreeStatus` / `WorktreeEvent(Type)` → `Workspace*`.
  Method and variable names (`worktreeId` → `workspaceId`, `createWorktree` → `createWorkspace`, …).
- **Persistence / DB**: Flyway migration renaming tables `worktree` / `worktree_event` →
  `workspace` / `workspace_event` (and any FK/column references) via `ALTER TABLE … RENAME` — H2
  everywhere, so a rename migration is clean and lossless.
- **REST (breaking)**: `/repositories/{repoId}/worktrees/{worktreeId}` → `…/workspaces/{workspaceId}`.
  Regenerate `openapi.yml` and the Angular client (`pnpm generate:api`).
- **Container labels & names (coordinate with §A/§B)**: `qits.worktree` label → `qits.workspace`,
  name prefix `qits-wt-` → `qits-ws-`. Because this feature already makes containers disposable and
  recreatable, the cleanest migration is to **recreate** on first reconcile after the rename; a
  back-compat read of the old `qits.worktree` label during one transitional release avoids a forced
  recreate. Note the pre-existing `qits.workspace.*` **config** keys are unaffected and now read
  consistently (they configure workspaces).
- **MCP tools (breaking)**: `listWorktrees` / `listWorktreePath` etc. → `listWorkspaces` …; update the
  read-only allowlists in `AgentLaunchService`.
- **Frontend**: routes (`/worktrees/:worktreeId` → `/workspaces/:workspaceId`), components
  (`worktree-chat`, `worktree-file-browser`, `worktree-prompt-panel`, `WorktreeWipPage`,
  `WorktreeDetailPage` → `workspace-*`), query keys, and copy.
- **Docs**: this file, the Phase 1–3 feature docs, `CLAUDE.md`, `AGENTS.md`, `ROUTING.md`.

Sequencing: the rename is orthogonal to the lifecycle logic, so it can land as its own commit
(pure rename, green build) *before or after* §A–§F — but keep it out of the same diff as behavior
changes so the mechanical rename stays reviewable.

## Prerequisites / dependencies

- **`git-host` reachability must be correct and its failures visible.** `ensureContainer` clones over
  HTTP, so on WSL2 + Docker Desktop it needs `qits.workspace.git-host` pointed at a container-reachable
  address (the WSL2 `eth0` IP), not `host.docker.internal`. This is already a documented Phase-1 caveat
  (kept locally in a gitignored `service/.env`); §C's error-surfacing is what makes a misconfiguration
  diagnosable instead of a silent abandon-loop. A nice-to-have: auto-probe container→host reachability
  at startup and warn.

## Open questions

- **Lazy vs. eager provisioning on startup.** Re-cloning every worktree's container at boot could be
  slow for a big fleet; lazy-on-access is cheaper but delays the first command. Probably: reconcile to
  `STOPPED`, provision on first use, offer a manual "start all."
- **Idle-stop policy.** Once recreation is cheap, qits could *stop* idle containers to save resources
  and recreate on demand — turning §A into a general power-management lever (was already deferred in
  Phase 1).
- **Checkpoint-push cadence** (§D) vs. noise in origin refs / the ahead-behind UI.
- Should `ensureContainer` be exposed as its own REST endpoint (explicit "start worktree") or stay an
  internal lazy call only?

## Testing sketch

- **Fake runtime**: abandon-vs-recreate decision table (§B) — branch present + container absent →
  `ensureContainer` called and row stays ACTIVE; branch deleted → ABANDONED. `FakeContainerRuntime`
  already models a container as a host clone, so provisioning is exercisable without docker.
- **Lazy provision**: `CommandService.prepare` with a missing container re-provisions instead of
  throwing; the launch then succeeds.
- **Real-docker IT (extended)**: `docker rm -f` a worktree's container, hit any container-needing
  endpoint, assert the container is back and cloned from origin; assert an unpushed commit made before
  the `rm` is gone (documents §D) while pushed commits survive.
- **Frontend**: the launch/agent mutations surface the error (toast) and the container-status control
  renders + triggers recreate.
- **Cleanup regression**: removing the §4 host-path probes doesn't change commit/diff/daemon behavior
  (they already route through the container/origin).
</content>
