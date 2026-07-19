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

## Done when

Rolling, like any umbrella epic: current when its `feature-ideas/` is empty and every
project-level feature since this epic's creation has landed here. New project-domain work
starts as a draft in this epic's `feature-ideas/`.

## Status

| Part | Status |
|---|---|
| [project-domain](features/2026-05-01_project-domain.md) | implemented |
