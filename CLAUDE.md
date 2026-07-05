# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Quarkus 3 (Java 25) backend for managing Git repositories, workspaces, and "feature flow" configurations, with an Angular UI served via Quarkus Quinoa. Maven multi-module under group `eu.wohlben`, base package `eu.wohlben.qits`:

- **`domain/`** — the shared business core as a plain library jar: entities, services (`control/`), persistence, MapStruct mappers, DTOs, custom validators, framework-free errors (`domain.error`), Flyway migrations. No web/JAX-RS deps. Consumers index its beans via `quarkus.index-dependency.domain.*`.
- **`service/`** — the Quarkus web app: REST controllers (`<area>.api`), exception mappers (`eu.wohlben.qits.api`), `mutiny`, `health`, and the Angular UI (Quinoa). Depends on `domain`.
- **`cli/`** — a Quarkus command-mode app (`@QuarkusMain` in `eu.wohlben.qits.cli.Main`) with no web stack. Depends on `domain`. Exposes `seed` (`SeedService`, the tiny `testing-repo` demo), `seed-webapp` (`SeedWebappService`, the servable Quarkus+Angular demo — idempotent by reset), and `generate-migration`.

Build and runtime both target **JDK 25** (`maven.compiler.release=25`; JVM Docker images use `ubi9/openjdk-25-runtime`; project JDK pinned via `.sdkmanrc`). Spotless (google-java-format) runs automatically on every build via the `process-sources` phase — google-java-format requires JDK 21+, so don't build on JDK 17.

## Commands

All Maven commands use the wrapper.

```bash
# First on a fresh checkout, build so the `domain` module is resolvable from the local repo:
./mvnw install -DskipTests

# Run dev mode (live-reload for Java + Angular, Quinoa dev server on :4200). Quarkus dev mode is
# workspace-aware, so edits to the `domain` module live-reload too.
./mvnw -pl service quarkus:dev

# Full build (all modules, frontend + backend)
./mvnw package

# Run all unit tests for a module
./mvnw -pl domain test       # service/business-logic tests
./mvnw -pl service test      # REST/controller, mutiny, health, validation, openapi tests
./mvnw -pl cli test          # seed command test

# Run a single test class / method (-am also builds the domain dep it needs)
./mvnw -pl domain -am test -Dtest=ProjectServiceTest
./mvnw -pl service -am test -Dtest=ProjectControllerTest#create

# Regenerate docs/openapi.yml (writes the file as a side effect — do not hand-edit openapi.yml)
./mvnw -pl service -am test -Dtest=OpenApiSchemaExportTest

# Native build + integration tests (failsafe; ITs are skipped by default via skipITs=true)
./mvnw -pl service package -Dnative

# Extended suite: heavier, environment-dependent integration tests (JUnit `*IT`, @Tag("extended")),
# e.g. the real-docker WorkspaceContainerIT. Skipped by every default build; opt in with -Pextended.
# ITs self-skip when their backend (docker + the qits/workspace image) is absent, so this is safe to
# run anywhere. Build the image first: `docker build -t qits/workspace docker/workspace`.
./mvnw verify -Pextended                       # full spectrum: unit tests + extended ITs
./mvnw -pl service verify -Pextended \
  -Dtest=__none__ -Dsurefire.failIfNoSpecifiedTests=false   # extended ITs only (skip unit tests)

# Seed demo data (project + branch tree incl. fast-forwardable/diverged workspaces) into the shared
# H2 file. One-step command-mode run, no web server (the cli pom binds quarkus:run's program args
# to the cli.args property). Idempotent (skip-if-exists).
./mvnw -pl cli quarkus:run -Dcli.args=seed

# Seed the servable Quarkus+Angular demo: a project + repo cloned from the testing-repo-quarkus-angular
# fixture, a web-viewable OTEL-enabled `quarkus:dev` daemon (LOG_LEVEL + PATTERN observers, a FILE log
# source), a `greeting` workspace, and a "Build & Verify" feature-flow blueprint. Exercises the
# stack-specific feature surface (framework detection, web view, observability, log observation,
# feature-flows, the coding agent) — the counterpart to `seed` (which owns git merge/divergence).
# Idempotent by RESET — re-running deletes and recreates the project, so it always returns to the same
# known-good state (use it as the fixture for manual UI poking and automated regression tests).
./mvnw -pl cli quarkus:run -Dcli.args=seed-webapp

# Generate a starter Flyway migration after changing entities (writes PENDING_MIGRATION.sql).
./mvnw install -DskipTests && ./mvnw -pl cli quarkus:run -Dcli.args=generate-migration
```

The **Maven Build Cache Extension** is enabled (`.mvn/extensions.xml` + `.mvn/maven-build-cache-config.xml`, local cache only at `~/.m2/build-cache`): unchanged modules restore from cache instead of rebuilding (compile, Spotless, tests, and the Quinoa pnpm/Angular build all skipped) — a no-op `install` is ~2s, and a cli-only change restores `service` so the frontend build is skipped. Granularity is **per module**, so any change to `service` (including anything under `src/main/webui/`) rebuilds all of it. The config restores each module's `target/classes` (not just the jar) — this is **required**: Quarkus resolves reactor siblings by their `target/classes` directory, so without it a module rebuilt while `domain` is restored fails Arc with mass "Unsatisfied dependency" for the domain beans (the cache-triggered form of the "clean before test" MapStruct gotcha). If you ever suspect a stale restore, bypass with `-Dmaven.build.cache.enabled=false` or reset via `rm -rf ~/.m2/build-cache`. See `docs/features/2026-07-05_maven-build-cache.md`.

The app runs on **H2 everywhere** — no Docker/Postgres needed. `service` and `cli` share one file-based H2 at a fixed, CWD-independent location (`${user.home}/.qits/data/h2/qits`, AUTO_SERVER) so the `cli` seed shows up in the running app; repos clone under `${user.home}/.qits/data/repositories`. **Tests** use in-memory H2 (each module's `src/test/resources/application.properties`; `domain` has no main config). The Postgres driver and the `docker-compose.yml` Postgres service are commented out — to switch back, uncomment `quarkus-jdbc-postgresql` in `domain/pom.xml`, restore the Postgres service in `docker-compose.yml`, and set `quarkus.datasource.*` back to postgresql. Flyway migrations live in `domain/src/main/resources/db/migration/` (on the classpath of both apps); see the Database migrations section for the `generate-migration` cli command that produces a starter.

## Architecture

### Package layout: domain-oriented BCE

Code is organized by **domain area**, each split into Boundary-Control-Entity layers. The boundary (`api/`, REST controllers) lives in the **`service`** module; everything else lives in the **`domain`** module — same `eu.wohlben.qits.domain.<area>` package roots, distinct sub-packages, so no split package:

```
eu.wohlben.qits.domain.<area>.
  api/          REST controllers (JAX-RS, the "boundary")     -> service module
  control/      @ApplicationScoped services, business logic    -> domain module
  entity/       Panache JPA entities + enums                   -> domain module
  persistence/  PanacheRepository implementations              -> domain module
  mapper/       MapStruct entity→DTO mappers                   -> domain module
  dto/          DTO records returned to clients                -> domain module
```

Domain areas: `project` (the aggregate root), `repository` (repos + workspaces + git execution), `featureflow` (configurations → phases → actions/steps). Also in `domain`: `validation` (custom Bean Validation), `domain.error` (framework-free exceptions). In `service`: `mutiny` (reactive endpoints + request-context propagation), `api` (global exception mappers), `health`.

### Conventions to follow when adding code

- **Controllers** declare nested `record`s per operation: a `XxxRequest` with an inner `Response` record (see `ProjectController`). Validate request bodies with `@Valid` + Bean Validation annotations. All REST endpoints are served under `/api` (`quarkus.rest.path=/api`); `@Path` values are relative to that.
- **Entities** use Panache active-record style: extend `PanacheEntityBase`, **public fields** (no getters/setters), accessed directly. IDs are `String` UUIDs generated in the service layer (`UUID.randomUUID().toString()`), not DB-generated.
- **Services** (in `domain`) are `@ApplicationScoped`, inject Panache repositories, and own `@Transactional` boundaries. For error responses they throw **`eu.wohlben.qits.domain.error`** exceptions (`NotFoundException`/`BadRequestException`/`InternalServerErrorException`, framework-free so `domain` needs no JAX-RS); `service`'s `DomainExceptionMapper` maps them to HTTP. Controllers may still throw `jakarta.ws.rs.*` directly (auto-mapped by Quarkus REST).
- **Mappers** are MapStruct interfaces annotated `@Mapper(componentModel = "jakarta")`. Implementations are generated at compile time (annotation processor); never hand-write the `*Impl`. Lombok + MapStruct are wired together via `lombok-mapstruct-binding`.
- **`Project` is the aggregate root.** Repositories and feature-flow configurations are created *under* a project (e.g. `POST /api/projects/{id}/repositories`) and cascade-deleted with it.

### Database migrations (Flyway)

Migrations live in `domain/src/main/resources/db/migration/` and run at startup (`migrate-at-start=true`) for whichever app (service or cli) boots. **Write migrations by hand.** To get a starter, after changing entities rebuild and run the cli `generate-migration` command:

```bash
./mvnw install -DskipTests
./mvnw -pl cli quarkus:run -Dcli.args=generate-migration
```

It applies the committed migrations to a throwaway in-memory H2, diffs the entity model against it (Hibernate `SchemaMigrator`), and writes the delta DDL to `PENDING_MIGRATION.sql` at the repo root (or prints "No schema changes"). Turn that into a proper hand-written `V#__name.sql` and delete `PENDING_MIGRATION.sql`. (Implemented in `cli`'s `GenerateMigrationService`, replacing the old `scripts/generate-flyway-migration.sh`.)

### Git operations

`repository.control.GitExecutor` shells out to the `git` CLI via `ProcessBuilder` — the only thing that mutates repositories. It runs against the on-disk **bare origins** (`<data-dir>/<repoId>/origin`, a `--mirror` clone) and throwaway host workspaces for integration; there is no longer a persistent host checkout per workspace. The one JGit use is a wire-protocol *server* only (below).

### Workspace containers (execution model)

Every workspace executes inside a **per-workspace Docker container** — the sole execution environment for action scripts, dev servers, daemons, and the coding agent (no host-execution fallback). See `docs/features/2026-07-04_workspace-containers.md`.

- `repository.control.ContainerRuntime` (impl `DockerExecutor`) is the sibling of `GitExecutor`: it shells the `docker` CLI (`docker run`/`exec`/`rm`, configurable via `qits.workspace.container-runtime`). A workspace is a branch ref in the bare origin **plus** a container that `git clone`s that branch into `/workspace` from qits' in-process git server.
- The in-process git server is JGit's `GitServlet` at `/git/*` (`service` module, `eu.wohlben.qits.githost`) — JGit speaks the smart-HTTP protocol only; `GitExecutor` stays the only mutator. Containers reach it via `http://host.docker.internal:<port>/git/<repoId>`.
- `Workspace.branch` is a **stored column** (no host checkout to read it from). Workspace-local git verbs (`status`, `fetch`+`merge`) run as `docker exec` in the container; `CommandRegistry`'s two spawn seams prepend a `docker exec` prefix; termination reads a pid file and `kill`s the in-container process group.
- **Build the fat default image locally** before running the app end-to-end: `docker build -t qits/workspace docker/workspace` (config `qits.workspace.image`). The container runs as your host uid.
- **Tests** don't need docker: `FakeContainerRuntime` (a Quarkus `@Mock` in each module's `src/test`) emulates a container as a host clone at the old workspace path. Because it runs real host processes, process-group termination works end-to-end. Tests that create branch divergence must **push** (origin-side ahead/behind/conflict probes only see pushed commits).
- **Caveat**: the `cli` `seed` command now creates containers + clones from the git server, so seeding requires the `service` running (reachable git host/port) and docker available.

### Frontend

The Angular app lives in `service/src/main/webui/` — Quinoa's default UI directory (previously a separate `qits-ui` repo, now merged in here). Quinoa **auto-detects** the framework (Angular) and package manager (pnpm, from `pnpm-lock.yaml`), and reads `angular.json` to derive the build output dir (`dist/qits-ui/browser`) — so no `quarkus.quinoa.build-dir` override is needed. Quinoa builds it and serves it with SPA routing; `/api` is excluded from SPA fallback (`quarkus.quinoa.ignored-path-prefixes=/api`). Dev mode proxies to the Angular dev server on `:4200`.

## Project documentation workflow (from AGENTS.md)

- Feature drafts live in `docs/feature-ideas/*.md`; once implemented they move to `docs/features/YYYY-MM-DD_*.md`.
- Parked follow-ups live in `docs/backlog-ideas/*.md`: fully written idea docs deliberately not being built yet, phrased as changes to their parent feature's **already-implemented** code (never as an alternative design), each naming a **Trigger** for when to pick it up. Distinct from `docs/backlog.md` (loose one-liner TODOs).
- Active bugs/issues are documented in `docs/issues/YYYY-MM-DD_*.md`; resolved ones move to `docs/issues/resolved/YYYY-MM-DD_*.md`. **Document bugs on encounter, proactively**: whenever you notice a bug during any task — even out of scope — write the issue doc immediately as part of that same task (observed repro, suspected cause with code pointers, suggested fix direction). Don't just flag it in your summary for review; the doc is the hand-off for later in-depth analysis. The current task's scope doesn't change.
- All of these docs must include an **Introduction** section listing related/dependent plans.
- Aim for full test coverage; add a regression test when fixing a bug. Tests are JUnit `*Test.java` classes.

## Test fixtures

`domain/src/test/resources/fixtures/` holds two **bare git repos committed as plain files** (reproducible, network-free clone/pull test data), each with a **gitignored editing checkout** beside it. The bare `*.git` repo is the source of truth; regenerate the checkout with `git clone <name>.git <name>`. The checkouts are plain clones (no longer git submodules), so a fresh `git clone` of qits needs no `--recurse-submodules`.

- **`testing-repo.git`** — a tiny repo (`hello.txt`, branches `master`/`feature`) for pure git mechanics: clone, pull, branch discovery, divergence probes, the JGit git host. Every test/seed reference resolves it via `getClass().getResource("/fixtures/testing-repo.git")`.
- **`testing-repo-quarkus-angular.git`** — a minimal but **servable** Quarkus 3 + Angular app (`POST /api/greetings` echoing `{name, timestamp}` + an Angular SPA served by Quinoa), shaped like qits itself, for demoing features that run real work in a workspace (dev-server daemons, actions, the coding agent). Branches: `main`, `feature/greeting` (fast-forwardable over `main`), `feature/diverged` (conflicts with `main`). Build/run it with its own committed `./mvnw` (JDK 25 + pnpm); it is **not** part of the qits Maven build. See `docs/features/2026-07-05_servable-quarkus-angular-fixture.md`.
