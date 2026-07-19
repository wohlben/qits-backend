# Repository pull: active-process discovery, reattach, and a concurrency guard

## Introduction

The [streamed repository pull](2026-07-19_repository-pull-technical-process.md) made
`POST /api/repositories/{repoId}/pull` asynchronous but shipped v1 with a deliberate shortcut:
`TechnicalProcessRegistry.beginForRepository(repoId)` kept **no active mapping** and fired **no
`PROCESS` hint**, so the running pull's id reached the browser only in the HTTP response. This
feature closes that gap, giving the repository pull (and the [streamed
sync](2026-07-19_sync-as-technical-process.md)) the same discovery/reattach/guard treatment the
workspace start already has — so a reload, a second tab, or a navigate-away-and-back reattaches to a
running pull, and Pull/Sync stay disabled while one is live (client-side, backed by a server
single-flight) so a closed-dialog user can't start a second walk racing git ref-locks on the same
bare origin.

Related/dependent plans:

- **Extends** [repository-pull-technical-process](2026-07-19_repository-pull-technical-process.md) —
  modifies `beginForRepository`, the pull/sync service methods, `RepositoryController`, and
  `repository-sync.component.ts`. Both browser-facing repo processes (`beginPullRepository`,
  `beginSyncRepository`) route through `beginForRepository`, so the guard/reattach covers both.
- **Mirrors the workspace analog** from the
  [technical-process log stream](2026-07-18_technical-process-log-stream.md): the per-workspace
  `active-process` endpoint + `PROCESS` hint + transient reattach view. This is the repository-scoped
  copy of exactly that machinery.
- **Rides an SSE hint, never a poll** — a new repository events channel delivers the `process` hint;
  the webui reattaches/clears the guard on the hint frame, not on an interval.

## What was built

### 1. Repo-scoped active mapping + hint (registry)

`TechnicalProcessRegistry` gained an `activeByRepository` map (keyed by `repoId`), symmetric to
`activeByWorkspace`:

- `beginForRepository(repoId)` now records the active mapping and fires the `PROCESS` hint on the
  **repository channel** — `changePublisher.fire(repoId, null, PROCESS)`.
- `onDone` clears the mapping (atomic `remove(repoId, id)`) and re-fires the repository hint for a
  null-workspace process (the existing workspace branch is unchanged).
- New accessor `activeForRepository(repoId)`.

The `PROCESS` hint reuses the existing `WorkspaceEventBroadcaster` keyed by `(repoId, null)`: the
broadcaster/debounce key `"repoId/null"` can never collide with a workspace subscriber's
`"repoId/<workspaceId>"`, so a repository hint never misfires a workspace channel or vice versa — no
new broadcaster was needed.

### 2. Discovery endpoint

`GET /api/repositories/{repoId}/active-process` → `{ technicalProcessId | null }` on
`RepositoryController` (which now injects the registry). Returns null when the repo exists but no
process is live; an unknown/deleted repo is a **404** like the sibling repository GETs (so a stale
tab surfaces the gone repository). The pull/sync POSTs keep their in-request 404.

### 3. Repository SSE channel

New `RepositoryEventsController` at `GET /repositories/{repoId}/events` (`@Operation(hidden=true)`,
so no generated client) — a repo-scoped copy of `WorkspaceEventsController` that subscribes to the
existing broadcaster via `subscribe(repoId, null)` and merges the same ~25s `ping` heartbeat. This is
what re-enables the buttons when a pull finishes while the dialog is **closed** (the `done` hint →
invalidate `['repository-active-process', repoId]` → refetch → null → guard clears) and drives
cross-tab live reattach.

### 4. Concurrency guard

- **Server single-flight** — `beginForRepository(repoId, kind)` is one **atomic, kind-aware**
  check-and-register under the registry monitor (so two racing POSTs can't both register and leave
  two walks contending on the origin). It returns `Reused` (a live process of the **same** kind — the
  caller returns its id, starts no walk), `Conflict` (a live process of a **different** kind — a pull
  and a sync can't share a walk since a pull would silently skip the push, so the service rejects with
  a 400), or `Fresh`. This is a correctness fix over a scope-blind guard, which would have let a Sync
  attach to a running Pull and report success without ever pushing.
- **Client guard** — `repository-sync.component.ts` derives `processActive` from the active-process
  signal and feeds it into the sync bar's `busy`, so Pull/Sync/Push stay disabled while a repo pull
  is live even after the dialog is closed. A pull/sync seeds the active-process cache the instant it
  starts (before the hint's refetch lands), so no window exists in which a second run could arm.

### 5. Frontend reattach

New `RepositoryLiveService` (a one-topic mirror of `WorkspaceLiveService`, provided on the
self-contained sync component) opens the repo events `EventSource` and maps the `process` hint to
invalidating `['repository-active-process', repoId]`. `repository-sync.component.ts` gained the
`active-process` query (one fetch on mount, then hint-driven refetches — never polled) and a reattach
effect that reopens the streamed-log dialog when a running process is discovered on load and no
dialog is open.

## Testing

- **`TechnicalProcessRegistryTest`** (domain, plain JUnit): `beginForRepository` registers the active
  mapping and fires exactly one repo `PROCESS` hint; `onDone` clears it, fires a second hint, and
  evicts after the retention window; `activeForRepository` is empty for an unknown repo.
- **`RepositoryPullProcessTest`** (domain `@QuarkusTest`): a second `beginPullRepository` and a
  `beginSyncRepository` while a repo process is active are single-flighted to the same id.
- **`RepositoryActiveProcessTest`** (service): `POST …/pull` returns an id immediately, `active-process`
  tracks it to null after `done`, a second pull during an active one returns the same id, and an
  unknown repo's `active-process` is null.
- **`repository-sync.component.spec.ts`** / **`repository-live.service.spec.ts`** /
  **`repository-sync-bar.component.spec.ts`** (Vitest): on-mount reattach reopens the dialog, the
  guard engages on pull and survives a dialog close, the `process` hint maps to the active-process
  invalidation, and `processActive` disables the bar's controls.

Registry/controller tests also cover the kind-aware guard: a same-kind begin reuses, a cross-kind
begin conflicts, a Sync-while-Pull is a 400, and an unknown-repo `active-process` is a 404.
