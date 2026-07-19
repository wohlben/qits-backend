# Sync as a technical process: pull segments plus a final push segment

## Introduction

The [streamed repository pull](../features/2026-07-19_repository-pull-technical-process.md) turned
`POST /api/repositories/{repoId}/pull` into a segmented [technical
process](../features/2026-07-18_technical-process-log-stream.md) — one segment per pulled
repository, watched live over SSE. Its sibling `POST /api/repositories/{repoId}/sync` (pull then
push) stayed **synchronous**: it blocks on the whole recursive walk plus the push and returns one
concatenated `output` blob the UI discards, showing only a spinner. This feature makes sync
process-shaped too, exactly as the pull feature's own follow-up notes ("`sync` as a process: pull
segments + a final `push` segment — trivial once pull is process-shaped"). The payoff is the same:
the user watches a slow sync repo-by-repo and sees precisely whether the pull or the push failed.

Related/dependent plans:

- **Reuses the pull feature's plumbing** —
  [repository-pull-technical-process](../features/2026-07-19_repository-pull-technical-process.md):
  the repo-scoped `TechnicalProcess`, the `beginPullRepository` worker pattern, and the streamed
  `pullRepository(..., process, ...)` recursion are already there; sync wraps them and appends one
  push segment.
- **Reuses the SSE + view unchanged** from the
  [technical-process log stream](../features/2026-07-18_technical-process-log-stream.md).
- **Benefits from**
  [repository-pull-active-process-discovery](repository-pull-active-process-discovery.md) — once
  repo-scoped processes are discoverable, a sync reattaches after navigation for free, and the same
  concurrency guard prevents a pull and a sync racing the same origin.

## What exists today (the code being changed)

- `RepositoryController.sync` → `RepositoryService.syncRepository(repoId)` (blocking:
  `pullRepository` then `pushRepository`, returns the joined blob). `SyncRepositoryRequest.Response`
  carries `output`.
- `pushRepository(repoId)` pushes `refs/heads/<branch>` to `repo.url` and returns git's output.
- `beginPullRepository` is the process-shaped pull; `syncRepository`/`pullRepository(String)` remain
  the synchronous variants internal callers use.

## Design

- Add `beginSyncRepository(repoId)` mirroring `beginPullRepository`: validate in-request (404 on
  unknown id), register a repo-scoped `TechnicalProcess`, and on the worker thread run
  `pullRepository(repoId, …, process, rootSegment, …)` then a `push:<url-basename>` segment wrapping
  `pushRepository`'s output, then `expectDaemons(List.of())` + `finishProvision(true)`.
- Failure semantics carry over: a diverged/unreachable pull fails the process before the push
  segment opens; a push failure settles the `push` segment `failed` → `done failed`. Because
  `finish()` computes overall `ok` across all segments, a green pull with a red push reads exactly
  that way.
- `RepositoryController.sync` returns `{ technicalProcessId }` (regenerate `openapi.yml` + the
  Angular client). Internal callers keep the synchronous `syncRepository`.
- Frontend: `repository-sync.component.ts`'s `syncMutation` opens the process dialog (title e.g.
  "Syncing repository") the same way pull does, and invalidates on `finished` rather than on the
  POST.

## Costs and risks

- The push segment name (`push:<basename>`) shares the walk's segment-name space — allocate it
  through the same unique-name allocator the pull uses, so it can't collide with a `pull:<basename>`
  of the same name.
- One more async endpoint that returns 200-with-id instead of a failure status — the same,
  intentional trade-off the pull endpoint made (internal callers keep the throwing synchronous
  path).

## Testing sketch

- **Domain (`@QuarkusTest`):** a sync process streams the pull segments then a `push:*` segment
  settling `ok`; a push failure (unreachable/rejected remote) settles the push segment `failed` and
  `done` is `failed`; a diverged pull fails before the push segment opens.
- **Controller:** `POST …/sync` returns `{ technicalProcessId }` immediately; unknown repo 404s.
- **Component (Vitest):** sync mutate-success opens the process dialog; invalidation fires on
  `finished`, not on the POST.
