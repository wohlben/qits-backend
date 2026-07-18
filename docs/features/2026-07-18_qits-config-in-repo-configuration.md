# `.qits-config` — in-repo repository configuration

## Introduction

Everything qits knows about a repository beyond its git content — which actions ("commands")
exist, which daemons it can run, how their logs are observed, which stack it is — currently
lives as DB rows, entered through the UI or seeded by the cli. That configuration is invisible
to the repository itself: it can't be versioned, reviewed, or cloned along with the code, and a
freshly imported repository arrives blank.

This feature introduces a **`.qits-config.yml` file committed at the repository root** as the
declarative source for that configuration. When qits clones or syncs a repository, it reads the
file straight from the bare origin (no checkout needed) and reconciles the declared
configuration into the existing entities. The repository becomes self-describing: import it and
its actions, daemons, and stack declaration are just *there* — and a change to them is a commit
like any other.

### Related / Dependent Plans

- [`../features/2026-05-01_actions.md`](../features/2026-05-01_actions.md) +
  [`../features/2026-07-09_unified-action-scope.md`](../features/2026-07-09_unified-action-scope.md) —
  repository-scoped `ActionConfiguration` (nullable `repository_id`) is the target for declared
  actions; global actions stay UI/DB-only.
- [`../features/2026-07-04_daemons.md`](../features/2026-07-04_daemons.md),
  [`../features/2026-07-06_daemon-webview-configuration.md`](../features/2026-07-06_daemon-webview-configuration.md),
  [`../features/2026-07-04_daemon-log-observation-expansion.md`](../features/2026-07-04_daemon-log-observation-expansion.md),
  [`../features/2026-07-10_daemon-healthchecks.md`](../features/2026-07-10_daemon-healthchecks.md) —
  `RepositoryDaemon` with its embedded `WebView`, `LogObserver`/`LogSource` collections, and
  health checks is the richest declared object.
- [`../features/2026-07-14_workspace-submodule-support.md`](../features/2026-07-14_workspace-submodule-support.md) —
  `GitSubmoduleParser` established the exact read mechanism this feature reuses:
  `GitExecutor.showFile(bareOrigin, branch, path)`, absent file = empty config, never an error.
- [`../features/2026-07-12_backend-framework-detection.md`](../features/2026-07-12_backend-framework-detection.md) —
  detection stays the fallback; a `frameworks` section in the config becomes an explicit
  override/hint.
- [`../features/2026-07-05_servable-quarkus-angular-fixture.md`](../features/2026-07-05_servable-quarkus-angular-fixture.md) —
  the `testing-repo-quarkus-angular` fixture is the natural first carrier of a real
  `.qits-config.yml`; `seed-webapp` currently seeds the same shape programmatically.
- [`../features/2026-07-08_lazy-workspace-container-provisioning.md`](../features/2026-07-08_lazy-workspace-container-provisioning.md) —
  reading from the bare origin keeps config ingestion independent of containers, so it works at
  clone time and in the standalone cli seeds.

## Goals

1. A repository can declare its own configuration in a committed `.qits-config.yml`:
   actions, daemons (incl. web view, observers, log sources, health checks, environment,
   OTEL), main branch, archetype, and framework/stack hints.
2. Configuration is ingested automatically on clone and on sync of the main branch, plus via an
   explicit "reload config" trigger — no UI data entry needed for a well-configured repo.
3. Declared and UI-created configuration coexist: ingestion never touches rows the user created
   by hand.
4. A repository without the file behaves exactly as today (the file is optional; absent = empty).

## Non-Goals

1. **Write-back.** qits never writes `.qits-config.yml`. Editing declared config happens in git
   (in a workspace, via the coding agent, or anywhere else). The UI shows declared entities
   read-only.
2. **Branch-divergent config.** V1 reads the file from `mainBranch` only. Per-workspace config
   from the workspace's own branch is a follow-up (see below).
3. **Global/app config overrides.** `qits.workspace.image`, network, container runtime etc. stay
   global application config. A per-repository image override is a plausible extension but needs
   its own plumbing and trust story — out of scope.
4. **Project-scoped objects.** Feature-flow configurations hang off `Project`, not `Repository`;
   a repo file can't own them. (Follow-up: a repo could *contribute* a blueprint to its project.)
5. **Executing anything at ingest time.** Parsing and reconciling only; scripts still run where
   they run today (workspace containers).

## The file

`.qits-config.yml` at the repository root, YAML, with a `version: 1` discriminator. YAML over
properties/INI because daemons are deeply nested (web view, observer lists, env maps); the
extension keeps editor highlighting. Parsed with SnakeYAML into plain config records in
`domain` (new dependency of the `domain` module; no Quarkus config machinery involved — this is
repository content, not app config).

```yaml
version: 1

repository:
  main-branch: main          # optional; also the branch the file itself is read from
  archetype: SERVICE         # SERVICE | SERVICE_TEMPLATE | FORK

frameworks:                  # optional; overrides/augments FrameworkDetectionService
  - kind: JAVA_QUARKUS
    root: .
  - kind: TS_ANGULAR
    root: src/main/webui

actions:                     # -> repository-scoped ActionConfiguration
  - name: build-project
    description: Full package build
    execute: ./mvnw package
    check: |                 # optional check script (the "is this needed" contract)
      git diff --quiet HEAD -- pom.xml src/
    interactive: false
    environment:
      MAVEN_OPTS: -Xmx2g

daemons:                     # -> RepositoryDaemon
  - name: dev-server
    description: Quarkus dev mode with live reload
    start: ./mvnw quarkus:dev
    ready-pattern: "Listening on"
    otel: true
    auto-start: true
    restart-policy: ON_FAILURE
    max-restarts: 3
    stop-signal: TERM
    environment:
      QUARKUS_HTTP_HOST: 0.0.0.0
    web-view:
      port: 4200
      entry-path: /
    observers:
      - kind: LOG_LEVEL
      - kind: PATTERN
        pattern: "(?i)(BUILD FAILURE|Failed to start Quarkus)"
        severity: ERROR
    sources:
      - path: quarkus.log
        label: Quarkus dev log
    health-checks:
      - kind: HTTP
        port: 8080
        path: /q/health
```

Every field maps 1:1 onto an existing entity field (`ActionConfiguration`,
`RepositoryDaemon` + `WebView`/`LogObserver`/`LogSource`/`HealthCheck` embeddables), so the
schema is the entity model re-expressed — no new domain concepts.

## Reading the file

Mirror `GitSubmoduleParser` exactly: a new `QitsConfigParser` in `repository/control` calls

```java
git.showFile(originDir, branch, ".qits-config.yml")
```

against the bare origin (`<data-dir>/<repoId>/origin`). Non-zero exit = file absent = empty
config. No checkout, no container, works in the standalone cli — the same properties that made
the `.gitmodules` reader container-free.

The bootstrap branch question resolves itself: on clone the file is read from the remote's
default branch (what `mainBranch` is initialized to today); if the file declares a different
`main-branch`, that is applied and the file is re-read from there once. Afterwards it is always
read from the current `mainBranch`.

## Reconciliation model

Declared config is **upserted into the existing tables**, not held in a parallel store —
`Command` audit rows snapshot `actionId`, `FeatureFlowPhaseAction` binds
`action_configuration_id`, and the daemon supervisor drives `RepositoryDaemon` rows, so DB rows
must exist either way.

- New column on `ActionConfiguration` and `RepositoryDaemon`: `origin` (`UI` | `CONFIG`),
  default `UI` for all existing rows (Flyway migration).
- Reconcile keyed by `name` within the repository, only over rows with `origin = CONFIG`:
  declared-and-present → update in place (same id, so feature-flow bindings and command history
  survive); declared-and-absent → insert; present-but-undeclared → delete (for a daemon: stop it
  first via the existing supervisor stop path).
- Rows with `origin = UI` are never touched. A name collision between a UI row and a declared
  entry is a validation warning; the UI row wins and the declared entry is skipped (predictable,
  and nothing the user made ever disappears).
- Triggers: repository clone, sync/fetch of `mainBranch`, and a manual
  `POST /api/.../repositories/{id}/config/reload`.

**Validation:** parsed records go through Bean Validation plus the existing
`DaemonDefinitionValidator`. An invalid file (or invalid single entry) never fails the
clone/sync — the last-good DB state is kept and the problems surface as a repository-level
warning (stored on the repository, shown in the detail view), the same "degrade loudly, don't
block" posture as detection.

**UI:** declared entities render with a "from .qits-config" badge and read-only forms; the edit
affordance deep-links to the file in the workspace file browser instead.

**Frameworks section:** unlike actions/daemons this maps to nothing stored — `DetectionService`
consults the declared list first and falls back to marker-based detection for anything not
declared. Purely a read-path override, no reconciliation.

## Fixture & seed impact

`qits-fixture-quarkus-angular` gains a committed `.qits-config.yml` declaring exactly what
`SeedWebappService` builds programmatically today (the OTEL `quarkus:dev` daemon with LOG_LEVEL
+ PATTERN observers and the `quarkus.log` FILE source, the build/lint/test actions).
`seed-webapp` then shrinks to: create project, import repo (config ingested on clone), create
workspace, bind the feature flow — and doubles as the end-to-end regression test for ingestion.
Note the two-level editing round-trip for that fixture (commit in the fixture repo → bump the
gitlink in qits) applies.

## Status — implemented 2026-07-18

Built and tested (`domain` + `service` suites green):

- **Parser** `QitsConfigParser` (mirrors `GitSubmoduleParser`) → `QitsConfig` record tree, SnakeYAML
  safe-load; absent file / read failure = empty, structural errors throw and surface as a warning.
- **Reconciler** `QitsConfigReconciler.ingest/reload` — upserts declared actions/daemons into the
  existing tables via new declarative `upsertFromConfig` methods on `ActionConfigurationService` /
  `RepositoryDaemonService` (full-overwrite, stable ids, validation reused). Hooked into
  `RepositoryService.cloneOne` (clone) and `pullRepository` (sync); manual
  `POST /api/repositories/{id}/config/reload`.
- **Repository fields** `main-branch`/`archetype` reconcile (file wins; branch re-read once).
- **Frameworks override** merged in `DetectionService.scan` via `FrameworkDetectionService.descriptorById`.
- **Warning** stored in new `Repository.configWarning` column (Flyway `V34`), shown in the repo
  detail view; ingestion never fails the clone/sync.
- **UI** — repo-detail config-warning banner + "Reload config" button; config-origin actions/daemons
  render read-only with a `.qits-config` badge (`shared/utils/config-origin.ts`).
- **Fixture & seed** — `testing-repo-quarkus-angular` now ships a committed `.qits-config.yml`
  declaring the `quarkus:dev` daemon + build/lint/test + `Stack info` actions; `SeedWebappService`
  shrank to create-project → import (ingest) → workspace → bind the feature flow (looking the
  ingested actions up by their `@qits-config`-suffixed names). `seed-webapp` doubles as the
  end-to-end ingestion regression (`SeedWebappServiceTest`).

### Resolved decisions

- **File name:** `.qits-config.yml`.
- **`main-branch`/`archetype`:** the file wins (reconciled every sync), shown config-managed.
- **Collision policy (changed from skip-and-warn):** declared entries are namespaced with the
  reserved suffix **`@qits-config`** on their stored `name`; the write API rejects that suffix in
  user-supplied names. Config and UI names can therefore never collide, and `origin` (`UI`/`CONFIG`)
  is **derived from the name suffix** — no `origin` column on the action/daemon tables. Because
  reconciliation is declarative and re-runs on sync, an accidental UI edit to a config-origin entry
  self-heals on the next ingest (the UI renders them read-only regardless).

## Open questions

- File name: `.qits-config.yml` (chosen) vs literal extensionless `.qits-config` vs a `.qits/`
  directory (room for future per-concern files). Single file until it hurts.

## Follow-ups (not v1)

- **Branch-divergent config:** read the file from the *workspace's* branch so a feature branch
  can carry modified daemons/actions — including the coding agent editing its own runtime
  definition. Powerful, but needs per-workspace daemon definitions and a merge/precedence story.
- **Project contribution:** a repo declaring a feature-flow blueprint contributed to its
  project.
- **Per-repository container image** (`qits.workspace.image` override) — needs a trust decision,
  since repo content would then pick the execution image.
- **Config scaffolding:** an action/endpoint that exports a repository's current UI-created
  config as a ready-to-commit `.qits-config.yml` (the migration path; deliberately not
  write-back).
