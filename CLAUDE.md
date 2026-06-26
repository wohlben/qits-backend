# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Quarkus 3 (Java 25) backend for managing Git repositories, worktrees, and "feature flow" configurations, with an Angular UI served via Quarkus Quinoa. Maven multi-module: root `pom.xml` aggregates the single `service/` module. Group `eu.wohlben`, base package `eu.wohlben.qits`.

Build and runtime both target **JDK 25** (`maven.compiler.release=25`; JVM Docker images use `ubi9/openjdk-25-runtime`; project JDK pinned via `.sdkmanrc`). Spotless (google-java-format) runs automatically on every build via the `process-sources` phase — google-java-format requires JDK 21+, so don't build on JDK 17.

## Commands

All Maven commands use the wrapper. The root POM drives the `service` module.

```bash
# Run dev mode (live-reload for Java + Angular, Quinoa dev server on :4200)
./mvnw -pl service quarkus:dev

# Full build (frontend + backend)
./mvnw package

# Run all unit tests
./mvnw -pl service test

# Run a single test class / method
./mvnw -pl service test -Dtest=ProjectServiceTest
./mvnw -pl service test -Dtest=ProjectControllerTest#create

# Regenerate docs/openapi.yml (writes the file as a side effect — do not hand-edit openapi.yml)
./mvnw -pl service test -Dtest=OpenApiSchemaExportTest

# Native build + integration tests (failsafe; ITs are skipped by default via skipITs=true)
./mvnw -pl service package -Dnative
```

Postgres is required at runtime (dev/prod). Start it with `docker compose up -d` (db `qits`, user/pass `qits`, port 5432). **Tests run against in-memory H2** (`quarkus-jdbc-h2`, test scope; configured in `service/src/test/resources/application.properties`), so the suite needs no Docker/Postgres. The Flyway migrations are portable and apply cleanly to both — but `generate-flyway-migration.sh` emits Postgres-dialect DDL, so a future generated migration could use Postgres-only syntax that breaks the H2 test run; hand-edit for portability when that happens.

## Architecture

### Package layout: domain-oriented BCE

Code is organized by **domain area**, each split into Boundary-Control-Entity layers:

```
eu.wohlben.qits.domain.<area>.
  api/          REST controllers (JAX-RS, the "boundary")
  control/      @ApplicationScoped services, business logic, @Transactional
  entity/       Panache JPA entities + enums
  persistence/  PanacheRepository implementations
  mapper/       MapStruct entity→DTO mappers
  dto/          DTO records returned to clients
```

Domain areas: `project` (the aggregate root), `repository` (repos + worktrees + git execution), `featureflow` (configurations → phases → actions/steps). Cross-cutting: `validation` (custom Bean Validation), `mutiny` (reactive endpoints + request-context propagation), `api` (global exception mappers), `health`.

### Conventions to follow when adding code

- **Controllers** declare nested `record`s per operation: a `XxxRequest` with an inner `Response` record (see `ProjectController`). Validate request bodies with `@Valid` + Bean Validation annotations. All REST endpoints are served under `/api` (`quarkus.rest.path=/api`); `@Path` values are relative to that.
- **Entities** use Panache active-record style: extend `PanacheEntityBase`, **public fields** (no getters/setters), accessed directly. IDs are `String` UUIDs generated in the service layer (`UUID.randomUUID().toString()`), not DB-generated.
- **Services** are `@ApplicationScoped`, inject Panache repositories, and own `@Transactional` boundaries. Throw JAX-RS exceptions (`NotFoundException`, `BadRequestException`) for error responses.
- **Mappers** are MapStruct interfaces annotated `@Mapper(componentModel = "jakarta")`. Implementations are generated at compile time (annotation processor); never hand-write the `*Impl`. Lombok + MapStruct are wired together via `lombok-mapstruct-binding`.
- **`Project` is the aggregate root.** Repositories and feature-flow configurations are created *under* a project (e.g. `POST /api/projects/{id}/repositories`) and cascade-deleted with it.

### Database migrations (Flyway)

Migrations live in `service/src/main/resources/db/migration/` and run at startup (`migrate-at-start=true`). **Write migrations by hand.** The helper `scripts/generate-flyway-migration.sh` boots dev mode, asks Hibernate to diff the schema, and drops a starter at `service/PENDING_MIGRATION.sql` for you to review — turn that into a proper hand-written `V#__name.sql` and delete `PENDING_MIGRATION.sql`. Hand-written files use `V1__init.sql` style; auto-generated ones use a dotted `V1.2026.05.01.xxxxxx__service.sql` pattern and are cleaned up automatically.

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
