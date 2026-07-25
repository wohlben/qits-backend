# qits-epics: the planning domain (epics → features → tasks) + audit log

Part 1 of the [qits-epics epic](../epic.md), **as built**. It stands up the planning domain — `Epic`,
`Feature`, `Task` — in a new Maven module `epics/`, with its own datasource, its own Flyway lineage,
an audit log, and a REST boundary hosted by `service`. No UI here; that is
[part 2](../feature-ideas/project-detail-ui.md).

## Introduction

Related/dependent plans:

- **[qits-artifacts](../../qits-artifacts/features/2026-07-19_qits-artifacts.md)** — the *module*
  precedent this copies **in full**: a plain library jar (`eu.wohlben.qits.epics`, BCE split +
  framework-free `error/`), depending on **neither `domain` nor `auth/*`**, owning its **own named
  datasource + persistence unit + Flyway lineage** (a separate physical H2 file under
  `~/.qits/data/epics`), with its REST boundary hosted by `service` and indexed via
  `quarkus.index-dependency.epics.*`.
- **[qits-projects](../../qits-projects/epic.md)** — the aggregate this domain hangs off. Epics
  reference `projectId`; tasks reference `repositoryId`. These are plain **`String` id columns** (no
  JPA `@ManyToOne`, and — see below — **no cross-boundary DB FK**).

## Divergence from the original idea: separate DB, no cross-boundary FKs

The original draft proposed a **shared physical DB** with cross-boundary FK constraints
(`epic.project_id → Project`, `task.repository_id → Repository`, `ON DELETE CASCADE`). During
planning this was **rejected**: both shared-DB wirings carry a Flyway problem — sharing the default
datasource forces epics migrations into `domain`'s version space, while a second datasource on the
same file leaves two Flyway instances with **nondeterministic startup ordering** for the very FK the
scheme exists to create. We chose **full artifacts-style isolation** instead: a **separate physical
H2 file**, own datasource + PU + Flyway lineage. Consequences, all realized here:

- **No cross-boundary DB FK constraints.** `Epic.projectId` / `Task.repositoryId` are plain, indexed
  `String` columns (like artifacts referencing branches/flows by string).
- **Existence validation lives in the controller** (`service`, which depends on both `domain` and
  `epics`): `ProjectService.get` / `RepositoryService.get` are called before delegating, yielding a
  clean 404. The `epics` module stays fully decoupled from `domain`.
- **No free cascade on project/repository delete.** Deleting a `Project`/`Repository` leaves orphan
  epics/tasks — an app-level cleanup is a documented backlog item
  ([orphan-cleanup-on-aggregate-delete](../../../backlog-ideas/epics-orphan-cleanup-on-aggregate-delete.md)),
  matching artifacts' existing stance.
- **Intra-module relationships are real FKs** inside the epics DB: `epic → feature → task`
  (`ON DELETE CASCADE`), and the two self-referential `depends_on` FKs (`ON DELETE SET NULL`).

## What was built

### The `epics/` library-jar module

`eu.wohlben.qits.epics`, split `entity/ persistence/ control/ mapper/ dto/` + framework-free
`error/` (`EpicsException` base carrying a status code, `BadRequestException`/`NotFoundException`),
depending on **neither `domain` nor any `auth/*` module**. Added to the root reactor after
`artifacts`; `service` adds it as a dependency, indexes it (`quarkus.index-dependency.epics.*`), and
hosts the boundary in `eu.wohlben.qits.epics.api`. `-pl epics` never needs `-Dqits.variant`.

### Own datasource + PU + Flyway lineage (separate physical DB)

Shipped from the jar's `META-INF/microprofile-config.properties`:

```properties
quarkus.datasource.epics.db-kind=h2
quarkus.datasource.epics.jdbc.url=jdbc:h2:file:${user.home}/.qits/data/epics/h2/epics;AUTO_SERVER=TRUE
quarkus.hibernate-orm.epics.datasource=epics
quarkus.hibernate-orm.epics.packages=eu.wohlben.qits.epics.entity
quarkus.flyway.epics.migrate-at-start=true
quarkus.flyway.epics.baseline-on-migrate=true
quarkus.flyway.epics.locations=classpath:db/epics/migration
```

Tests override the URL to in-memory H2 (`epics`'s and `service`'s `src/test/resources`).

### Entity model

Panache active-record (public fields, `String` UUID ids generated in the service layer). Table names
match the class simple names (no `@Table`), mirroring domain's `Project`/`Repository`.
`createdAt`/`updatedAt` are auto-stamped (`@CreationTimestamp`/`@UpdateTimestamp`).

- **`Epic`** — `id`, `projectId` (indexed String, no FK), `title`, `description` (CLOB),
  `createdAt`/`updatedAt`.
- **`Feature`** — `id`, `epicId` (FK → `Epic`, cascade), `title`, `description`,
  `dependsOnFeatureId` (nullable self-FK, set-null), `implementedOn` (nullable),
  `createdAt`/`updatedAt`.
- **`Task`** — `id`, `featureId` (FK → `Feature`, cascade), `repositoryId` (indexed String, no FK),
  `title`, `description`, `dependsOnTaskId` (nullable self-FK, set-null), `implementedAt` (nullable),
  `createdAt`/`updatedAt`.

Migration `db/epics/migration/V1__init.sql` (own version space, starts at V1).

### Audit log (git replacement) — explicit audit table

An append-only **`AuditEntry`** table (`entityType`, `entityId`, `epicId`, `operation`
CREATE/UPDATE/DELETE, `changedBy`, `changedAt`, JSON `snapshot`), written from the control-layer
services via `AuditService.record(...)` inside each mutation's transaction. `changedBy` comes from the
request principal (`SecurityIdentity.getPrincipal().getName()`, passed in from the controller). Chosen
over Hibernate Envers (no precedent in-repo, unproven against the named PU, awkward request-principal
capture) and over JPA entity listeners (awkward principal capture) — the explicit table works
regardless of persistence wiring and gives an easy `changed-by`. Rows are **not** FK'd to the live
entities (a DELETE row must outlive the row it describes).

Completeness details (hardened after code review):

- **Every row carries the owning `epicId`** (an epic's own rows carry their own id). The epic audit
  endpoint queries by that column, so the full subtree history is readable **even after the epic and
  its children are deleted** — the audit log is the git replacement, it must outlive the rows.
- **Deletes and dependency-clears run in-service, not via the DB cascade / `SET NULL`**, so every
  cascaded feature/task removal and every cleared dependency gets its own audit row (a raw DB cascade
  would leave no trace). The DB FKs remain as a safety net.
- `record(...)` flushes the persistence context before snapshotting, so Hibernate's
  `@CreationTimestamp`/`@UpdateTimestamp` (applied at flush) are captured accurately.
- Audit reads use a deterministic sort (`changedAt` desc, then `id`) so same-instant rows are stable.

### REST boundary (hosted by `service`, in OpenAPI + generated client)

User-facing CRUD (authenticated by default; **not** on `PublicPaths`; **not** hidden from OpenAPI).
Controllers in `eu.wohlben.qits.epics.api` (`ProjectEpicsController`, `EpicController`,
`FeatureController`, `TaskController`) with nested `XxxRequest`/`Response` records and `@Valid`.
`EpicsExceptionMapper` bridges `EpicsException` → HTTP. **PUT is a partial update** (`@NotBlankIfPresent`
title; a null field leaves it unchanged) so a title-only edit can't silently drop data; the nullable
dependency and implemented-marker are cleared only via explicit `clearDependsOn`/`clearImplemented*`
flags, or set by supplying a value. Additional write-time invariants (hardened after code review): a
task's `repositoryId` must belong to **the epic's own project** (400 otherwise); a `dependsOn*` edge
must stay **within the same epic** (features) / **same feature** (tasks); and dependency edges are
rejected if they would close a **cycle** (multi-hop, not just direct self-reference). Endpoints:

```
GET/POST /api/projects/{projectId}/epics ; GET/PUT/DELETE /api/epics/{id} ; GET /api/epics/{id}/audit
GET/POST /api/epics/{epicId}/features    ; GET/PUT/DELETE /api/features/{id}
GET/POST /api/features/{featureId}/tasks ; GET/PUT/DELETE /api/tasks/{id}
```

## Testing

- **`epics` suite** (in-memory H2, no docker/variant): CRUD for epic/feature/task; in-service cascade
  delete epic → features → tasks; dependency set/clear (via clear flags) + self-cycle + **multi-hop
  cycle** + **cross-epic/cross-feature** rejection; **partial-update preserves omitted fields**;
  `implementedOn`/`implementedAt` transitions; `createdAt` immutability on update; the audit
  CREATE/UPDATE/DELETE triple with the right principal/timestamps; **cascade + dependency-clear write
  their own audit rows**, and the epic audit is readable **after deletion** (queried by `epicId`). (A
  `@QuarkusTest` first-level-cache artifact — a prior non-transactional read masking a later committed
  delete on the same thread — is handled by asserting absence inside a fresh transaction; see
  `EpicsTestSupport`.)
- **`service` suite** (`@QuarkusTest`, forwardauth identity `dev`): REST round-trips at all three
  levels, blank-title validation, cross-module reference validation (404 on unknown
  `projectId`/`repositoryId`), **cross-project repository rejection (400)**, unknown-dependency 400,
  and the audit endpoint (including `changedBy == "dev"` and **audit surviving epic deletion**). `docs/openapi.yml` regenerated (`OpenApiSchemaExportTest`) and the
  `service/src/main/webui/openapi.yml` copy synced.

## Follow-ups

- **Orphan cleanup on project/repository delete** — see the backlog idea linked above.
- **Standalone `epics` service** — split the boundary out of `service` (the artifacts part-2 shape).
- **Migrate the docs spine** — a one-off importer from `docs/epics/*` into the new domain.
- **UI** — [part 2](../feature-ideas/project-detail-ui.md) builds the Angular views. The generated
  API client is already regenerated here (`pnpm generate:api` after syncing both `openapi.yml`
  copies), so the `EpicController`/`ProjectEpicsController`/`FeatureController`/`TaskController`
  services and the epic/feature/task/audit DTOs are available for part 2 to consume.
