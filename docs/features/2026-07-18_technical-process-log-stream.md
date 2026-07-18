# Technical-process log stream: a replayable, segmented SSE view of workspace start

## Introduction

Starting a workspace is a multi-step, multi-second, cross-thread orchestration — `docker run`, a
`git clone` into `/workspace`, recursive submodule materialization, then (asynchronously) daemon
auto-start and its ready settling. It used to run blind: a static "Starting…", output discarded on
success, a 2000-char truncated `runtimeError` on failure. This feature introduces the **technical
process**: a first-class, in-memory, *replayable* unit of long-running back-office work, streamed
to the browser over SSE as **named segments**, each rendered as its own expander. "Start a
workspace" is the first instance; the abstraction is designed to also carry stop, recreate,
submodule-import, and action-run later.

Related/dependent plans:

- **Instruments the workspace start path** — `docs/features/2026-07-08_lazy-workspace-container-provisioning.md`
  (the `ensureContainer`/`provisionContainer` flow this streams) and
  `docs/features/2026-07-04_workspace-containers.md` (the `ContainerRuntime` seam that grew a
  streaming variant).
- **Correlates with the daemon lifecycle** — `docs/features/2026-07-06_workspace-observation-tabs.md`
  and the daemon supervisor's `STARTING → READY` machine; the start process reaches `done` only
  once auto-started daemons settle, on the async observer thread.
- **Coexists with the payload-free SSE contract** — the per-workspace channel
  (`WorkspaceEventsController`/`WorkspaceEventBroadcaster`) stays hint-then-refetch; this adds a
  separate **payload-bearing, replay-until-terminal** SSE pattern, generalizing the
  `CommandSession` replay ring to N named segments.
- **Adds a transient workspace-detail tab** — sibling in spirit to the parked
  `docs/backlog-ideas/workspace-feature-dossier-tab.md`; copes with the label-keyed reorder
  persistence (`docs/features/2026-07-09_draggable-workspace-detail-tabs.md`) via a new `zPinFirst`
  tab extension.

Originally drafted as `docs/feature-ideas/technical-process-log-stream.md`.

## The contract (as built)

- **`POST …/ensure-container` is now asynchronous**: it registers a `TechnicalProcess` *before*
  any work runs (so the very first `docker run` line is captured), spawns the provision on a
  worker thread (`WorkspaceService.beginEnsureContainer`), and returns
  `{ workspace, technicalProcessId }` immediately. Provision failures no longer surface as HTTP
  errors — they surface in the stream (live and untruncated) *and* still land truncated in
  `workspace.runtimeError` for the card badge. Internal blocking callers (`CommandService.prepare`,
  fast-forward, update-from-parent, file access…) keep the old synchronous, process-less
  `ensureContainer(repoId, workspaceId)`.
- **`GET /api/technical-processes/{id}/events`** (`TechnicalProcessEventsController`, hidden from
  OpenAPI) is the payload-bearing SSE stream: on every (re)connect it **replays all buffered
  segments and lines**, then streams live, then emits a terminal **`done`** frame and completes.
  A ~25 s `ping` heartbeat (`qits.process.heartbeat-ms`) rides the same emitter. An unknown or
  evicted id is a **404** — fatal to `EventSource`, so no retry loop.
- **Frames** are JSON:
  `{ segment, kind, seq, line?, status? }` with
  `kind ∈ {segment-open, line, segment-settled, done, ping}` and `status ∈ {ok, failed}` on
  `segment-settled`/`done`. `seq` is per-subscription only — a reconnect rebuilds from scratch.
  The vocabulary lives in `domain/.../process/dto/TechnicalProcessFrame.java`; the frontend mirrors
  it as a local interface (raw `EventSource`, not the generated client).
- **`GET …/workspaces/{id}/active-process`** returns `{ technicalProcessId | null }` — the
  discovery endpoint for the workspace detail route. Activeness changes are announced on the
  existing payload-free workspace channel as a new **`PROCESS`** topic
  (`WorkspaceChangeHint.Topic.PROCESS`, fired by the registry on begin and done); the hint channel
  stays data-free.

### Segments

1. **`docker-run`** — the `containers.run(...)` output (fresh provision), or **`container-start`**
   for the in-place `docker start` of an Exited container and for the already-running no-op.
   (The draft's separate `container-startup` wait segment does not exist — `docker run -d` of the
   `sleep infinity` workspace image has no distinct readiness phase to watch.)
2. **`clone`** — the `git clone --branch … /workspace` plus the per-level `wireSubmodules`
   `submodule update` output, all in one segment.
3. **`daemon:<name>`** — one per auto-started daemon: its startup log tailed from the same
   follower pipeline (a `SegmentLineSink` added to the follower's sinks), settled `ok` on
   `READY`/`STOPPED` and `failed` on `CRASHED`. `RESTARTING` keeps the segment open across the
   backoff. `HealthProbeService` stays a display sidecar and does not gate the process.

### The `done` predicate

`done` fires when the provision phase settled **and** the daemon phase converged:

- `WorkspaceService` calls `process.finishProvision(ok)`; a failure ends the process immediately
  (`failProvision` settles the open segment `failed` with the exception message in-stream).
- The daemon set is **declared before the first daemon start**: `DaemonLifecycleCoupler`
  (receiving the process id via a new field on `WorkspaceContainerStarted` — the cross-thread
  correlation, since the observer runs on the async observer thread) calls
  `process.expectDaemons(names)` with the full auto-start set — empty when there are none or the
  kill switch is off — so `done` can never fire between two daemons' settlements.
- Manual (non-auto-start) daemons never hold the process open; a daemon already running settles
  its segment `ok` immediately.

Two lifetime guards in `TechnicalProcessRegistry`:

- **Post-`done` retention** (`qits.process.done-ttl-ms`, default 60 s): a completed process stays
  subscribable — full replay + immediate `done` — so "close the dialog, reopen a beat later"
  doesn't race into a 404; then it evicts.
- **Max lifetime** (`qits.process.max-lifetime-ms`, default 15 min): a process that never
  converges (e.g. a ready pattern that never matches) is force-finished `done failed` without
  settling its open segments.

## Backend design

- **`domain.process.control.TechnicalProcess`** — framework-free (no Mutiny in `domain`): ordered
  segments with **bounded head+tail line buffers** (64 KB head kept verbatim, 192 KB rolling tail,
  an "… N line(s) elided …" marker on replay; 16 K char line cap), a plain `Listener`
  attach/detach fan-out under the process monitor (replay and live never interleave — the
  `CommandSession` trade-off), and the two-part completion state machine above.
  `TechnicalProcessRegistry` (`@ApplicationScoped`) keys processes by id and by
  `(repoId, workspaceId)`, fires the `PROCESS` hints, and owns the two timers.
- **Streaming exec** — `ContainerRuntime` gained default-method overloads
  `exec(container, workdir, env, Consumer<String> onLine, argv…)` and
  `run(repoId, wsId, branch, parent, onLine)`; `DockerExecutor` overrides them with genuine
  per-line streaming (`runCapturing` grew a line tap). `FakeContainerRuntime` keeps the defaults
  (post-hoc line delivery, order preserved), so tests exercise the stream without docker.
- **The SSE boundary lives in `service`** (`domain.process.api`), adapting the domain `Listener`
  to a Mutiny emitter; `domain` stays web-framework-free.
- **Worker-thread caveat**: `beginEnsureContainer`'s provision runs without a request context, so
  DB touches on that path must open their own transaction — `ensureContainer` already did
  (`QuarkusTransaction.requiringNew`), and `wireSubmodules`' submodule-edge query now does too.

## Frontend design

- **`TechnicalProcessViewComponent`** (`pattern/workspace/technical-process-view.component.ts`) —
  the one view, rendered in both hosts: a stack of expanders (active auto-expands, settled
  collapse to a status badge, manual toggles win), auto-scrolled log bodies, `EventSource` via
  `appUrl(...)` with reset-and-rebuild on reconnect, a frozen final state + `finished` output on
  `done`, and a "stream ended" note if the source closes for good without `done`.
- **Dialog host** — `branch-list.component.ts`'s `ensureContainerMutation.onSuccess` opens a
  "Starting workspace" ZardUI dialog around the view. Closing it does not stop the work; the
  `finished` output re-invalidates the repository queries so the runtime badge shows the outcome.
- **Transient tab host** — `workspace-detail.page.ts` queries `active-process`
  (`['workspace-active-process', repoId, workspaceId]`, kept fresh by the `process` topic in
  `workspace-live.service.ts`) and conditionally renders the view as a `Starting` tab. Its label
  is deliberately **not** in `TAB_SLUG_BY_LABEL` (URL-unpinned). The tab unmounts a few seconds
  after the process completes (a linger so the final state is readable).
- **Tab-group extensions** (`shared/components/tabs/tabs.component.ts`, local qits extensions like
  `indicator`): `zPinFirst` pins a tab ahead of any persisted reorder; a newly-appearing pinned
  tab auto-selects itself; and a destroyed active tab falls back to the first displayed tab.

## Testing

- `TechnicalProcessTest` / `TechnicalProcessRegistryTest` (plain JUnit, domain): replay ordering,
  the done predicate, failure settling, buffer elision, retention/eviction, backstop, hints.
- `WorkspaceEnsureContainerProcessTest` (domain, `@QuarkusTest` + fake runtime): the streamed
  Start's `docker-run`/`clone` segments (with real git output), the already-running no-op, the
  dead-branch `done failed`, the in-request 404.
- `DaemonProcessCorrelationTest` (domain): an auto-started daemon's lines land in the
  `daemon:<name>` segment of the same process, READY settles it, and gates `done`.
- `TechnicalProcessEventsControllerTest` / `WorkspaceActiveProcessTest` (service): the
  replay-then-live-then-`done` frame sequence over real HTTP, stream completion after `done`,
  heartbeat, 404, and the endpoint contracts.
- `technical-process-view.component.spec.ts` (webui): frame handling, expander behavior,
  `finished`, reconnect reset, lost-stream note.
