# Push as a technical process: the last silent git verb gets a streamed segment

## Introduction

The sync bar's **Push** button is the last synchronous git verb in the repository detail. `POST
/api/repositories/{repoId}/push` blocks on `git push` and returns `{output}` — and on failure the
UI shows **nothing at all**: the backend throws `InternalServerErrorException("Git push failed:
…")` → HTTP 500 with a `{message}` body, but `pushMutation`
(`repository-sync.component.ts`) defines only `onSuccess`, the sync bar has no error slot, and
there is no global mutation error handler — the spinner just stops. Today that is the *normal*
outcome of clicking Push against any auth-requiring HTTPS remote (no credential handling existed
until
[git-remote-https-auth](../../qits-project-repositories/features/2026-07-21_git-remote-https-auth.md)),
so the button looks dead.

This feature makes Push the next process instance — a single `push:<url-basename>` segment
streamed into the same dialog Pull and Sync already use — so a push failure is a red segment
carrying git's full stderr instead of a swallowed 500.

Related/dependent plans:

- **Completes the set started by**
  [repository-pull-technical-process](2026-07-19_repository-pull-technical-process.md)
  and [sync-as-technical-process](2026-07-19_sync-as-technical-process.md) — sync
  already streams its push as a `push:<basename>` segment (`RepositoryService.beginSyncRepository`);
  this reuses that exact segment shape for the standalone button.
- **Reuses the guard** from
  [repository-pull-active-process-discovery](2026-07-19_repository-pull-active-process-discovery.md):
  the kind-aware single-flight and the `active-process` reattach work unchanged for a `push` kind.
- **Hosts the sign-in affordance** of
  [git-remote-https-auth](../../qits-project-repositories/features/2026-07-21_git-remote-https-auth.md)
  (**implemented**) — the process dialog is where an auth-classified push failure (a
  `segment-settled` frame carrying `hint: remote-auth`) offers the "Sign in & push" terminal. That
  feature builds on this one.

## What exists today (the code being changed)

- `RepositoryController.push` → `RepositoryService.pushRepository(repoId)` (synchronous, request
  thread); `PushRepositoryRequest.Response(String output)` — the output is never displayed.
- `pushRepository` reads a `PushContext` in a short transaction and runs
  `git push <url> refs/heads/<branch>:refs/heads/<branch>` in the bare origin, wrapping any
  failure in `InternalServerErrorException` (RepositoryService.java:591–610).
- Frontend: `pushMutation` (repository-sync.component.ts:155–159) has no `onError`; the sync POST's
  own errors (e.g. the 400 `repositoryBusy` conflict) are equally silent.

## Design

- **`beginPushRepository(repoId)`** mirroring `beginSyncRepository` minus the pull walk: validate
  in-request (404 on unknown id), `processes.beginForRepository(repoId, "push")` (kind-aware
  single-flight — a live push is reused, a live pull/sync is a 400 conflict, and vice versa), then
  on the worker thread open `push:<url-basename>`, stream `pushRepository`'s output, settle
  ok/failed, `expectDaemons(List.of())` + `finishProvision(true)`. A push failure settles the
  segment `failed` with the message in-stream → `done failed`.
- `RepositoryController.push` returns `{ technicalProcessId }` (regenerate `openapi.yml` + the
  Angular client). `pushRepository` stays the throwing synchronous variant for internal callers
  (`syncRepository`, the streamed sync's push segment).
- **Frontend**: `pushMutation.onSuccess` opens a "Pushing repository" dialog exactly like
  pull/sync (`markProcessActive` + `openDialog`); invalidation moves to the process `finished`.
  Reattach and the button-disabling guard come for free from the `active-process` query.
- **Surface the POST errors too**: all three mutations (pull/sync/push) gain an `onError` writing
  to an error signal rendered as the established inline destructive banner (the
  `repository-detail.page.ts` `agentError`/`errorMessage()` pattern) below the sync bar — this
  catches the in-request failures a process never sees (404, the 400 busy-conflict).

## Costs and risks

- One more 200-with-id endpoint whose failures surface in-stream instead of as HTTP errors — the
  same intentional trade-off pull and sync made.
- The single-segment process is near-trivial; the value is uniformity (one dialog, one guard, one
  reattach path) and the dialog seat the auth feature needs.

## Testing sketch

- **Domain (`@QuarkusTest`):** a push process streams one `push:*` segment settling `ok` against a
  local-path remote; an unreachable/rejecting remote settles it `failed` and `done` is `failed`;
  a live pull conflicts with `beginPushRepository` (and vice versa).
- **Controller:** `POST …/push` returns `{ technicalProcessId }` immediately; unknown repo 404s.
- **Component (Vitest):** push mutate-success opens the dialog; invalidation fires on `finished`;
  a mutation error renders the banner.
