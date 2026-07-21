# Epic: qits-technical-processes — replayable segmented long-running work

## Introduction

The **technical-process abstraction**: a first-class, in-memory, *replayable* unit of
long-running back-office work, streamed to the browser over SSE as **named segments**, each
rendered as its own expander. It replaced the old "run blind" pattern (a static spinner, output
discarded on success, a truncated error on failure) with a live, segment-by-segment view.

This is a **cross-cutting epic**, not part of the projects → repositories → workspaces aggregate
chain: the abstraction is consumed by several domains. "Start a workspace" is its **first
instance**; repository **pull/sync** are the next; the abstraction is designed to also carry
stop, recreate, submodule-import, and action-run later.

Related epics:

- **The "train" pulls link here** —
  [qits-project-repository-submodules](../qits-project-repository-submodules/epic.md): a
  superproject pull recursively pulls every imported submodule sibling, one segment per repo.
  That recursive walk is a repository/submodule concern *rendered as* a technical process; the
  process framing and the streamed walk are this epic's.
- **First instance is workspace start** —
  [qits-workspaces](../qits-workspaces/epic.md): the
  workspace-start orchestration (`docker run` → `git clone` → recursive submodule
  materialization → async daemon auto-start) is what the abstraction was born for.
- **Driven by** [streaming-gitexecutor-exec](../qits-project-repositories/features/2026-07-19_streaming-gitexecutor-exec.md):
  the per-line git streaming is the source the pull/sync segments render.

**Scope rule** — this epic owns the **technical-process framework** (the segment model, its
in-memory replay, the SSE transport) and the **process instances** whose deliverable *is* the
streamed long-running run (pull, sync, and their active-process discovery / reattach /
concurrency guard). It does not own the domain logic each process drives — `GitExecutor`
(repositories), the submodule sibling graph (submodules), container start (workspaces) — only
their framing as replayable segmented processes.

## Parts (implemented)

### The framework

- **[technical-process-log-stream](features/2026-07-18_technical-process-log-stream.md)** — the
  foundation: the technical-process abstraction (in-memory, replayable, segment-per-expander
  SSE), introduced with **workspace start** as its first instance.

### Repository pull / sync (the "train")

- **[repository-pull-technical-process](features/2026-07-19_repository-pull-technical-process.md)**
  — pull as a technical process: one named segment per repository pulled, recursively across
  imported submodule siblings (the "train").
- **[repository-pull-active-process-discovery](features/2026-07-19_repository-pull-active-process-discovery.md)**
  — active-process discovery, reattach, and a concurrency guard for pulls.
- **[sync-as-technical-process](features/2026-07-19_sync-as-technical-process.md)** — sync =
  the pull segments plus a final push segment.
- **[push-as-technical-process](features/2026-07-21_push-as-technical-process.md)** — the
  standalone Push button as the next instance (one `push:<basename>` segment), replacing the
  silently-swallowed 500; also surfaces the pull/sync/push POSTs' own in-request errors in an
  inline banner. Hosts the sign-in affordance of
  [git-remote-https-auth](../qits-project-repositories/features/2026-07-21_git-remote-https-auth.md)
  (implemented).

## Done when

Rolling: current when its `feature-ideas/` is empty and every technical-process feature since
this epic's creation has landed here. Future instances (stop, recreate, action-run) land as new
parts.

## Status

| Part | Status |
|---|---|
| [technical-process-log-stream](features/2026-07-18_technical-process-log-stream.md) | implemented |
| [repository-pull-technical-process](features/2026-07-19_repository-pull-technical-process.md) | implemented |
| [repository-pull-active-process-discovery](features/2026-07-19_repository-pull-active-process-discovery.md) | implemented |
| [sync-as-technical-process](features/2026-07-19_sync-as-technical-process.md) | implemented |
| [push-as-technical-process](features/2026-07-21_push-as-technical-process.md) | implemented |
