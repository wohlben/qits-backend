# Live working-tree freshness for `/files` and `/detection` — a per-workspace file watcher over SSE

## Introduction

[Backend framework detection](2026-07-12_backend-framework-detection.md) moved
project/framework/test-link detection server-side behind `GET .../{workspaceId}/detection`, computed
over the workspace's **live working tree**; `/files` already read that tree. Both were fetched **once,
on demand**, validated per request against a cheap working-tree marker (`DetectionService` /
`ComponentMapService` cache the scan and invalidate it when `git status` + `git diff` move). That made
a *re-fetch* always fresh, but nothing **triggered** the re-fetch: the coding agent can scaffold a
module, add a `pom.xml`, or write a test **without a commit**, and the browser wouldn't know until the
user reloaded.

This feature adds the missing push: a **single file watcher per workspace** that fans a change signal
out over the **existing** `/events` SSE channel, so `/files`, `/detection`, and any open file's
content re-fetch live when the tree changes — with a **generation token** that keeps the tree and its
detection render-consistent.

Related / dependent plans:

- **Parent:** [backend framework detection](2026-07-12_backend-framework-detection.md) — supplies
  `/detection` and its marker cache; this makes it refresh live. The marker cache stays as the
  correctness backstop (a re-fetch is always fresh even if an event is missed).
- **Rides the SSE fan-out built by**
  [workspace SSE live updates](2026-07-07_workspace-sse-live-updates.md) *(the `/events` channel,
  `WorkspaceEventBroadcaster` debounce, and the frontend `WorkspaceLiveService` topic→invalidation
  map)* — this feature adds one new source (`FILES`) and one new topic (`files`), reusing everything
  downstream.
- **Consumes** the workspace container model
  ([workspace containers](2026-07-04_workspace-containers.md),
  [lazy provisioning](2026-07-08_lazy-workspace-container-provisioning.md)): the watcher's lifecycle
  follows the container's, and it runs **inside** the container where the agent's edits land
  (`/workspace`).
- **Aligns with the project's no-polling rule**: freshness is push (SSE), never a poll interval.

## What was built

### Container-side watcher — `WorkspaceWatchService` + `WorkspaceWatchSession` (domain)

`domain/.../repository/control/WorkspaceWatchService.java` owns **one** watcher per active workspace,
keyed `repoId + "/" + workspaceId`. Its lifecycle follows the container's, mirroring
`DaemonLifecycleCoupler`:

- `@ObservesAsync WorkspaceContainerStarted` → start a session (off the event thread, so it never adds
  to `ensureContainer` latency; the already-RUNNING short-circuit doesn't fire the event, so no
  duplicate starts).
- `@Observes WorkspaceContainerStopping` → stop it **synchronously before** `containers.rm`.
- Kill switch `qits.workspace.watch.enabled` (default `true`).

`WorkspaceWatchSession` is the sibling of `daemon.control.ContainerTailSource`: it spawns
`<runtime> exec … inotifywait -m -r …` (argv built from `ContainerRuntime.execArgv`, so the watch runs
**inside** the container where `docker exec` edits land), reads stdout on a daemon thread, and calls a
change callback per non-blank line. Heavy build/VCS dirs are excluded (`.git`, `node_modules`,
`target`, `dist`, `build`, `.angular`, `.gradle`).

### Central coalescing + marker dedup

Raw inotify lines are **coalesced and deduped centrally**, not fired one-per-event. A burst opens one
short window (`qits.workspace.watch.coalesce-ms`, default 250ms); at its close the working-tree
**marker** (`WorkingTreeMarker` — `sha256(git status --porcelain=v2 --branch -uall + " " + git
diff)`) is computed **once** and a `WorkspaceChangeHint.Topic.FILES` hint fires only if it actually
moved. The marker moves on both structural changes *and* tracked-content edits (so detection labels
and open-file content stay fresh), but stays put for churn under a gitignored path the inotify
`--exclude` missed — so every listener is spared a no-op refetch, deduped here once rather than N times
downstream.

### Reused, unchanged: the SSE fan-out

The `FILES` topic serializes to the wire topic `files` automatically via `WorkspaceEventBroadcaster`,
which already debounces per `(workspace, topic)` (leading+trailing, `qits.events.debounce-ms`, default
1000ms → ≤1 emit/s) and fans out to every connected browser over `WorkspaceEventsController`'s
`/events` stream. No change to either.

### Render-consistency via a generation token

Both `/files` and `/detection` now stamp a **structural generation token** — `WorkspaceTreeFingerprint`
(`sha256` of the sorted `git ls-files`), which changes exactly when the set of tracked paths changes
and stays put across pure content edits. `DetectionDto` gains a `generation` field; the `/files`
response gains one too (the root reuses its already-fetched `ls-files`; a lazy `?path=` level computes
the whole-tree fingerprint so any level is comparable).

On the client, `workspace-file-browser.component.ts` derives a `consistentDetection` (a `linkedSignal`)
that applies detection **only while its generation matches the tree (`/files`) generation being
rendered**; on a mismatch it **holds** the last consistent detection rather than showing a skewed
combination. The two tokens agree on first load (same tree) so there is no initial flash, and any
in-flight mutation resolves on the next tick — which refetches both. (`WorkingTreeMarker` and
`WorkspaceTreeFingerprint` are shared beans; the marker, previously duplicated in `DetectionService`
and `ComponentMapService`, was extracted so all three consumers agree.)

### Frontend — one topic entry

`workspace-live.service.ts` maps the `files` topic to invalidate `['workspace-files', repoId,
workspaceId]` (a prefix, so every opened lazy directory refetches too), `['workspace-detection', repoId,
workspaceId]` (shared by the file browser and the plugins recommender), and `['workspace-file', repoId,
workspaceId]` (a prefix, so an open file viewer refreshes on an uncommitted edit). No other component
change — everything reads off those queries, gated by the generation token.

### Image

`docker/workspace/Dockerfile` installs `inotify-tools` (provides `inotifywait`).

## Testing

- `WorkspaceWatchServiceTest` (domain): each watch-process stdout line invokes the change callback (a
  benign `sh -c "printf …"` stands in for `inotifywait`, so it needs no docker); the marker dedup fires
  only when the marker moves; and the lifecycle — `WorkspaceContainerStarted` → one active watcher →
  `WorkspaceContainerStopping` → zero. `WorkspaceWatchKillSwitchTest`: disabled ⇒ no watcher.
- `WorkspaceWatchIT` (`@Tag("extended")`, self-skips without docker/image): a real `inotifywait` in a
  real `qits/workspace` container fires the callback on a tracked edit and stays silent for churn under
  `node_modules`. Reuses `WorkspaceWatchService.watchArgv` so the exact production command runs. Run
  with `./mvnw verify -Pextended`.
- `WorkspaceControllerTest`: `/files` and `/detection` return the **same, non-empty** generation token
  over an unchanged tree (the render-consistency contract); the existing detection matrix is unchanged.
- Frontend specs: `workspace-live.service.spec.ts` — a `files` message invalidates the tree, detection,
  and file-content queries; `workspace-file-browser.component.spec.ts` — detection is applied only when
  its generation matches the tree's, and **held** (no framework offers) on a mismatch.
- `docs/openapi.yml` + the webui typed client regenerated for the `generation` field.

The watcher is off by default in every module's test `application.properties`, so the unrelated suites
never spawn a process; the watch tests re-enable it via a `@TestProfile`.

## Known limitations

- **inotify watch exhaustion / gitignore blindness.** `inotifywait -r` sets a watch per directory and
  `--exclude` filters *events*, not watch establishment, so a freshly created `node_modules` can still
  consume watches. The marker dedup means such churn produces no broadcast even so; if watch-limit
  exhaustion itself is observed, the follow-up is raising `fs.inotify.max_user_watches`.
- **No auto-restart** of a watcher that dies mid-session; the SSE reconnect resync and the marker cache
  keep a re-fetch correct regardless.
