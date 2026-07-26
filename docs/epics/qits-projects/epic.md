# Epic: qits-projects — the Project aggregate root

## Introduction

The **Project domain**: the aggregate root of qits' model. A `Project` is the top-level
container under which repositories and feature-flow configurations are created and
cascade-deleted. This epic owns the project entity, its CRUD/boundary, and the BCE package that
every other domain area hangs off.

This is the **root of a three-epic chain** that follows the aggregate hierarchy — each builds
on the previous:

**qits-projects** → [qits-project-repositories](../qits-project-repositories/epic.md) →
[qits-workspaces](../qits-workspaces/epic.md).

A retroactive umbrella epic (same flavor as [qits-workspace-detail](../qits-workspace-detail/epic.md)):
it gathers already-implemented project-domain work and is where future project-level features
land.

**Scope rule** — this epic owns the **Project entity itself**: its persistence, services,
mappers, DTOs, controller, and the cascade semantics that make it the aggregate root. Things
created *under* a project have their own epics — repositories
([qits-project-repositories](../qits-project-repositories/epic.md)), and further down
workspaces — while cross-cutting infrastructure the project domain merely uses stays outside:
the framework building blocks [mutiny](../../technical/examples/mutiny-reactive-programming.md)
and [request-validation](../../technical/examples/request-validation.md) are technical
references under `docs/technical/examples/`, and service-level
[health-checks](../qits-live-deployment/features/2026-05-01_health-checks.md) live in
qits-live-deployment.

## Parts (implemented)

- **[project-domain](features/2026-05-01_project-domain.md)** — the Project BCE package
  (entity, control service, persistence, mapper, DTO, controller); the aggregate root and the
  reference implementation of the project-oriented BCE layout the whole codebase follows.

## Parts (ideas)

Two ordered steps — the wrapper first, then the wrapper as registry.

- **[project-wrapper-repository](feature-ideas/project-wrapper-repository.md)** *(step 1)* — project creation
  always ends with one repository: a `PROJECT`-archetype **wrapper repository** named
  `<project>-<project>` (enforced by backend validation on the project name), seeded with a
  **project template skeleton** (`services/`/`libs/`/`integrations/`/`apps/`, one directory per
  repository archetype — which extends the archetype set) when its main branch is empty, and starting
  as an inline monorepo the project sheds into siblings-as-submodules one directory at a time. Changes the
  [project model](../../guides/project-model.md) from "a project *is* a polyrepo" to "a project
  starts as one repository and grows into one". The already-seeded `qits` project is retro-fitted
  through the [startup self-seed](../qits-live-deployment/features/2026-07-19_startup-qits-self-seed.md)'s
  boot reconcile (`github.com/wohlben/qits-qits`); no other pre-existing project is touched.
- **[wrapper-declared-repositories](feature-ideas/wrapper-declared-repositories.md)** *(step 2)* —
  the wrapper becomes the project's **repository registry**: creating a repository also registers it in
  the wrapper as a submodule at `<archetype-dir>/<name>` (`ignore = all`, `update = merge`,
  `branch = main`), deleting one de-registers it, and the committed `.gitmodules` stays in sync with the
  `Repository` rows. Authors the `AGENTS.md` contract step 1 leaves empty, and closes the
  provisioning gap it flagged.

## Done when

Rolling, like any umbrella epic: current when its `feature-ideas/` is empty and every
project-level feature since this epic's creation has landed here. New project-domain work
starts as a draft in this epic's `feature-ideas/`.

## Status

| Part | Status |
|---|---|
| [project-domain](features/2026-05-01_project-domain.md) | implemented |
| [project-wrapper-repository](feature-ideas/project-wrapper-repository.md) | idea (step 1) |
| [wrapper-declared-repositories](feature-ideas/wrapper-declared-repositories.md) | idea (step 2) |
