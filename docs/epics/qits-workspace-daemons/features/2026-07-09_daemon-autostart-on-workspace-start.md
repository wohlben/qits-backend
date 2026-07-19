# Daemon auto-start: starting a workspace starts its daemons

## As built (2026-07-09)

Shipped first as the **start-side half**; its sibling
[daemon-settling-on-workspace-stop](2026-07-09_daemon-settling-on-workspace-stop.md) landed the same
day as the stop-side half. Concretely:

- `RepositoryDaemon.autoStart` (default `true`), migration
  `V26__repository_daemon_auto_start.sql` (backfills existing rows to `true`). Threaded through the
  DTO, REST create/update request records, the `createDaemon`/`updateDaemon` MCP args, the daemon
  form + card, and both seed daemons — exactly like `otel`.
- `WorkspaceService.ensureContainer` fires the async CDI event
  `WorkspaceContainerStarted(repoId, workspaceId)` (via `WorkspaceContainerEventPublisher`) on its
  two cold→RUNNING transitions; the already-running short-circuit does not fire it.
- The observer began as `DaemonAutoStarter` (`daemon.control`) and was unified into the shared
  `DaemonLifecycleCoupler` proposed below when the settle half landed — it now hosts both directions
  (`onContainerStarted(@ObservesAsync)` and `onContainerStopping(@Observes)`). Kill switch
  `qits.daemons.autostart-enabled` (default `true`; tests default it off and re-enable per-profile).

The design narrative below is preserved as written.

## Introduction

Today a workspace container coming up and its daemons coming up are two unrelated, both-manual
events. [Lazy provisioning](../../qits-workspaces/features/2026-07-08_lazy-workspace-container-provisioning.md) made
"starting a workspace" a well-defined moment — `WorkspaceService.ensureContainer` materializing or
restarting the container — but a freshly started workspace always comes up **daemon-less**: the
dev server the workspace exists to run must be started by hand from the Daemons tab (or by the
agent via MCP) every single time, after every stop/start cycle, after every re-provision. This
idea couples the two lifecycles: **when a workspace's container starts, its daemons start with
it** (per-daemon opt-out), and symmetrically, when the container is deliberately stopped, its
daemons are settled instead of being left to the crash machinery.

Related/dependent plans:

- **Hard dependency on [daemons](../features/2026-07-04_daemons.md)** /
  [tmux-backed-daemons](../features/2026-07-05_tmux-backed-daemons.md): auto-start is a new caller
  of the existing `DaemonSupervisor.start` + `adoptIfRunning` machinery — no new launch mechanics.
- **Hard dependency on
  [lazy workspace container provisioning](../../qits-workspaces/features/2026-07-08_lazy-workspace-container-provisioning.md)**:
  the hook point is `ensureContainer`'s two cold→RUNNING transitions. Auto-start deliberately
  preserves its core split — *creating* a workspace still writes only rows (nothing docker,
  nothing started); daemons start when the **container** starts, whoever triggers that.
- **Sibling of [daemon-settling-on-workspace-stop](2026-07-09_daemon-settling-on-workspace-stop.md)** — the
  stop-side half of the same coupling: a deliberate `stopContainer` under a live daemon is
  currently indistinguishable from a crash, so the restart policy re-provisions the just-stopped
  container (that doc has the full chain). The two share the CDI-event inversion below and
  together make stop/start round-trip. Independently buildable — but auto-start alone makes the
  sibling's resurrection behavior *more* frequent (every stop of a workspace whose daemons
  auto-started hits it), so the settle half should land first or together.
- **Completes the [disposable-containers](../../qits-workspaces/features/2026-07-04_disposable-workspace-containers.md)
  story**: a container is a recreatable cache of origin state — but today recreation restores the
  *checkout* and silently drops the *running processes*. With auto-start, re-provision restores
  both, so "dispose and recreate" finally round-trips the whole workspace experience.
- **Surfaces via [workspace SSE live updates](../../qits-workspaces/features/2026-07-07_workspace-sse-live-updates.md)**:
  the auto-started daemons appear as STARTING→READY chips on the workspace detail route with no
  new UI plumbing.
- **Adjacent to the [daemon-healthchecks idea](2026-07-10_daemon-healthchecks.md)** (richer READY signal for
  what auto-start brings up) and to [feature-flows](../../qits-feature-flows/features/2026-05-01_feature-flows.md)'
  deferred "gate a phase on the dev server" — auto-start makes "the dev server is (about to be)
  up" a workspace invariant instead of a manual precondition.

## The gap today

`DaemonSupervisor.start` has exactly two callers: the REST controller
(`WorkspaceDaemonController`, `POST .../daemons/{daemonId}/start`) and the MCP tool
(`DaemonMcpTools`). Nothing starts daemons on workspace start, and nothing stops them on workspace
stop:

- **Fresh provision** (`ensureContainer` → `provisionContainer`): a new container has no daemons;
  the seeded "start the workspace, open the web view" demo flow actually requires a detour through
  the Daemons tab first.
- **In-place restart** (`ensureContainer` → `containers.start` of an `Exited` container, e.g.
  after a host/docker restart): the container's processes died with it — tmux sessions do not
  survive a container stop — so every daemon is dead and stays dead until manually restarted.
  (`adoptIfRunning` only re-adopts sessions that *survived*, i.e. the qits-JVM-restart case; it
  cannot help when the container itself cycled.)
- **Deliberate stop** (`stopContainer`, `discardWorkspace`): the supervisor isn't told, its
  liveness poll misreads the disappearance as a crash, and the restart policy resurrects the
  container — the [sibling settle idea](2026-07-09_daemon-settling-on-workspace-stop.md)'s territory.

The invariant this feature establishes (its half of it — the settle half is the sibling's): **a
running workspace container has its auto-start daemons running; a deliberately stopped one has
them settled STOPPED.** Stop/start round-trips.

## The model: an `autoStart` flag on the definition

One new boolean on `RepositoryDaemon` (sibling of `restartPolicy`), default **true** — the
feature's premise is that a repository's daemons are what its workspaces run, so opting *out* is
the marked case:

```java
/** Started automatically whenever a workspace container of this repository comes up. */
@Column(name = "auto_start", nullable = false)
public boolean autoStart = true;
```

Flyway `V26__repository_daemon_auto_start.sql` (via the `generate-migration` starter), backfilling
existing rows to `true` — see Open questions. Rides the existing definition CRUD
(`RepositoryDaemonController` request records, `RepositoryDaemonDto`, MapStruct mapper), the MCP
`createDaemon`/`updateDaemon` arguments, and the daemon form/card in the UI, exactly like the
`otel` flag does today.

## Execution: CDI lifecycle events out of `ensureContainer`

The dependency direction forbids the obvious call: daemon.control already depends on
repository.control (`ContainerRuntime`, `CommandService`), so `WorkspaceService` cannot inject
`DaemonSupervisor`. Invert it with a small CDI event fired by `WorkspaceService` and observed in
the daemon area:

- **`WorkspaceContainerStarted(repoId, workspaceId)`** — fired **asynchronously**
  (`fireAsync`) after `ensureContainer` stamps `RUNNING` on its two cold paths: the in-place
  `containers.start` of an Exited container and the fresh `provisionContainer`. The
  already-running short-circuit does **not** fire (nothing changed — and this is what terminates
  the reentrancy loop below). The [sibling settle idea](2026-07-09_daemon-settling-on-workspace-stop.md)
  adds the matching `WorkspaceContainerStopping` on the way down.

A new `@ApplicationScoped DaemonAutoStarter` (domain, `daemon.control`; if the sibling lands too,
one shared observer bean — `DaemonLifecycleCoupler` — hosts both directions) observes it: resolve
the repository's definitions (`RepositoryDaemonService.resolveAll`) and, for each with
`autoStart`, `supervisor.start` it unless an instance is already live (races with a concurrent
manual start just tolerate the supervisor's "already running" BadRequest). One daemon failing to
launch must not block the others; failures surface exactly like a manual start's —
STARTING→CRASHED transitions, daemon events, SSE — never as an `ensureContainer` error. Kill
switch `qits.daemons.autostart-enabled` (default true), in the `qits.daemons.*` family.

**Reentrancy is safe by construction**: auto-start → `supervisor.start` → `beginDaemonRun` →
`ensureContainer` hits the already-RUNNING short-circuit, which doesn't fire the event — the cycle
terminates after one cheap no-op hop. And because the event is async, `ensureContainer`'s latency
(and that of every lazy caller on a request thread) is unchanged.

**Every `ensureContainer` caller triggers it** — the explicit `POST /ensure-container` endpoint
and all lazy first-use paths (file browsing, agent launch, a manual daemon start materializing the
container) alike. One rule, no special cases: a running workspace has its daemons. The cost
concern (a heavy `quarkus:dev` booting because someone browsed files) is handled by the per-daemon
opt-out, not by trigger-path special-casing — see Open questions for the counter-position.

## Surface changes

- **DTO/REST**: `autoStart` on `RepositoryDaemonDto` + the controller's create/update request
  records (+ validation: none needed, it's a bare boolean). Regenerate `docs/openapi.yml`
  (`OpenApiSchemaExportTest`) and the frontend client (`pnpm generate:api`). No new endpoints:
  start/stop stay available for manual control of any daemon, auto-start or not.
- **MCP**: `createDaemon`/`updateDaemon` gain `autoStart`; `RepositoryMcpToolsTest`'s surface pin
  updates.
- **UI**: a checkbox in the daemon form (default checked) next to the restart-policy control; the
  daemon card shows an "auto-start" badge. The workspace detail route needs nothing new — the
  started daemons arrive via the existing SSE/poll as STARTING chips.

## Seed

`seed-webapp`'s "Quarkus dev server" daemon keeps `autoStart=true` (the default) and becomes the
demo: ensure the greeting workspace's container (any path — the UI start button suffices) and the
dev server comes up unattended (and, with the [sibling settle idea](2026-07-09_daemon-settling-on-workspace-stop.md)
in place, `stop-container` settles it STOPPED instead of CRASHED). `seed`'s tiny daemon likewise.

## Explicitly deferred

- **Per-workspace overrides** ("auto-start X in workspace A but not B"). The flag lives on the
  repo-level definition because that's where daemons live; a per-workspace runtime preference is a
  new persistence concern. Trigger: someone actually asks for divergent workspaces.
- **Desired-state reconciliation** — persisting "this daemon *should be* running in this
  workspace" (set by manual start/stop, honored across restarts and re-provisions) would subsume
  auto-start as "reconcile on container start" and give manual stops durable meaning. Deliberately
  not built: it introduces persisted runtime state where today only the `Command` row is durable.
  Trigger: users complaining that a manual stop doesn't survive a workspace stop/start cycle
  (with auto-start, a manually-stopped daemon comes back on the next container start).
- **Readiness-aware start** — holding "workspace is ready" (or a feature-flow phase) until
  auto-started daemons are READY. That's the [healthchecks idea](2026-07-10_daemon-healthchecks.md)'s gating
  follow-up; auto-start only *launches*.
- **Start ordering / dependencies between daemons** — launch order is undefined (they start
  concurrently via the supervisor). Trigger: a real fixture needs "db before app".

## Open questions

- **Backfill default for existing rows.** `true` matches the feature's premise but silently
  changes behavior for every existing daemon on its next container start; `false` is conservative
  but means the feature ships invisible. Lean **true**: the installed base is seed-managed (and
  `seed-webapp` resets itself), and a heavy daemon that shouldn't auto-start is exactly what the
  opt-out is for.
- **Should incidental lazy provisioning auto-start heavy daemons?** The one-rule invariant is
  simple and honest ("running workspace ⇒ daemons up"), but browsing a file tree booting a ~1 GB
  `quarkus:dev` may surprise. Alternative: fire `WorkspaceContainerStarted` only from the explicit
  `ensure-container` endpoint (+ UI start button). Lean one rule — the surprise is bounded by the
  opt-out flag and the kill switch, and trigger-path special-casing reintroduces the "which start
  is a *real* start" ambiguity lazy provisioning removed.

## Testing sketch

- **`DaemonAutoStarterTest`** (domain, `FakeContainerRuntime`): started event → autoStart daemons
  launched, opt-out daemon untouched, already-live instance skipped without error; concurrent
  manual start race tolerated; kill switch suppresses everything; one daemon's launch failure
  doesn't block the next.
- **`WorkspaceServiceTest` additions**: cold `ensureContainer` (fresh + Exited-restart) fires
  started; the already-running short-circuit doesn't.
- **Controller/MCP/OpenAPI**: `autoStart` CRUD round-trip; MCP surface pin; regenerate
  `openapi.yml`.
- **Frontend**: daemon form checkbox default-checked and round-tripping; card badge.
- **Manual (devcontainer, docker)**: `seed-webapp` → start the workspace from the UI → dev server
  reaches READY with no Daemons-tab interaction; stop and re-ensure the workspace → daemon comes
  back on its own; flip `autoStart` off → container start leaves it stopped. (Stop-side settling
  behavior is the sibling's manual check.)
