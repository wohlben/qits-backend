# Workspace bootstrap commands: ordered one-shot runs after provisioning

## Introduction

A freshly provisioned workspace container is a bare checkout: dependencies not installed, demo
data not seeded, nothing built. Daemons ([auto-start](../../qits-workspace-daemons/features/2026-07-09_daemon-autostart-on-workspace-start.md))
already couple *long-running processes* to the container lifecycle, but there is no counterpart
for *one-shot bootstrap work* — the `pnpm install`, `./mvnw install`, database-migrate,
fixture-seed steps that must complete **once, in order, before development (and the dev-server
daemon) can start properly**. Today that work is manual: run actions by hand from the Actions
tab, in the right order, after every re-provision.

This feature introduces **bootstrap commands**: an ordered list of one-shot commands a repository
declares (in the UI or in its committed `.qits-config.yml`) that qits runs **inside the workspace
container after provisioning completes, before daemons auto-start** — and that can be re-run on
demand from a dedicated workspace surface, like daemons have. The motivating dogfood case is
qits-in-qits: the qits repo declaring `./mvnw install -DskipTests` followed by the cli
`seed`/`seed-webapp` runs, so a child-qits workspace comes up with the demo fixtures already
seeded and only then starts its `quarkus:dev` daemon.

(Terminology: **bootstrap** is the domain concept — everything needed to take a bare checkout to
a runnable state. *Seeding* (demo/fixture data) is one specific, common bootstrap step — the one
qits itself needs via its cli `seed`/`seed-webapp` commands — but installing dependencies,
building, and migrating are equally conceivable steps, so the domain is named for the process,
not one step of it.)

Related/dependent plans:

- **Hard dependency on [lazy workspace container provisioning](./2026-07-08_lazy-workspace-container-provisioning.md)** —
  the hook point is `WorkspaceService.provisionContainer` (fresh `docker run` + clone + submodule
  wiring); like daemon auto-start, bootstrap triggers off the *container* lifecycle, so workspace
  *creation* stays rows-only.
- **Sibling of [daemon auto-start](../../qits-workspace-daemons/features/2026-07-09_daemon-autostart-on-workspace-start.md)** —
  same `WorkspaceContainerStarted` event chain (`WorkspaceContainerEventPublisher` →
  `DaemonLifecycleCoupler`), but bootstrap must run **before** auto-start, so the coupling order
  is the core design point (below). The entity/UI shape also mirrors `RepositoryDaemon`'s
  pattern: own domain area, own repository-config section, own workspace surface.
- **Executes through the action/command machinery** ([actions](../../qits-feature-flows/features/2026-05-01_actions.md),
  [command registry](../../qits-workspace-commands/features/2026-06-30_command-registry.md),
  [command audit logs](../../qits-workspace-commands/features/2026-06-30_command-audit-logs.md)) — a bootstrap command runs
  via the same `docker exec` seams and leaves the same `Command` audit rows/log streams as an
  action run, but is its own entity, not an `ActionConfiguration`.
- **Extends [.qits-config in-repo configuration](../../qits-project-repositories/features/2026-07-18_qits-config-in-repo-configuration.md)** —
  a new `bootstrap:` section, reconciled by `QitsConfigReconciler` with the same `@qits-config`
  namespacing; and the [dogfooding convention](../../qits-integration-quarkus/features/2026-07-18_qits-dogfooding-managed-app-convention.md)
  is the first consumer (qits' own root `.qits-config.yml`).
- **Completes the [disposable-containers](./2026-07-04_disposable-workspace-containers.md)
  story** — auto-start made re-provision restore the *processes*; bootstrap makes it restore the
  *bootstrap state* (deps, build output, demo data), so prune-and-recreate finally round-trips
  everything.
- **Streams through the [technical-process log stream](../../qits-technical-processes/features/2026-07-18_technical-process-log-stream.md)** —
  the provision-time chain runs as named `bootstrap:<name>` segments of the workspace Start
  process, between the provision segments and the `daemon:*` segments (a `SegmentLineSink` taps
  each execute's live output). The process leak backstop is an **idle** window
  (`qits.process.max-idle-ms`, default 15 min) rather than a total-lifetime cap, so a chain of any
  length is never cut mid-run as long as it keeps streaming, while a stalled process is still reaped.

## Goals

1. A repository can declare an **ordered** list of bootstrap commands; after a workspace
   container is freshly provisioned, qits runs them sequentially inside the container, at
   `/workspace`.
2. Daemon auto-start waits for the bootstrap chain: dev servers come up against a bootstrapped
   checkout, never a bare clone.
3. Declared in `.qits-config.yml` (primary path) and manageable in the UI like daemons;
   config-declared entries follow the existing `@qits-config` read-only convention.
4. A dedicated workspace surface (à la the Daemons tab) lists the configured bootstrap commands
   with their last run state and lets the user **re-run the chain (or a single command) on
   demand**.
5. Runs are observable and auditable through the existing command infrastructure (live logs,
   history), and a failed chain surfaces loudly on the workspace.
6. qits' own `.qits-config.yml` dogfoods it: a child-qits workspace self-bootstraps its build and
   demo fixtures before its dev-server daemon starts.

## Non-Goals

1. **Blocking workspace creation.** Creation stays rows-only; bootstrap hooks container
   provisioning, whoever triggers it (same decision auto-start made).
2. **Running on container restarts.** The chain runs on *fresh provision* only (and on manual
   trigger) — a restarted container keeps its checkout and bootstrap state. Re-running on every
   cold→RUNNING transition is explicitly out of scope for now.
3. **Retroactive bootstrapping.** Already-provisioned containers are not bootstrapped when the
   config gains commands; the manual trigger (and every future re-provision) covers it.
4. **Branch-divergent bootstrap.** V1 reads from `mainBranch` like the rest of
   `.qits-config.yml`; per-workspace-branch config is the existing follow-up there.
5. **Guaranteed idempotency.** qits re-runs the chain on every fresh provision and manual
   trigger; making that safe is the command author's contract (the cli seeds' skip-if-exists /
   reset-by-design pattern), helped by the optional `check` script ("is this needed" — non-zero
   check skips the command).
6. **Host-side execution or secrets management.** Bootstrap runs where all workspace work runs —
   the container — with plain environment maps like actions/daemons.

## The model: a `BootstrapCommand` entity, ordered, per repository

A new domain area `eu.wohlben.qits.domain.bootstrap` following the `daemon` area's pattern:
entity **`BootstrapCommand`** (Panache, String UUID id) owned by a `Repository`, with
`name`, `description`, `executeScript`, optional `checkScript`, `environment` map, and an
explicit **`orderIndex`** — multiple bootstrap commands are the normal case and they run strictly
in order, so ordering is first-class in the entity, not an afterthought on a shared table.
(Deliberately *not* a `seed_order` column on `ActionConfiguration`: bootstrap commands are their
own lifecycle-bound concept with their own list semantics, validation, and UI surface — the
daemon precedent, not the action one.)

Execution still goes through the existing command machinery — `CommandService`, the registry's
`docker exec` seams, `Command` audit rows, live log SSE — so there are no new run mechanics, only
a new caller. The service layer (`BootstrapCommandService` + a chain runner) owns ordering,
check-skip, and failure handling.

### Config schema

```yaml
bootstrap:                    # ordered; position = execution order -> orderIndex
  - name: install
    description: Build the reactor so the cli jar exists
    execute: ./mvnw install -DskipTests -Dqits.variant=forwardauth
  - name: seed-demo-data
    description: Seed the tiny testing-repo demo (idempotent, skip-if-exists)
    execute: ./mvnw -pl cli quarkus:run -Dcli.args=seed
    check: test ! -f ~/.qits/data/h2/qits.mv.db   # optional skip guard
    environment:
      MAVEN_OPTS: -Xmx2g
  - name: seed-webapp-demo
    description: Seed the servable Quarkus+Angular demo (idempotent by reset)
    execute: ./mvnw -pl cli quarkus:run -Dcli.args=seed-webapp
```

Reconciled by `QitsConfigReconciler` exactly like `daemons[]`: a `BootstrapDecl` list in
`QitsConfig`, upsert keyed by the `@qits-config`-suffixed name via a declarative
`upsertFromConfig` on `BootstrapCommandService`, `orderIndex` stamped from list position,
config-origin entries read-only in the UI.

## Execution model and ordering vs daemon auto-start

`provisionContainer` is already synchronous-blocking on first workspace access; a bootstrap chain
(`mvn install` can take minutes) cannot extend that block. So the chain runs **asynchronously
after provisioning**, sequenced *between* the container start and daemon auto-start:

1. `provisionContainer` completes (clone + submodule wiring) and `ensureContainer` fires
   `WorkspaceContainerStarted` as today — extended with a `freshProvision` flag distinguishing
   its two cold→RUNNING transitions. Only the fresh-provision transition triggers bootstrap; a
   plain restart of a stopped container passes straight through to auto-start as today.
2. `WorkspaceBootstrapRunner` observes the event. On `freshProvision` with a non-empty command
   list it runs the chain sequentially through the command machinery (each execute a `Command`
   row via `CommandService.launchScriptAndAwait`, `actionId` null — the agent-launch snapshot
   precedent; the `check` script is consulted first via `docker exec`, non-zero = skipped, no
   `Command` row). No commands, or a plain restart → straight pass-through.
3. Auto-start is re-sequenced structurally (CDI gives two async observers of one event no
   ordering): the runner is the only firer of a new `WorkspaceReadyForDaemons` event —
   immediately on pass-through, after chain success, and after a successful manual full-chain
   run — and `DaemonLifecycleCoupler` observes *that* instead of the container event. The
   stop-side settling path is untouched. `WorkspaceWatchService` keeps observing the container
   event directly (file watching must not wait on bootstrap).

Per-workspace last-run state lives in a tiny `BootstrapRun` entity (`workspace_bootstrap_run`,
one row per `(workspace, command)`, overwritten each run: outcome SKIPPED/SUCCEEDED/FAILED, a
`commandId` link to the audit row — null for skips — exit code, timestamp). `bootstrapCommandId`
is a snapshot column, not a FK (the `Command.actionId` precedent), so reconcile-time deletion
never breaks recorded state.

**Manual trigger**: `POST /api/.../workspaces/{id}/bootstrap-commands/run` re-runs the whole
chain on demand (and `POST .../bootstrap-commands/{commandId}/run` a single command) — async, 400
while a run is in flight (a per-workspace in-flight guard also absorbs the container-started
event a manual run's own `ensureContainer` may fire). On chain success after a failed
provision-time run, daemon auto-start proceeds. This is also the recovery path and the
"config gained commands after provisioning" path.

**Failure policy**: a non-zero bootstrap command aborts the remaining chain and **skips daemon
auto-start** — a dev server on an unbootstrapped checkout would just burn its `max-restarts`
crash-looping, turning one clear failure into noise. The workspace stays ACTIVE and usable for
debugging (the failed `Command`'s log is right there); the failure is surfaced prominently on the
workspace (status chip / warning, over SSE), and the manual trigger restarts the chain.

The dogfood case shows why the ordering is load-bearing, not cosmetic: in a child-qits workspace
the `./mvnw install` bootstrap step **cannot run after** the `quarkus:dev` daemon is up — the
repo's own build guard fails any lifecycle build the moment something listens on :8080.
Bootstrap-then-daemons is the only order that works.

## UI

- **Repository configuration**: a "Bootstrap" section beside Actions/Daemons — an ordered,
  reorderable list; config-origin entries read-only with the `.qits-config` badge as usual.
- **Workspace detail**: a Bootstrap tab à la the Daemons tab — the configured commands in order,
  each with its last run state (skipped/succeeded/failed + timestamp, linking to the `Command`
  log), a "Run all" chain trigger and per-command re-run. While the chain runs the tab shows a
  dot (a failed last run shows a warning dot); freshness rides the workspace-SSE channel's new
  `bootstrap` topic. The provision-time chain additionally streams as named segments of the
  Start process (see the [technical-process log stream](../../qits-technical-processes/features/2026-07-18_technical-process-log-stream.md)).

## Dogfood & fixture impact

- **qits' own `.qits-config.yml`** gains the `bootstrap:` section above (install → `seed` →
  `seed-webapp`), so registering qits on a qits deployment yields a child that bootstraps its
  build and demo fixtures unattended — the `docs/guides/qits-in-qits-registration.md` walk drops
  its manual bootstrap steps. Here "seed" appears in its precise sense: two of qits' bootstrap
  steps happen to be seeds; the first is a build. (Both cli seeds are idempotent by design —
  skip-if-exists and reset — so re-provision and manual re-runs are safe.)
- **`qits-fixture-quarkus-angular`** gains a minimal check-guarded `bootstrap:` (one marker-file
  command; the `/tmp` marker dies with the container, so a fresh provision runs it and a re-run
  skips) — the small end-to-end regression carrier for ingestion + chain execution.
- **Tests**: `FakeContainerRuntime` runs real host processes, so the chain (order, check-skip,
  failure-aborts-and-blocks-autostart, manual re-run) is testable in the `domain` suite without
  docker; the reconciler tests grow a `bootstrap` arm.

## Resolved decisions

- **Own entity**, not a flag/column on `ActionConfiguration` — `BootstrapCommand` with
  first-class `orderIndex`, following the daemon pattern (own area, own config section, own UI
  surface).
- **Provision-only trigger** (plus the manual re-run surface); running on every cold start is out
  of scope.
- **Terminology: "bootstrap"** is the domain name — seeding is one specific bootstrap step (the
  one qits itself needs), not the general concept.
- **Failure ↔ auto-start coupling**: always skip auto-start on chain failure — no per-daemon or
  per-command `required` escape hatch. One clear failure beats a crash-looping dev server; the
  manual "Run all" is the recovery path.
- **Per-command timeout**: `qits.bootstrap.await-timeout-ms` (default 60 min) bounds each
  execute. Unlike `launchAndAwait`'s leave-running policy, a timed-out bootstrap command is
  **terminated** — a straggling install whose successors were aborted would only fight the
  re-run.
- **Config section name**: `bootstrap:` — reads as a process; the REST resource is the noun
  `/bootstrap-commands` (parallel to `/daemons`).
- **Provision-time kill switch**: `qits.bootstrap.autorun-enabled` (default true), mirroring
  `qits.daemons.autostart-enabled`; manual runs stay available when it's off.
