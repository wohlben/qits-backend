# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Quarkus 3 (Java 25) backend for managing Git repositories, workspaces, and "feature flow" configurations, with an Angular UI served via Quarkus Quinoa. Maven multi-module under group `eu.wohlben`, base package `eu.wohlben.qits`:

- **`domain/`** — the shared business core as a plain library jar: entities, services (`control/`), persistence, MapStruct mappers, DTOs, custom validators, framework-free errors (`domain.error`), Flyway migrations. No web/JAX-RS deps. Consumers index its beans via `quarkus.index-dependency.domain.*`.
- **`service/`** — the Quarkus web app: REST controllers (`<area>.api`), exception mappers (`eu.wohlben.qits.api`), `mutiny`, `health`, and the Angular UI (Quinoa). Depends on `domain` + exactly one auth variant module (below). Contains **no auth code** itself.
- **`auth/core`, `auth/oidc`, `auth/forwardauth`** — build-variant auth as library jars (`docs/epics/qits-authentication/features/2026-07-16_build-variant-auth.md`). **Every service build that produces an artifact must name a variant with `-Dqits.variant=forwardauth|oauth`** (maven-enforcer at `prepare-package` fails flagless `package`/`install`/`verify`); flagless **pre-packaging** work — `quarkus:dev`, `test` — defaults to forwardauth via the `variant-default-forwardauth` profile (activated on `!qits.variant`), i.e. effectively no auth in dev — the matching profile in `service/pom.xml` pulls in `auth-forwardauth` (trust forward-auth proxy headers; the everyday dev/test variant — its `%dev`/`%test` fallback identity `dev` keeps dev mode and the test suites friction-free) or `auth-oidc` (built-in Keycloak OIDC; the service test suite does NOT run under this variant — its coverage lives in `auth/oidc`'s own tests). `auth-core` (the always-on `QitsAuthPolicy`, the `PublicPaths` token-free list, `/api/auth/me`) arrives transitively. The auth modules ship config defaults in `META-INF/microprofile-config.properties` (read from dependency jars, unlike application.properties) and are bean-discovered via jandex-maven-plugin indexes, not `quarkus.index-dependency`.
- **`cli/`** — a Quarkus command-mode app (`@QuarkusMain` in `eu.wohlben.qits.cli.Main`) with no web stack. Depends on `domain` (no auth — the variant flag is never needed for cli-only commands). Exposes `seed` (`SeedService`, the tiny `testing-repo` demo), `seed-webapp` (`SeedWebappService`, the servable Quarkus+Angular demo — idempotent by reset), and `generate-migration`.

Build and runtime both target **JDK 25** (`maven.compiler.release=25`; JVM Docker images use `ubi9/openjdk-25-runtime`; project JDK pinned via `.sdkmanrc`). Spotless (google-java-format) runs automatically on every build via the `process-sources` phase — google-java-format requires JDK 21+, so don't build on JDK 17.

## Commands

All Maven commands use the wrapper.

```bash
# Auth build variant (docs/epics/qits-authentication/features/2026-07-16_build-variant-auth.md): builds that PACKAGE the
# `service` module (package/install/verify) must name it with -Dqits.variant=forwardauth|oauth —
# the enforcer message reminds you if it's missing. Flagless quarkus:dev and test default to
# forwardauth (dev fallback identity, effectively no auth). Module-scoped builds that skip service
# (-pl domain, -pl cli, -pl auth/…) never need the flag.

# First on a fresh checkout, build so the `domain` module is resolvable from the local repo:
./mvnw install -DskipTests -Dqits.variant=forwardauth

# Run dev mode (live-reload for Java + Angular, Quinoa dev server on :4200). `-am` builds the domain
# + auth deps first (so the standalone `service` resolves them) and `workspace-discovery=true` makes
# dev mode reactor-aware, so edits to the `domain`/`auth/*` modules live-reload too. Flagless runs
# default to forwardauth (dev identity `dev`, effectively no auth); with -Dqits.variant=oauth,
# Keycloak Dev Services auto-starts a Keycloak container (alice/alice, bob/bob) and dev mode gets
# the real login wall.
#
# NOTE: to actually exercise workspace containers / the daemon web view, run this INSIDE the
# `.devcontainer/` (VS Code "Reopen in Container" or `devcontainer up`), so qits sits on the shared
# `qits-net` and reaches workspace containers by DNS name (no host-port publishing). The command is
# the same, just in the devcontainer's terminal. See the Workspace containers section.
./mvnw -pl service -am quarkus:dev -Dquarkus.bootstrap.workspace-discovery=true

# Full build (all modules, frontend + backend)
./mvnw package -Dqits.variant=forwardauth

# Run all unit tests for a module
./mvnw -pl domain test       # service/business-logic tests
./mvnw -pl service test      # REST/controller, mutiny, health, validation, openapi tests — flagless
                             # defaults to forwardauth, the ONLY variant the suite runs under (under
                             # oauth every @QuarkusTest fails startup for the missing auth-server-url)
./mvnw -pl cli test          # seed command test
./mvnw -pl auth/core test && ./mvnw -pl auth/oidc test && ./mvnw -pl auth/forwardauth test  # auth suites

# Run a single test class / method (-am also builds the deps it needs)
./mvnw -pl domain -am test -Dtest=ProjectServiceTest
./mvnw -pl service -am test -Dtest=ProjectControllerTest#create

# Regenerate docs/openapi.yml (writes the file as a side effect — do not hand-edit openapi.yml).
# The export is variant-independent (AuthController lives in auth-core; the OpenAPI title is pinned).
./mvnw -pl service -am test -Dtest=OpenApiSchemaExportTest

# Native build + integration tests (failsafe; ITs are skipped by default via skipITs=true)
./mvnw -pl service package -Dnative -Dqits.variant=forwardauth

# Extended suite: heavier, environment-dependent integration tests (JUnit `*IT`, @Tag("extended")),
# e.g. the real-docker WorkspaceContainerIT. Skipped by every default build; opt in with -Pextended.
# ITs self-skip when their backend (docker + the qits/workspace image) is absent, so this is safe to
# run anywhere. Build the image first:
# `docker build -t qits/workspace --target workspace -f docker/qits/Dockerfile .`
./mvnw verify -Pextended -Dqits.variant=forwardauth       # full spectrum: unit tests + extended ITs
./mvnw -pl service verify -Pextended -Dqits.variant=forwardauth \
  -Dtest=__none__ -Dsurefire.failIfNoSpecifiedTests=false   # extended ITs only (skip unit tests)

# Seed demo data (project + branch tree incl. fast-forwardable/diverged workspaces) into the shared
# H2 file. One-step command-mode run, no web server (the cli pom binds quarkus:run's program args
# to the cli.args property). NOTE: quarkus:run executes the packaged cli/target/quarkus-app/
# quarkus-run.jar but does not build it, and any `test` run of the cli module DELETES that dir
# (Quarkus clears the fast-jar output during test augmentation) — so after test-only builds, re-run
# `./mvnw install -DskipTests -Dqits.variant=forwardauth` first (or `-pl cli -am install`, which
# skips service and needs no variant) or the seed fails with "Unable to access jarfile".
# Idempotent (skip-if-exists). Runs STANDALONE — seeding is pure
# host-side data setup (rows + branch refs + host-side merges); workspace containers are
# provisioned lazily on first use, so no docker and no running service are needed here.
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
./mvnw -pl cli -am install -DskipTests && ./mvnw -pl cli quarkus:run -Dcli.args=generate-migration
```

The **Maven Build Cache Extension** is enabled (`.mvn/extensions.xml` + `.mvn/maven-build-cache-config.xml`, local cache only, sibling to the local Maven repo): unchanged modules restore from cache instead of rebuilding (compile, Spotless, tests, and the Quinoa pnpm/Angular build all skipped) — a no-op `install` is ~2s, and a cli-only change restores `service` so the frontend build is skipped. Granularity is **per module**, so any change to `service` (including anything under `src/main/webui/`) rebuilds all of it. The config restores each module's `target/classes` (not just the jar) — this is **required**: Quarkus resolves reactor siblings by their `target/classes` directory, so without it a module rebuilt while `domain` is restored fails Arc with mass "Unsatisfied dependency" for the domain beans (the cache-triggered form of the "clean before test" MapStruct gotcha). If you ever suspect a stale restore, bypass with `-Dmaven.build.cache.enabled=false` or reset via `rm -rf $(./mvnw help:evaluate -Dexpression=settings.localRepository -q -DforceStdout)/../build-cache`. **All modules cache normally, including `domain`.** (A mass "Unsatisfied dependency for every domain mapper bean" at `quarkus:dev` startup was once blamed on a stale `domain` cache restore and briefly "fixed" by excluding `domain` from the cache — but the real culprit was the IDE language server clobbering `domain/target/classes`; see the IDE note below. The cache restore of `domain` is complete and correct, so the exclusion was reverted.) See `docs/epics/qits-build-setup/features/2026-07-05_maven-build-cache.md`.

**IDE / language-server output is kept out of `target/`.** redhat.java (VS Code) and Claude Code's bundled jdtls both import via m2e, whose Eclipse output directory defaults to the **same `target/classes`** Maven and `quarkus:dev` use. A briefly-incomplete LS model (e.g. right after a `mvn clean`, or mid re-index) makes its background compiler write half-resolved `*.class` stubs there — surfacing either as `java.lang.Error: Unresolved compilation problems` (broken Lombok `@Builder`, on edit) or as mass Arc "Unsatisfied dependency" for domain mapper beans (broken/incomplete `*MapperImpl`, at startup). The root pom's `m2e-separate-output` profile fixes this client-agnostically: it activates **only** under m2e (via the `m2e.version` user property m2e-core sets on every resolve) and relocates the whole build directory to `target-ide/`, so the LS owns `target-ide/` while Maven/`quarkus:dev` keep exclusive ownership of `target/`. It relocates `<directory>` (not `<outputDirectory>`, which a profile can't set and whose property-indirected form the Quarkus dev mojo can't resolve for reactor hot-reload deps). If the IDE still shows stale errors, reload the window so the LS re-imports.

**Never build the reactor while a `quarkus:dev` is running** — the concurrent recompile of the shared `target/classes` wedges dev with the same mass "Unsatisfied dependency for domain beans". A build guard (`maven-antrun-plugin` in the root pom) enforces this: `clean`/`install`/`test`/`package` **fail fast at `pre-clean`** if something is listening on the dev port (`qits.dev-guard.port`, default 8080), with a message telling you to stop dev first. The `quarkus:dev`/`quarkus:run` goals don't run the lifecycle, so they and the `cli seed` (which may run while the service is up) are never blocked. Stop dev before building: `pkill -f quarkus:dev; pkill -f 'target/.*-dev.jar'` (the second kills the forked dev JVM, orphaned if you `-9` the launcher). Bypass the guard with `-Dqits.dev-guard.skip=true` (CI, or when `:8080` is a non-dev process).

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
./mvnw -pl cli -am install -DskipTests
./mvnw -pl cli quarkus:run -Dcli.args=generate-migration
```

It applies the committed migrations to a throwaway in-memory H2, diffs the entity model against it (Hibernate `SchemaMigrator`), and writes the delta DDL to `PENDING_MIGRATION.sql` at the repo root (or prints "No schema changes"). Turn that into a proper hand-written `V#__name.sql` and delete `PENDING_MIGRATION.sql`. (Implemented in `cli`'s `GenerateMigrationService`, replacing the old `scripts/generate-flyway-migration.sh`.)

### Git operations

`repository.control.GitExecutor` shells out to the `git` CLI via `ProcessBuilder` — the only thing that mutates repositories. It runs against the on-disk **bare origins** (`<data-dir>/<repoId>/origin`, a `--mirror` clone) and throwaway host workspaces for integration; there is no longer a persistent host checkout per workspace. The one JGit use is a wire-protocol *server* only (below).

### Workspace containers (execution model)

Every workspace executes inside a **per-workspace Docker container** — the sole execution environment for action scripts, dev servers, daemons, and the coding agent (no host-execution fallback). See `docs/epics/qits-workspaces/features/2026-07-04_workspace-containers.md`.

- `repository.control.ContainerRuntime` (impl `DockerExecutor`) is the sibling of `GitExecutor`: it shells the `docker` CLI (`docker run`/`exec`/`rm`, configurable via `qits.workspace.container-runtime`). A workspace is a branch ref in the bare origin **plus** a container that `git clone`s that branch into `/workspace` from qits' in-process git server — the container **provisioned lazily on first use** (`WorkspaceService.ensureContainer`): creation writes only the branch ref + the `STOPPED` row, and any access path materializes (or re-materializes) the container on demand. See `docs/epics/qits-workspaces/features/2026-07-08_lazy-workspace-container-provisioning.md`.
- **One shared Docker network (`qits-net`).** qits and every workspace container join it (`DockerExecutor` adds `--network`, creates the net if absent, config `qits.workspace.network`); qits reaches a container's ports by its **DNS name** with **no host-port publishing** (`ContainerRuntime.resolveTarget` → `ProxyOrigin`, consumed by the daemon web-view proxy `DaemonProxyRoute`). This is why qits itself runs in a container — the **`.devcontainer/`** (extends `docker/workspace` + docker CLI, alias `qits`, mounts the socket + source + `~/.qits`, forwards 8080/4200). See `docs/epics/qits-live-deployment/features/2026-07-07_qits-net-devcontainer-unification.md`. Container→qits (git/OTLP/MCP) uses the alias too: the devcontainer sets `qits.workspace.git-host=qits`.
- The in-process git server is `githost/GitHostRoutes` at `/git/*` (`service` module, `eu.wohlben.qits.githost`) — plain **Vert.x routes** driving JGit's `UploadPack`/`ReceivePack` directly, deliberately **not** a servlet. (It was JGit's `GitServlet` on `quarkus-undertow`, but undertow's presence breaks Quinoa's production static serving of the Angular SPA — see `docs/issues/resolved/2026-07-15_packaged-spa-not-served.md` — so the git host stays off the servlet stack; the service module carries **no servlet container**.) JGit speaks the smart-HTTP protocol only; `GitExecutor` stays the only mutator. Containers reach it via `http://<QitsHostResolver.qitsHost()>:<port>/git/<repoId>` — the `qits` alias on `qits-net` in the devcontainer, else `host.docker.internal`/WSL2 eth0 when qits runs on the host.
- `Workspace.branch` is a **stored column** (no host checkout to read it from). Workspace-local git verbs (`status`, `fetch`+`merge`) run as `docker exec` in the container; `CommandRegistry`'s two spawn seams prepend a `docker exec` prefix; termination reads a pid file and `kill`s the in-container process group.
- **Build the fat default image locally** before running the app end-to-end: `docker build -t qits/workspace --target workspace -f docker/qits/Dockerfile .` (config `qits.workspace.image`; the `workspace` stage of the single docker/qits/Dockerfile, which also holds the prod app image's stages). The container runs as your host uid.
- **Tests** don't need docker: `FakeContainerRuntime` (a Quarkus `@Mock` in each module's `src/test`) emulates a container as a host clone at the old workspace path. Because it runs real host processes, process-group termination works end-to-end. Tests that create branch divergence must **push** (origin-side ahead/behind/conflict probes only see pushed commits).
- **Seeding is pure host-side data setup** (rows, branch refs, host-side worktree merges — daemons are definitions only): the `cli` `seed`/`seed-webapp` commands run standalone, with no docker and no running service. Docker + the git server are needed only when a container actually materializes — on first use, via `ensureContainer`.

### Frontend

The Angular app lives in `service/src/main/webui/` — Quinoa's default UI directory (previously a separate `qits-ui` repo, now merged in here). Quinoa **auto-detects** the framework (Angular) and package manager (pnpm, from `pnpm-lock.yaml`), and reads `angular.json` to derive the build output dir (`dist/qits-ui/browser`) — so no `quarkus.quinoa.build-dir` override is needed. Quinoa builds it and serves it with SPA routing; `/api` is excluded from SPA fallback (`quarkus.quinoa.ignored-path-prefixes=/api`). Dev mode proxies to the Angular dev server on `:4200`.

## Project documentation workflow (from AGENTS.md)

- Feature drafts live in `docs/feature-ideas/*.md`; once implemented they move to `docs/features/YYYY-MM-DD_*.md`.
- Multi-document features are **epics** (`docs/epics/<name>/`): `epic.md` is the spine (deliverable, parts, dependency/implementation order, status — updated in place as parts land) over ordinary feature drafts in `<name>/feature-ideas/*.md`, each moving to `<name>/features/YYYY-MM-DD_*.md` when implemented; the epic is done only when all parts are. Epics may build on other epics — stated in `epic.md`, not duplicated (`qits-userflows` builds on the `qits-artifactory` backbone). First occupants: `docs/epics/qits-artifactory/`, `docs/epics/qits-userflows/`. **This ordering is the default going forward**: each new domain/deliverable gets its own `docs/epics/<name>/` sub-directory, even single-part ones; the flat `docs/feature-ideas/`/`docs/features/` stay for pre-existing docs and true standalone one-offs, and a flat draft growing a second document is the signal to promote both into an epic. Epics may also be **retroactive/umbrella** — gathering a domain's already-implemented features under one `epic.md` with a scope rule (e.g. `qits-workspace-detail` owns the detail route's frontend/tabs; generally-applicable backends it consumes stay flat). First umbrella: `docs/epics/qits-workspace-detail/`.
- Durable how-to guides live in `docs/guides/*.md` (no date prefix): the *current* contract, updated in place when a feature changes it — the change that breaks a guide updates it in the same commit. First occupant: `docs/guides/quarkus-angular-integration.md`.
- Technical examples/references live in `docs/technical/examples/*.md` (no date prefix): standing how-we-use-X reference for a framework building block/pattern, owned by no domain epic and updated in place (e.g. `mutiny-reactive-programming.md`, `request-validation.md`). Use instead of a dated `docs/features/` doc or a forced epic when a doc is a technical reference, not a shipped-feature record.
- Manual acceptance plans live in `docs/manual-acceptance-tests/<domain>/<plan>/plan.md` (+ optional sister documents): scripted E2E walks against a realistically deployed qits (packaged images, real containers/browsers) — what the automated suites can't cover. Updated in place like guides; see `docs/manual-acceptance-tests/CLAUDE.md`.
- Parked follow-ups live in `docs/backlog-ideas/*.md`: fully written idea docs deliberately not being built yet, phrased as changes to their parent feature's **already-implemented** code (never as an alternative design), each naming a **Trigger** for when to pick it up. Distinct from `docs/backlog.md` (loose one-liner TODOs).
- Active bugs/issues are documented in `docs/issues/YYYY-MM-DD_*.md`; resolved ones move to `docs/issues/resolved/YYYY-MM-DD_*.md`. **Document bugs on encounter, proactively**: whenever you notice a bug during any task — even out of scope — write the issue doc immediately as part of that same task (observed repro, suspected cause with code pointers, suggested fix direction). Don't just flag it in your summary for review; the doc is the hand-off for later in-depth analysis. The current task's scope doesn't change.
- All of these docs must include an **Introduction** section listing related/dependent plans.
- Aim for full test coverage; add a regression test when fixing a bug. Tests are JUnit `*Test.java` classes.

## Test fixtures

`domain/src/test/resources/fixtures/` holds git test fixtures in **two forms**: a set of tiny **bare repos committed as plain files** (the `submodule-*.git` family) and three **git submodules** pointing at standalone `github.com/wohlben/qits-fixture-*` repos. A fresh checkout therefore needs `git clone --recurse-submodules` (and nested — `qits-fixture-quarkus-angular` itself pulls `qits-fixture-angular`). Tests and seeds still resolve each fixture as a *bare* `getResource("/fixtures/<name>.git")`; the build **derives those bares** from the submodule working trees into `target/test-classes/fixtures/` via `scripts/derive-fixture-bares.sh` (a `runAlways` maven-antrun step, so a cache hit still recreates them — all offline, from the submodules' already-fetched refs). See `docs/epics/qits-testing-fixtures/features/2026-07-14_fixture-repos-split-and-submodules.md`.

- **`testing-repo`** *(submodule → `wohlben/qits-fixture-testing-repo`, derived bare `testing-repo.git`)* — a tiny repo (`hello.txt`, branches `master`/`feature`) for pure git mechanics: clone, pull, branch discovery, divergence probes, the JGit git host. Every test/seed reference resolves it via `getClass().getResource("/fixtures/testing-repo.git")`.
- **`testing-repo-angular`** *(submodule → `wohlben/qits-fixture-angular`, derived bare **`qits-fixture-angular.git`**)* — the Angular SPA on its own: an **Angular-only workspace** fixture (framework detection = Angular, SPA capture button / OPTIONS-gated availability, `withQitsSnapshot` state capture, `@qits/angular` consumption — no backend). Branches `main`, `feature/greeting` (FF, the welcome-note change), `feature/diverged` (conflict). The derived bare is named `qits-fixture-angular.git` (not `testing-repo-angular.git`) so the quarkus-angular fixture's `.gitmodules` relative url `../qits-fixture-angular.git` resolves against it offline during qits' recursive submodule import.
- **`testing-repo-quarkus-angular`** *(submodule → `wohlben/qits-fixture-quarkus-angular`, derived bare `testing-repo-quarkus-angular.git`)* — a minimal but **servable** Quarkus 3 + Angular app (`POST /api/greetings` echoing `{name, timestamp}` + an Angular SPA served by Quinoa), shaped like qits itself, for demoing features that run real work in a workspace (dev-server daemons, actions, the coding agent). Its `src/main/webui` is itself a **nested submodule → `qits-fixture-angular`** (relative url `../qits-fixture-angular.git`); qits imports it as a sibling repository and materializes it offline on qits-net. The SPA is the reference implementation of the SPA-observability convention: `GET /api/config.json` identity relay, `POST /api/otel/v1/*` OTLP passthrough, and an SPA instrumented via the **`@qits/angular` library** (a SHA-pinned git dependency on `github.com/wohlben/qits-angular-integration` — the fixture is its reference consumer; `docs/epics/qits-observability/features/2026-07-06_spa-observability.md`, `docs/epics/qits-integration-angular/features/2026-07-13_qits-angular-integration-library.md`), including a `GreetingHistoryStore` (`@ngrx/signals`) tagged `withQitsSnapshot('greetingHistory')` so captures carry app state (`docs/epics/qits-integration-angular/features/2026-07-14_capture-state-snapshot.md`). Branches: `main`, `feature/greeting` (FF gitlink advance over `main`), `feature/diverged` (gitlink conflict) — the greeting divergence now rides the `webui` submodule pointer, backend text identical. Build/run it with its own committed `./mvnw` (JDK 25 + pnpm) after `git submodule update --init`; it is **not** part of the qits Maven build. See `docs/epics/qits-testing-fixtures/features/2026-07-05_servable-quarkus-angular-fixture.md`. **Editing round-trip is two-level**: commit+push in `qits-fixture-angular` → bump the `webui` gitlink in `qits-fixture-quarkus-angular` → bump that gitlink in qits.
- **`submodule-*.git`** — a family of tiny bare repos (committed as plain files, loose refs) exercising **workspace submodule support** (`docs/epics/qits-project-repository-submodules/features/2026-07-14_workspace-submodule-support.md` — import is user-driven layer by layer: a creation toggle imports DIRECT submodules as sibling repositories, the repository detail view's "import submodules" action goes one level deeper per invocation, and workspace containers materialize exactly the imported edge closure level by level): `submodule-super.git` declares relative-url submodules (`../submodule-child-a.git`, `../submodule-shared.git`) forming a diamond + depth over `submodule-child-a.git`/`submodule-shared.git`/`submodule-grandchild.git` (also drives the depth-2 real-docker materialization IT); `submodule-cycle-a.git`/`-cycle-b.git` are a mutual pair proving a cycle just links back to the existing row; `submodule-simple-super.git` has a single leaf submodule (the single-level materialization IT). Regenerate with the script that produced them if their shape must change; gitlinks point at real child tips so `submodule update` can check them out. No editing checkouts (so nothing new is gitignored).
