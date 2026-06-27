# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Quarkus 3 (Java 25) backend for managing Git repositories, worktrees, and "feature flow" configurations, with an Angular UI served via Quarkus Quinoa. Maven multi-module under group `eu.wohlben`, base package `eu.wohlben.qits`:

- **`domain/`** — the shared business core as a plain library jar: entities, services (`control/`), persistence, MapStruct mappers, DTOs, custom validators, framework-free errors (`domain.error`), Flyway migrations. No web/JAX-RS deps. Consumers index its beans via `quarkus.index-dependency.domain.*`.
- **`service/`** — the Quarkus web app: REST controllers (`<area>.api`), exception mappers (`eu.wohlben.qits.api`), `mutiny`, `health`, and the Angular UI (Quinoa). Depends on `domain`.
- **`cli/`** — a Quarkus command-mode app (`@QuarkusMain` in `eu.wohlben.qits.cli.Main`) with no web stack. Depends on `domain`. Currently exposes a `seed` command (see `SeedService`).

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

# Seed demo data (project + branch tree incl. fast-forwardable/diverged worktrees) into the shared
# H2 file. One-step command-mode run, no web server (the cli pom binds quarkus:run's program args
# to the cli.args property). Idempotent.
./mvnw -pl cli quarkus:run -Dcli.args=seed
```

The app runs on **H2 everywhere** — no Docker/Postgres needed. `service` and `cli` share one file-based H2 at a fixed, CWD-independent location (`${user.home}/.qits/data/h2/qits`, AUTO_SERVER) so the `cli` seed shows up in the running app; repos clone under `${user.home}/.qits/data/repositories`. **Tests** use in-memory H2 (each module's `src/test/resources/application.properties`; `domain` has no main config). The Postgres driver and the `docker-compose.yml` Postgres service are commented out — to switch back, uncomment `quarkus-jdbc-postgresql` in `domain/pom.xml`, restore the Postgres service in `docker-compose.yml`, and set `quarkus.datasource.*` back to postgresql. Flyway migrations live in `domain/src/main/resources/db/migration/` (on the classpath of both apps); they're written to be portable, but `generate-flyway-migration.sh` may emit Postgres-dialect DDL, so hand-edit a generated migration for H2 portability when that happens.

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

Domain areas: `project` (the aggregate root), `repository` (repos + worktrees + git execution), `featureflow` (configurations → phases → actions/steps). Also in `domain`: `validation` (custom Bean Validation), `domain.error` (framework-free exceptions). In `service`: `mutiny` (reactive endpoints + request-context propagation), `api` (global exception mappers), `health`.

### Conventions to follow when adding code

- **Controllers** declare nested `record`s per operation: a `XxxRequest` with an inner `Response` record (see `ProjectController`). Validate request bodies with `@Valid` + Bean Validation annotations. All REST endpoints are served under `/api` (`quarkus.rest.path=/api`); `@Path` values are relative to that.
- **Entities** use Panache active-record style: extend `PanacheEntityBase`, **public fields** (no getters/setters), accessed directly. IDs are `String` UUIDs generated in the service layer (`UUID.randomUUID().toString()`), not DB-generated.
- **Services** (in `domain`) are `@ApplicationScoped`, inject Panache repositories, and own `@Transactional` boundaries. For error responses they throw **`eu.wohlben.qits.domain.error`** exceptions (`NotFoundException`/`BadRequestException`/`InternalServerErrorException`, framework-free so `domain` needs no JAX-RS); `service`'s `DomainExceptionMapper` maps them to HTTP. Controllers may still throw `jakarta.ws.rs.*` directly (auto-mapped by Quarkus REST).
- **Mappers** are MapStruct interfaces annotated `@Mapper(componentModel = "jakarta")`. Implementations are generated at compile time (annotation processor); never hand-write the `*Impl`. Lombok + MapStruct are wired together via `lombok-mapstruct-binding`.
- **`Project` is the aggregate root.** Repositories and feature-flow configurations are created *under* a project (e.g. `POST /api/projects/{id}/repositories`) and cascade-deleted with it.

### Database migrations (Flyway)

Migrations live in `domain/src/main/resources/db/migration/` and run at startup (`migrate-at-start=true`) for whichever app (service or cli) boots. **Write migrations by hand.** The helper `scripts/generate-flyway-migration.sh` boots dev mode, asks Hibernate to diff the schema, and drops a starter at `service/PENDING_MIGRATION.sql` for you to review — turn that into a proper hand-written `V#__name.sql` and delete `PENDING_MIGRATION.sql`. Hand-written files use `V1__init.sql` style; auto-generated ones use a dotted `V1.2026.05.01.xxxxxx__service.sql` pattern and are cleaned up automatically.

### Git operations

`repository.control.GitExecutor` shells out to the `git` CLI via `ProcessBuilder` (no JGit). Repository/worktree operations are real git commands against on-disk paths.

### Frontend

The Angular app lives in `service/src/main/webui/` — Quinoa's default UI directory (previously a separate `qits-ui` repo, now merged in here). Quinoa **auto-detects** the framework (Angular) and package manager (pnpm, from `pnpm-lock.yaml`), and reads `angular.json` to derive the build output dir (`dist/qits-ui/browser`) — so no `quarkus.quinoa.build-dir` override is needed. Quinoa builds it and serves it with SPA routing; `/api` is excluded from SPA fallback (`quarkus.quinoa.ignored-path-prefixes=/api`). Dev mode proxies to the Angular dev server on `:4200`.

## Project documentation workflow (from AGENTS.md)

- Feature drafts live in `docs/feature-ideas/*.md`; once implemented they move to `docs/features/YYYY-MM-DD_*.md`.
- Active bugs are documented in `docs/bugs/*.md`; resolved ones move to `docs/bugs/resolved/YYYY-MM-DD_*.md`.
- Feature and bug docs must include an **Introduction** section listing related/dependent plans.
- Aim for full test coverage; add a regression test when fixing a bug. Tests are JUnit `*Test.java` classes.

## Test fixtures

`service/src/test/resources/fixtures/testing-repo.git` is a **bare git repo committed as plain files** (reproducible test data for clone/pull). `testing-repo/` next to it is a **git submodule** pointing at that bare repo, used only to edit fixtures. Clone with `--recurse-submodules` only if you need to modify fixtures; basic builds don't require it.
