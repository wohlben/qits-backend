# Epic: qits-epics — planning (epics → features → tasks) as a first-class domain

## Introduction

This epic pulls qits' **own planning artifacts into qits**. Today the epic/feature/task spine
lives as Markdown under `docs/` (`docs/epics/<name>/epic.md`, `feature-ideas/*.md`, `features/*.md`),
managed by hand and versioned by git. This epic makes that structure a **managed domain**: an
**Epic** owns **Features**, a Feature owns **Tasks**, all editable through the qits UI and persisted
in a database, with an **audit log** replacing git as the record of "who changed what, when."

The load-bearing shift from the docs model: **epics live on the _project_, not on a repository.**
A single epic routinely spans several repositories of the project's polyrepo (a schema change here,
its consumer there, a fixture bump in a third) — so an epic hangs off the project aggregate, and the
repository binding drops down to the **task** level, where each task glues a slice of a feature to
one concrete repository.

Like [qits-artifacts](../qits-artifacts/epic.md) and the observability split, this ships in its
**own Maven module** (`epics/`) with its **own persistence unit**, depending on **neither `domain`
nor `auth/*`** — because it is meant to be **extracted into a standalone service later**. It
references the project/repository aggregates by **`String` id, not a JPA association**, so the Java
stays decoupled. But — **unlike artifacts** (which isolates into a separate physical DB and so can't
use FKs) — epics **shares qits' one physical database** with namespaced tables: the eventual split is
code/deployment-only, the DB stays shared, so cross-boundary references carry **real DB-level FK
constraints** (`ON DELETE CASCADE`) for integrity and easy admin joins.

Related/dependent plans:

- **Module-split precedent** — [qits-artifacts](../qits-artifacts/epic.md): the "own module + own
  persistence unit + no code dependency on qits aggregates" pattern this epic copies. It **diverges**
  on storage: artifacts isolates into a separate physical DB (files-move split, no FKs); epics shares
  the one physical DB (code-only split, FKs allowed).
- **Aggregate root it hangs off** — [qits-projects](../qits-projects/epic.md): epics reference their
  owning project by `projectId`; tasks reference their target repository by `repositoryId`. Both are
  plain `String` columns in the Java (no `@ManyToOne`) but carry **DB-level FK constraints** (shared
  DB).
- **What it replaces** — the `docs/` project-documentation workflow in `AGENTS.md`
  (epics → feature-ideas/features → tasks-as-prose). That workflow stays for now; this epic is the
  managed-domain successor for planning that spans repositories and wants an audit trail without git.

## Parts, in implementation order

1. **[domain-and-persistence](feature-ideas/domain-and-persistence.md)** *(idea)* — the new `epics/`
   module: `Epic`/`Feature`/`Task` entities, own datasource + Flyway lineage, the audit log, and the
   REST boundary hosted (for now) by `service`. No dependencies inside or outside this epic.
2. **[project-detail-ui](feature-ideas/project-detail-ui.md)** *(idea)* — the Angular UI: an
   **Epics** section on the project-detail route (above Repositories), and the segmented drill-down
   routes epic → features → feature → tasks → task. Depends on part 1.

## Done when

The planning spine is a managed domain: epics can be created under a project, features under an epic
(with feature→feature dependencies and an implemented-on marker), tasks under a feature (bound to a
repository, with task→task dependencies and an implemented-at marker); every mutation lands in the
audit log; and all of it is navigable through the segmented project→epic→feature→task UI. The module's
Java is decoupled enough (no code dependency on `domain`) that extracting it into a standalone
service is a later code/deployment move over the same shared DB.

## Status

| Part | Status |
|---|---|
| [domain-and-persistence](feature-ideas/domain-and-persistence.md) | idea |
| [project-detail-ui](feature-ideas/project-detail-ui.md) | idea |
