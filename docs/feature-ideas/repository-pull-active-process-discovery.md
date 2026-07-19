# Repository pull: active-process discovery, reattach, and a concurrency guard

## Introduction

The [streamed repository pull](../features/2026-07-19_repository-pull-technical-process.md) made
`POST /api/repositories/{repoId}/pull` asynchronous, but shipped v1 with a deliberate shortcut:
`TechnicalProcessRegistry.beginForRepository(repoId)` keeps **no active mapping** and fires **no
`PROCESS` hint**, so the running pull's id is handed to the browser **only** in the HTTP response.
The workspace path does not have this gap — its `begin` keeps an `activeByWorkspace` entry, fires a
`PROCESS` hint, and exposes `GET …/workspaces/{id}/active-process`, which the workspace-detail
"Starting" tab uses to reattach. This feature gives the repository pull the same treatment, and
closes the three consequences of the shortcut:

- **No reattach.** A second tab, a page reload, or a navigate-away-and-back cannot discover the
  running pull; after the 60s done-TTL even the original id 404s.
- **Stale header on mid-pull close.** Closing the dialog before `done` tears down the process view,
  so its `finished` invalidation never fires. (v1 invalidates on close as a safety net, but the
  header won't reflect the *final* pulled state until a later refetch.)
- **Concurrent pulls.** The Pull button's pending flag clears after the brief POST, so once the
  modal is closed a second Pull/Sync can start against the same bare origin on another worker
  thread, racing git ref-locks.

Related/dependent plans:

- **Extends the already-shipped**
  [repository-pull-technical-process](../features/2026-07-19_repository-pull-technical-process.md) —
  this modifies `beginForRepository`, the pull endpoint, and `repository-sync.component.ts`; it is
  not a parallel design.
- **Mirrors the workspace analog** from the
  [technical-process log stream](../features/2026-07-18_technical-process-log-stream.md): the
  per-workspace `active-process` endpoint + `PROCESS` hint + transient reattach tab. This is the
  repository-scoped copy of exactly that machinery.
- **Live freshness rides** the existing workspace SSE/live channel — qits' webui never polls, so
  reattach hangs off a hint frame, not an interval.

## What exists today (the code being changed)

- `TechnicalProcessRegistry.beginForRepository(repoId)` registers in `byId` and arms the idle
  reaper, and stops there — no `activeByRepository`, no hint; `onDone` runs only the retention
  schedule for a null-workspace process.
- `RepositoryService.beginPullRepository` returns `process.id()`; the id-keyed SSE endpoint
  `GET /api/technical-processes/{id}/events` needs no change.
- `repository-sync.component.ts` opens the "Pulling repository" dialog from `pullMutation`'s
  response id; `closeDialog()` nulls `processId` and invalidates; `onProcessFinished()` invalidates;
  `pullPending` is `pullMutation.isPending()`.

## Design

### 1. Repo-scoped active mapping + hint (registry)

`beginForRepository` records an `activeByRepository` entry (keyed by `repoId`); `onDone` clears it.
Add `activeForRepository(repoId)`. Announce activeness on a repository channel — either a new
payload-free repo hint topic or the existing change channel keyed by `(repoId, null)` (decide topic
keying; the workspace hint is per-workspace today, so a repo topic is likely cleaner).

### 2. Discovery endpoint

`GET /api/repositories/{repoId}/active-process` → `{ technicalProcessId | null }`, mirroring the
workspace endpoint.

### 3. Reattach in the frontend

`repository-sync.component.ts` gains an `active-process` query and subscribes to the repo hint over
the live channel; on load (or hint) it reopens the process view for a still-running pull, so a
reload / second tab resumes the stream. The `finished`/close invalidation stays.

### 4. Concurrency guard

- **Client:** derive `busy` from the active-process signal (not just `pullMutation.isPending()`) so
  Pull and Sync stay disabled while a repo pull is live — closing the modal mid-pull can no longer
  arm a second run.
- **Server (the robust guard):** a per-`repoId` single-flight in `beginPullRepository` — if a pull
  process is already active for the repo, return its id instead of starting a second walk against
  the same origin. This closes the race even for a client that never learned a pull was running.

## Costs and risks

- A repository-scoped hint/channel is new surface; reusing the workspace channel with a null
  workspace must not misfire workspace subscribers.
- The server single-flight must still 404 an unknown repo in-request (keep the existing validation)
  and must not wedge on a leaked process (the idle reaper backstops this).

## Testing sketch

- **Registry (`@QuarkusTest`):** `activeForRepository` returns the id while running and is empty
  after `done`; a second `beginPullRepository` during an active pull returns the same id.
- **Controller:** `active-process` returns the running id, then null within the done-TTL; unknown
  repo still 404s.
- **Component (Vitest):** an `active-process` result reopens the process view; Pull/Sync disabled
  while a process is active; a repo hint frame triggers reattach without polling.
