# Epic: qits-workspaces — workspaces under a repository

## Introduction

The **Workspace domain**: a workspace is a branch ref in a
[repository's](../qits-project-repositories/epic.md) bare origin **plus** a per-workspace Docker
container that clones that branch into `/workspace`. This epic owns the **workspace entity and
its execution model** — container provisioning and lifecycle, history, git identity, the
per-workspace live-update and file-freshness channels, and workspace creation/bootstrap.

Last in the aggregate chain — **builds on
[qits-project-repositories](../qits-project-repositories/epic.md)**
(qits-projects → qits-project-repositories → **this**): a workspace has no meaning without a
repository to branch from and a project to live under.

**Links to [qits-technical-processes](../qits-technical-processes/epic.md)** for **workspace
creation/start**: bringing a workspace up (`docker run` → `git clone` → recursive submodule
materialization → async daemon auto-start) is facilitated through a technical process — it is
that framework's **first instance**
([technical-process-log-stream](../qits-technical-processes/features/2026-07-18_technical-process-log-stream.md)).
The workspace lifecycle is this epic's; its streamed, segment-by-segment framing is that epic's.

Retroactive umbrella epic; future workspace-entity/execution features land here.

**Scope rule** — this epic owns the **workspace entity and its execution/lifecycle mechanics**.
It deliberately does **not** absorb the sub-domains that run *inside* a workspace — each is its
own domain that **builds on** this one and gets (or will get) its own epic:

- **The workspace-detail frontend** — [qits-workspace-detail](../qits-workspace-detail/epic.md)
  (the route, its tabs and tab UI). This epic is the backend/domain those tabs drive.
- **The technical-process framing** of workspace start — carved out as
  [qits-technical-processes](../qits-technical-processes/epic.md) (see the Introduction link):
  the workspace lifecycle is this epic's, its streamed segment-by-segment framing is that epic's.
- **Daemons** — carved out as [qits-workspace-daemons](../qits-workspace-daemons/epic.md)
  (managed long-running processes coupled to workspace lifecycle).
- **The coding agent & chat** — carved out as [qits-coding-agents](../qits-coding-agents/epic.md)
  (harness, stream-json chat, sessions, lineage, LSP plugins).
- **The command execution substrate** — carved out as
  [qits-workspace-commands](../qits-workspace-commands/epic.md) (the registry daemons and agent
  chat run on).
- **Actions & feature-flows** — carved out as [qits-feature-flows](../qits-feature-flows/epic.md)
  (whose actions execute in this epic's containers).
- **Feature intake** — carved out as [qits-feature-intake](../qits-feature-intake/epic.md): the
  `POST /api/capture` receiver branches off main and opens a workspace whose goal carries the
  captured context, *producing* one of this epic's workspaces.
  (Container **file access** and **framework detection** are workspace-core — a section below —
  since they are the workspace container's own read capabilities; only the file-browser *UI*
  that renders them is [qits-workspace-detail](../qits-workspace-detail/epic.md)'s.)
- **Already carved out**: the workspace-detail frontend above,
  [qits-workspace-daemons](../qits-workspace-daemons/epic.md),
  [qits-coding-agents](../qits-coding-agents/epic.md),
  [qits-workspace-commands](../qits-workspace-commands/epic.md),
  [qits-feature-flows](../qits-feature-flows/epic.md),
  [qits-feature-intake](../qits-feature-intake/epic.md),
  [qits-technical-processes](../qits-technical-processes/epic.md), and
  [qits-observability](../qits-observability/epic.md).

## Parts (implemented)

### The workspace entity & its container

- **[worktree-to-workspace-rename](features/2026-07-05_worktree-to-workspace-rename.md)** — the
  domain concept renamed "worktree" → "workspace" (the vocabulary this whole epic uses).
- **[workspace-containers](features/2026-07-04_workspace-containers.md)** — sandboxed
  per-workspace execution: a container that clones the branch and runs `exec` (the execution
  model everything else assumes).
- **[disposable-workspace-containers](features/2026-07-04_disposable-workspace-containers.md)**
  — recreate on demand; retire the persistent host-checkout remnants.
- **[lazy-workspace-container-provisioning](features/2026-07-08_lazy-workspace-container-provisioning.md)**
  — creation writes only the branch ref + `STOPPED` row; the container materializes on first
  use (decouples workspace/repo creation and seeding from Docker + a running service).
- **[workspace-history](features/2026-06-30_workspace-history.md)** — soft-deleted workspaces
  with a resolution state.

### Creation, identity & lifecycle

- **[create-workspace-for-workspaceless-branch](features/2026-07-13_create-workspace-for-workspaceless-branch.md)**
  — adopt an existing branch as a workspace from the repository detail view.
- **[configurable-git-identity](features/2026-07-09_configurable-git-identity.md)** — the git
  identity provided to workspace containers via env.
- **[workspace-bootstrap-commands](features/2026-07-18_workspace-bootstrap-commands.md)** —
  ordered one-shot runs after provisioning.
- **[periodic-checkpoint-push](features/2026-07-05_periodic-checkpoint-push.md)** — every
  interval, each running workspace container's branch is pushed to origin, bounding what an
  unexpected container death can lose to one interval of committed work.

### Files, detection & freshness

- **[container-file-access](features/2026-07-04_container-file-access.md)** — the workspace's
  files are read out of the container through `docker exec` (the read capability the file
  browser and detection sit on).
- **[backend-framework-detection](features/2026-07-12_backend-framework-detection.md)** — a
  per-workspace `/detection` endpoint that detects the checkout's framework(s).
- **[workspace-sse-live-updates](features/2026-07-07_workspace-sse-live-updates.md)** — one
  Server-Sent-Events channel per workspace pushing invalidation hints (replacing the detail
  route's polling; the frontend that consumes it lives in
  [qits-workspace-detail](../qits-workspace-detail/epic.md)).
- **[detection-live-freshness-sse](features/2026-07-12_detection-live-freshness-sse.md)** — a
  per-workspace file watcher pushing working-tree freshness for `/files` and `/detection` over
  SSE: the file-tree/detection-freshness counterpart to the invalidation channel above.

## Done when

Rolling: current when its `feature-ideas/` is empty and every workspace-entity/execution
feature since this epic's creation has landed here. Sub-domains being carved into their own
epics (daemons, commands, coding-agents, …) leave this one as they mature — that is expected,
not scope loss.

## Status

| Part | Status |
|---|---|
| [worktree-to-workspace-rename](features/2026-07-05_worktree-to-workspace-rename.md) | implemented |
| [workspace-containers](features/2026-07-04_workspace-containers.md) | implemented |
| [disposable-workspace-containers](features/2026-07-04_disposable-workspace-containers.md) | implemented |
| [lazy-workspace-container-provisioning](features/2026-07-08_lazy-workspace-container-provisioning.md) | implemented |
| [workspace-history](features/2026-06-30_workspace-history.md) | implemented |
| [create-workspace-for-workspaceless-branch](features/2026-07-13_create-workspace-for-workspaceless-branch.md) | implemented |
| [configurable-git-identity](features/2026-07-09_configurable-git-identity.md) | implemented |
| [workspace-bootstrap-commands](features/2026-07-18_workspace-bootstrap-commands.md) | implemented |
| [periodic-checkpoint-push](features/2026-07-05_periodic-checkpoint-push.md) | implemented |
| [container-file-access](features/2026-07-04_container-file-access.md) | implemented |
| [backend-framework-detection](features/2026-07-12_backend-framework-detection.md) | implemented |
| [workspace-sse-live-updates](features/2026-07-07_workspace-sse-live-updates.md) | implemented |
| [detection-live-freshness-sse](features/2026-07-12_detection-live-freshness-sse.md) | implemented |
