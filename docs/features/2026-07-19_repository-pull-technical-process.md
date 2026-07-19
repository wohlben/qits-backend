# Repository pull as a technical process: one segment per pulled repository

## Introduction

`POST /api/repositories/{repoId}/pull` is no longer one `git fetch` + fast-forward: since
submodule import, it recursively pulls every IMPORTED submodule sibling (cycle-safe, diamond-
deduped) — n network-bound fetches against n remotes. The browser sees none of it: the sync bar
shows a spinner until the whole walk finishes, the returned output blob is discarded by the UI
(`repository-sync.component.ts` only invalidates on success), and a child failure is a WARNING
line buried in that discarded blob. This feature streams the pull as a **technical process** —
the abstraction built for workspace start — with one named segment per repository pulled, so the
user watches the walk repo by repo and sees exactly which child failed.

Related/dependent plans:

- **Reuses the technical-process abstraction as designed** —
  `docs/features/2026-07-18_technical-process-log-stream.md` explicitly lists further instances
  ("stop, recreate, submodule-import, and action-run") as the design goal; this is the second
  instance and the first *repository-scoped* (workspace-less) one.
- **Instruments the recursive pull** — `docs/features/2026-07-14_workspace-submodule-support.md`
  introduced the imported-submodule sibling graph; the pull's recursion over it
  (`RepositoryService.pullRepository` + `withImportedChildPulls`) is what turned pull into a
  multi-step operation worth streaming.
- **Config re-ingestion rides the pull** —
  `docs/features/2026-07-18_qits-config-in-repo-configuration.md`: a main-branch advance
  re-ingests `.qits-config.yml`; its outcome line belongs in the same segment as the pull that
  triggered it.

## Contract

- **`POST /api/repositories/{repoId}/pull` becomes asynchronous**, mirroring
  `ensure-container`: register the `TechnicalProcess` *before* any git runs, execute the
  recursive pull on a worker thread, return `{ technicalProcessId }` immediately. The
  `PullRepositoryRequest.Response` record changes from `output` to `technicalProcessId`
  (regenerate `openapi.yml` + the Angular client). Failures no longer surface as HTTP errors —
  they surface in the stream, live and untruncated.
- **The SSE endpoint is reused unchanged** (`GET /api/technical-processes/{id}/events`): same
  frame vocabulary, replay-until-terminal, heartbeat, post-done retention, max-lifetime
  backstop. Nothing new on the wire.
- **Internal callers keep the synchronous variant**: `syncRepository` (pull-then-push) keeps
  calling the blocking `pullRepository(repoId)` — exactly the split `ensureContainer` /
  `beginEnsureContainer` established.

### Segments

One segment per repository visited by the recursion, opened **at recursion entry** (so the
currently-fetching repo is visible while its `git fetch` blocks on the network) and settled when
that repo's own pull completes:

1. **`pull:<repoName>`** for the root repository.
2. **`pull:<submodulePath>`** for each imported child, using the edge path the WARNING lines use
   today (falling back to the child repo name for a diamond-shared child reached twice — the
   `visited` dedup means a shared child gets exactly one segment, under the first edge that
   reached it; a cycle never reopens a segment).

Each segment carries that repo's fetch output, the fast-forward/up-to-date/locally-ahead
verdict, and (root/child alike) the `.qits-config.yml` re-ingestion outcome when its main branch
advanced.

### Failure semantics — preserved, but visible

- **Root failure** (diverged branch, unreachable remote): `failProvision` — the open segment
  settles `failed` with the message in-stream, `done failed`, walk over. Same behavior as
  today's HTTP 400/500, relocated into the stream.
- **Child failure** still **degrades loudly, never blocks**: the child's segment settles
  `failed` (its error message as the segment's last lines), the walk continues to the remaining
  children. Because `TechnicalProcess.finish()` computes overall `ok` over all segments, the
  terminal frame is `done failed` — a deliberate upgrade over today's buried WARNING: the dialog
  shows green on every repo that pulled and red on exactly the child that didn't.

### No daemon phase

The pull has no asynchronous second phase: the worker declares `expectDaemons(List.of())` and
`finishProvision(ok)` when the walk ends, so `done` fires immediately — the two-part completion
predicate degrades gracefully. (If a third workspace-less instance appears, consider renaming
the pair to something scope-neutral, e.g. `expectAsyncSegments`; not worth it for one caller.)

## Backend design

- **Repo-scoped processes.** `TechnicalProcessRegistry.begin(repoId, workspaceId)` assumes a
  workspace: it maintains `activeByWorkspace` and fires the `PROCESS` hint on the per-workspace
  channel. Add `beginForRepository(repoId)` — null `workspaceId`, no active mapping, no hint.
  Discovery is not needed in v1: the pull dialog gets its process id from the HTTP response and
  the id keeps working across dialog close/reopen within the done-TTL. (A repo-level
  `active-process` endpoint + hint topic — the "transient tab" treatment for a browser that
  navigated away mid-pull — is spun out as
  [`repository-pull-active-process-discovery`](../feature-ideas/repository-pull-active-process-discovery.md).)
- **`RepositoryService.beginPullRepository(repoId)`**: validate the repo exists in-request (so
  an unknown id is still a plain 404, not a process), register the process, then run
  `pullRepository(repoId, visited, process)` on a worker thread. The recursion gains an optional
  process parameter threaded through `withImportedChildPulls`; the existing public
  `pullRepository(String)` passes a no-op sink so `syncRepository` is untouched. Worker-thread
  caveat as in `beginEnsureContainer`: no request context, so DB touches
  (`get`, the submodule-edge query, config ingestion) must open their own transactions.
- **Line delivery is post-hoc per git command**: `GitExecutor.exec` returns captured output;
  split it into lines and append to the segment when each command returns. That is the
  `FakeContainerRuntime` fidelity level and is fine here — the segment-open frame already
  provides the live "now fetching X" signal, and per-repo fetch output is small. A streaming
  `exec(..., Consumer<String> onLine)` overload on `GitExecutor` (mirroring `ContainerRuntime`'s)
  is spun out as
  [`streaming-gitexecutor-exec`](../feature-ideas/streaming-gitexecutor-exec.md) for very slow
  fetches (it also stops the idle reaper from false-failing a long fetch).

## Frontend design

- **Dialog host, same as workspace start**: `repository-sync.component.ts`'s
  `pullMutation.onSuccess` opens a "Pulling repository" ZardUI dialog around
  `TechnicalProcessViewComponent` — the view is already host-agnostic (takes a process id, raw
  `EventSource` via `appUrl`). The `finished` output triggers `invalidateRepository` (today's
  `onMutationSuccess` moves there — the HTTP response now returns before anything was pulled, so
  invalidating on it would refetch stale state). Closing the dialog does not stop the pull.
- The pull button's `pullPending` flag flips only for the brief POST; the dialog carries the
  actual progress. Sync/Push keep their current synchronous behavior.

## Follow-up (out of scope, spun out as feature ideas)

Each deferral above is captured as its own feature idea rather than left as a note:

- **Active-process discovery, reattach, and a concurrency guard** —
  [`repository-pull-active-process-discovery`](../feature-ideas/repository-pull-active-process-discovery.md):
  the repo-scoped `active-process` endpoint + hint topic so a reload / second tab / navigate-away
  reattaches, plus disabling Pull/Sync (and a server-side single-flight) while a pull is live so a
  closed-dialog user can't start a second walk racing git on the same origin.
- **`sync` as a process** —
  [`sync-as-technical-process`](../feature-ideas/sync-as-technical-process.md): the pull segments
  plus a final `push` segment.
- **Streaming `GitExecutor.exec`** —
  [`streaming-gitexecutor-exec`](../feature-ideas/streaming-gitexecutor-exec.md): live per-line
  fetch output (replacing the post-hoc delivery above), which also stops the idle reaper from
  false-failing a genuinely slow single fetch.

## Testing

- `RepositoryPullProcessTest` (domain, `@QuarkusTest`): the segmented walk over the
  `submodule-super` fixture family — segment-per-repo ordering, diamond dedup (one segment for
  the shared child), cycle termination, child-failure settles `failed` while later children
  still pull and `done` is `failed`, root divergence → `failProvision`, config re-ingestion
  line present on a main-branch advance.
- `RepositoryControllerTest`: `POST …/pull` returns `{technicalProcessId}` immediately; unknown
  repo is still 404 in-request.
- `repository-sync.component.spec.ts` / view spec: dialog opens on mutate success, invalidation
  fires on `finished`, not on POST success.
