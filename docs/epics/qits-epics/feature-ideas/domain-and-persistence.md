# qits-epics: the planning domain (epics → features → tasks) + audit log

## Introduction

Part 1 of the [qits-epics epic](../epic.md). It stands up the **planning domain** — `Epic`,
`Feature`, `Task` — in a **new Maven module** `epics/`, with its own datasource, its own Flyway
lineage, an audit log, and a REST boundary hosted (for now) by `service`. No UI here; that is
[part 2](project-detail-ui.md).

Related/dependent plans:

- **[qits-artifacts](../../qits-artifacts/features/2026-07-19_qits-artifacts.md)** — the *module*
  precedent this copies: a plain library jar (`eu.wohlben.qits.epics`, BCE split + framework-free
  `error/`), depending on **neither `domain` nor `auth/*`**, with its REST boundary hosted by
  `service` and indexed via `quarkus.index-dependency.epics.*`. **It deliberately diverges from
  artifacts on persistence**: artifacts owns a *separate physical H2 file* (so its split moves files,
  not data) and therefore *cannot* use FKs; epics instead **shares qits' one physical DB** with
  namespaced tables — the split is code/deployment-only, the DB stays shared — so cross-boundary
  **DB-level FK constraints are used** (see below).
- **[qits-projects](../../qits-projects/epic.md)** — the aggregate this domain hangs off. Epics
  reference `projectId`; tasks reference `repositoryId`. These are plain **`String` id columns (no
  JPA `@ManyToOne`** — that would couple the module to `domain`), but carry a **real DB-level FK
  constraint** because they live in the same physical database.

## What we build

### A new library-jar module `epics/`

A plain library jar like `domain`/`artifacts` — `eu.wohlben.qits.epics`, split
`entity/ persistence/ control/ mapper/ dto/` + framework-free `error/` — depending on **neither
`domain` nor any `auth/*` module**. Its Java has **no compile dependency** on qits' entities: it
references the owning project and the target repository **by `String` id**, not by a JPA
`@ManyToOne` to `Project`/`Repository`. That keeps the module lift-out-able. It differs from
artifacts only in *where the bytes land*: the tables sit in **the shared physical DB** (below), so
those string ids still get **DB-level FK constraints** for integrity, cascade, and admin joins.
Added to the root reactor `<modules>` after `artifacts`; `service` adds it as a dependency, indexes
it (`quarkus.index-dependency.epics.*`), and hosts the boundary in `eu.wohlben.qits.epics.api`.
`-pl epics` never needs `-Dqits.variant`.

The future standalone deployable is a small new Quarkus-app module depending on `epics` — the same
relationship `service` has to `domain`.

### Shared physical DB, namespaced tables (FK-capable)

**This is the deliberate divergence from artifacts.** Artifacts uses a *separate H2 file* for full
data isolation, which is precisely why it can't use FKs. Epics instead **shares qits' one physical
database** — the split into a standalone service later is code/deployment-only, the DB stays shared
with tables namespaced by module — so cross-boundary references can carry **real DB-level FK
constraints** (`ON DELETE CASCADE` off `project`/`repository`), giving referential integrity, free
cleanup on delete, and trivial manual admin joins. The module still keeps its **own persistence
unit** (entities isolated from `domain`'s) so the Java stays decoupled.

Two wiring arrangements deliver "one physical DB"; **resolve at implementation**:

- **(a) Share the default datasource (leaning).** Epics entities go in a dedicated PU bound to the
  **default `qits` datasource**, tables namespaced by an H2 `SCHEMA` (e.g. `EPICS`) or an
  `epic_`/`feature_`/`task_` prefix. FK constraints to `project`/`repository` and startup migration
  ordering both work trivially (one datasource, one connection). Cost: epics' migrations share the
  default Flyway **version space**, so version numbers must be coordinated with `domain`'s
  `db/migration` — either by contributing `classpath:db/epics/migration` to the default datasource's
  Flyway `locations`, or by folding epics DDL into domain's lineage.
- **(b) Own datasource pointing at the *same* H2 URL.** Keeps an independent Flyway lineage
  (`quarkus.flyway.epics.locations=classpath:db/epics/migration`, own version space) while the
  `jdbc.url` targets **the same file** as the default datasource (H2 `AUTO_SERVER=TRUE` permits the
  extra connection). Cross-schema FKs still resolve because it's one physical file. *Caveat*: the
  FK-creation migration needs `project`/`repository` to already exist, and startup ordering across
  two Flyway instances isn't guaranteed — mitigate with a guarded/late constraint migration, or drop
  to app-level enforcement for that one edge if ordering bites.

Either way: a dedicated PU (`quarkus.hibernate-orm.epics.packages=eu.wohlben.qits.epics.entity`),
migrations hand-written at `epics/src/main/resources/db/epics/migration/V#__*.sql`, tests on
in-memory H2 (in this module's and `service`'s `src/test/resources`). Config defaults ship in the
module's `META-INF/microprofile-config.properties` (read from the dependency jar; a jar's
`application.properties` is ignored).

At true split-time: if the standalone service keeps this shared DB, the FKs are untouched; if it
ever moves to its own DB, drop the two cross-boundary constraints and add an app-level orphan
sweeper — a localized change, cheap *because* these were never JPA associations.

### Entity model

Panache active-record style (public fields, `String` UUID ids generated in the service layer),
matching the house convention. `created_at`/`updated_at` are auto-stamped (Hibernate
`@CreationTimestamp`/`@UpdateTimestamp`, or `@PrePersist`/`@PreUpdate`).

**`Epic`** — the spine (one per docs-epic today), owned by a project.

| field | type | notes |
|---|---|---|
| `id` | String (UUID) | PK |
| `projectId` | String | `String` column (no JPA `@ManyToOne`) → `domain` `Project`, but with a **DB-level FK constraint** `ON DELETE CASCADE` (shared DB) |
| `title` | String | short label for lists/breadcrumbs (**added** to the requested set — the description is long-form; a list needs a heading. See open questions.) |
| `description` | String (CLOB) | the **spine**: long-form Markdown |
| `createdAt` / `updatedAt` | timestamptz | auto-stamped |

**`Feature`** — akin to today's `feature-ideas`, owned by an epic.

| field | type | notes |
|---|---|---|
| `id` | String (UUID) | PK |
| `epicId` | String | FK → `epic.id` (same module ⇒ real FK), cascade-delete with the epic |
| `title` | String | short label (same rationale as Epic) |
| `description` | String (CLOB) | long-form Markdown |
| `dependsOnFeatureId` | String, **nullable** | self-ref FK → `feature.id` |
| `implementedOn` | timestamptz, **nullable** | set when the feature ships |
| `createdAt` / `updatedAt` | timestamptz | auto-stamped |

**`Task`** — glues a feature to a concrete **repository**, owned by a feature.

| field | type | notes |
|---|---|---|
| `id` | String (UUID) | PK |
| `featureId` | String | FK → `feature.id`, cascade-delete with the feature |
| `repositoryId` | String | `String` column (no JPA `@ManyToOne`) → `domain` `Repository`, with a **DB-level FK constraint** (the epic→multi-repo split lives here) |
| `title` | String | short label |
| `description` | String (CLOB) | long-form Markdown |
| `dependsOnTaskId` | String, **nullable** | self-ref FK → `task.id` |
| `implementedAt` | timestamptz, **nullable** | set when the task is done |
| `createdAt` / `updatedAt` | timestamptz | auto-stamped |

Relationships **inside** the module (`epic → feature → task`, and the two self-referential
`depends_on`) are **real FKs**. References **out** of the module (`projectId`, `repositoryId`) are
**plain `String` columns in the Java** (no JPA `@ManyToOne` → no compile dependency on `domain`, so
the module stays split-ready) that nonetheless carry a **DB-level FK constraint** because they live
in the shared physical DB — giving referential integrity, `ON DELETE CASCADE` cleanup, and admin
joins. The Envers/audit tables and the two cross-boundary constraints are the only places the shared
DB shows through.

Starter migration `V1__init.sql` (hand-write from this sketch). The `project`/`repository` FKs assume
the shared DB and the domain tables already existing — see the wiring caveat above:

```sql
create table epic (
    id varchar(255) not null,
    project_id varchar(255) not null,
    title varchar(512) not null,
    description clob,
    created_at timestamp(6) with time zone not null,
    updated_at timestamp(6) with time zone not null,
    primary key (id)
);
create index idx_epic_project_id on epic (project_id);
-- Cross-boundary FK into domain's shared-DB table (verify domain's actual table/column names).
-- ON DELETE CASCADE removes a project's epics (→ features → tasks) automatically.
alter table if exists epic add constraint fk_epic_project
    foreign key (project_id) references project (id) on delete cascade;

create table feature (
    id varchar(255) not null,
    epic_id varchar(255) not null,
    title varchar(512) not null,
    description clob,
    depends_on_feature_id varchar(255),
    implemented_on timestamp(6) with time zone,
    created_at timestamp(6) with time zone not null,
    updated_at timestamp(6) with time zone not null,
    primary key (id)
);
create index idx_feature_epic_id on feature (epic_id);
alter table if exists feature add constraint fk_feature_epic
    foreign key (epic_id) references epic (id);
alter table if exists feature add constraint fk_feature_depends_on
    foreign key (depends_on_feature_id) references feature (id);

create table task (
    id varchar(255) not null,
    feature_id varchar(255) not null,
    repository_id varchar(255) not null,
    title varchar(512) not null,
    description clob,
    depends_on_task_id varchar(255),
    implemented_at timestamp(6) with time zone,
    created_at timestamp(6) with time zone not null,
    updated_at timestamp(6) with time zone not null,
    primary key (id)
);
create index idx_task_feature_id on task (feature_id);
create index idx_task_repository_id on task (repository_id);
alter table if exists task add constraint fk_task_feature
    foreign key (feature_id) references feature (id);
alter table if exists task add constraint fk_task_depends_on
    foreign key (depends_on_task_id) references task (id);
-- Cross-boundary FK into domain's shared-DB repository table (verify domain's actual names).
alter table if exists task add constraint fk_task_repository
    foreign key (repository_id) references repository (id) on delete cascade;
```

The intra-module FKs (`fk_feature_epic`, `fk_task_feature`) should also be `on delete cascade` so
deleting an epic tears down its features and their tasks. Envers `_AUD` tables (below) are **not**
FK-constrained back to the live rows (they must survive the row's deletion).

### Audit log (git replacement)

Because the record leaves git, every insert/update/delete of an epic/feature/task must be captured
in a timestamped shadow history — "who changed what, when." Three candidate mechanisms, **leading
choice first**:

1. **Hibernate Envers (recommended)** — add the `quarkus-hibernate-envers` extension, annotate the
   three entities `@Audited`. Hibernate maintains `epic_aud`/`feature_aud`/`task_aud` + a `revinfo`
   revision table (revision number + timestamp + revision type add/mod/del) automatically, and gives
   a query API to read any past state. We hand-write the `_AUD`/`revinfo` tables into the Flyway
   lineage (schema stays owned by migrations, as elsewhere). Fits the "carbon copy / timestamped
   table on change" ask directly, is portable (survives the likely eventual Postgres move and the
   standalone-service split), and needs no per-table Java. **The default plan unless it proves
   fiddly against the named `epics` persistence unit.**
2. **H2 `CREATE TRIGGER`** — a DB-level trigger per table `CALL`s a Java trigger class that copies
   the row into a timestamped shadow table. Catches writes made outside Hibernate too, but is
   **H2-specific** (would be rewritten for Postgres, cutting against the portability the whole module
   is built for) and needs a trigger class + shadow table per entity. Fallback only.
3. **JPA `@EntityListeners` (`@PrePersist`/`@PreUpdate`/`@PreRemove`)** — write an audit row by hand
   from a listener. Simplest to reason about, fully in-app, but re-implements a slice of what Envers
   already gives (no free "read state at revision N"). The floor if the extension is unavailable.

The audit table(s) capture at minimum: entity type, entity id, operation, changed-by (from the
authenticated principal via `/api/auth/me` / the request identity), timestamp, and a snapshot of the
changed fields. Whichever mechanism, the audit rows live in the **epics-owned (namespaced) tables** so they
travel with the module.

### API boundary (hosted by `service`, in OpenAPI + generated client)

Unlike artifacts (a hidden system API), this is a **user-facing CRUD API** — it **appears in
`docs/openapi.yml`** and the generated Angular client. Controllers live in `eu.wohlben.qits.epics.api`
(service module), declare nested `XxxRequest`/`Response` records, validate with `@Valid`, and sit
behind the always-on `QitsAuthPolicy` (authenticated; **not** on `PublicPaths`). Services in
`epics.control` throw framework-free `epics.error` exceptions mapped to HTTP by `service`'s
`DomainExceptionMapper` (extend its coverage, or add a small mapper).

Endpoint sketch (all under `/api`):

```
# Epics on a project
GET    /api/projects/{projectId}/epics          list epics for a project
POST   /api/projects/{projectId}/epics          create (validates projectId exists — see below)
GET    /api/epics/{id}                           one epic (the spine)
PUT    /api/epics/{id}                           update title/description
DELETE /api/epics/{id}                           delete (cascades features → tasks)

# Features on an epic
GET    /api/epics/{epicId}/features             list
POST   /api/epics/{epicId}/features             create
GET    /api/features/{id}                        one feature
PUT    /api/features/{id}                        update (incl. dependsOnFeatureId, implementedOn)
DELETE /api/features/{id}

# Tasks on a feature
GET    /api/features/{featureId}/tasks          list
POST   /api/features/{featureId}/tasks          create (binds repositoryId)
GET    /api/tasks/{id}                           one task
PUT    /api/tasks/{id}                           update (incl. dependsOnTaskId, implementedAt)
DELETE /api/tasks/{id}

# Audit
GET    /api/epics/{id}/audit                     change history for an epic subtree (or per-entity)
```

## Open questions

- **`title` field.** The requested field set for each entity omits a short label; the description is
  the long-form spine. Lists, breadcrumbs, and dependency pickers all need a heading, so this draft
  **adds `title`**. Alternative: derive a title from the first Markdown heading/line of the
  description (no stored column). *Leaning: store `title` — cheap, explicit, and editable
  independently of the spine.*
- **Shared-DB wiring.** Arrangement (a) share the default datasource + coordinate Flyway versions,
  vs (b) own datasource pointing at the same H2 URL + own Flyway lineage with the startup-ordering
  caveat (see "Shared physical DB" above). *Leaning: (a).* This is the only genuinely open item on
  persistence now — the FK question itself is **resolved: shared DB, DB-level FK constraints with
  `ON DELETE CASCADE`, no JPA associations.* The cascade constraint handles cleanup on
  project/repository deletion for free; the boundary still validates `projectId`/`repositoryId`
  existence on write for a clean 400/404 rather than a raw constraint-violation 500.
- **Audit mechanism** — Envers vs H2 trigger vs entity-listener (above). *Leaning: Envers; confirm
  it composes with the named `epics` persistence unit before committing.*

## Testing

- **`epics` suite** (in-memory H2, no docker, no variant flag): CRUD for epic/feature/task; cascade
  delete epic → features → tasks; self-referential `depends_on` set/clear and the guard against a
  self-cycle (a feature/task depending on itself); `implementedOn`/`implementedAt` transitions;
  `created_at`/`updated_at` auto-stamping (update bumps `updated_at`, not `created_at`); the audit log
  records an add/modify/delete triple with the right timestamps and principal.
- **`service` suite** (`@QuarkusTest`, forwardauth): the REST round-trips for all three levels
  (201/200/404), validation failures (400 on blank title, unknown `dependsOn*`), cross-module
  reference validation (404/400 on unknown `projectId`/`repositoryId`), and the audit endpoint. Also
  regenerate `docs/openapi.yml` (`OpenApiSchemaExportTest`) — these endpoints are **not** hidden.

## Follow-ups

- **Standalone `epics` service** — split the boundary out of `service` into its own Quarkus-app
  module (the artifacts part-2 shape), executing the deployment split this module is structured for.
- **Migrate the docs spine** — a one-off importer that reads `docs/epics/*/epic.md` + feature/task
  prose into the new domain, so the existing plans become managed rows.
