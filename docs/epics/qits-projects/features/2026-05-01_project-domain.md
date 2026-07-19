# Project Domain Package

## Introduction

This document describes the **project** domain package, which provides referential integrity and discovery for other entities. Repositories and feature-flow configurations are both owned by a project.

### Related / Dependent Plans
- **Repository domain package** (existing): Repositories are created directly under a project and cannot exist without one.
- **Feature Flows** (`2026-05-01_feature-flows.md`): `FeatureFlowConfiguration` is now associated with a `Project` rather than a single `Repository`.
- **Additional entity associations** (future): More entity types may be associated with projects in future features.

## Goals

1. Provide a standalone domain package for managing projects.
2. Enable projects to act as a grouping mechanism for repositories.
3. Enforce that every repository must belong to a project.
4. Offer a shortcut API to create a repository directly under a project.
5. Own feature-flow configurations at the project level so that flows can span all repositories in the project.

## Non-Goals

1. Hierarchical or nested projects.
2. Project-level access control or permissions.

## Domain Model

### Project

| Field | Type | Description |
|-------|------|-------------|
| `id` | string (PK) | Primary key |
| `name` | string (required) | Human-readable name |
| `description` | string (optional) | What the project is about |
| `repositories` | list | Repositories belonging to the project |
| `featureFlowConfigurations` | list | Feature-flow configurations scoped to the project |

### Repository (extended)

The `Repository` entity has a mandatory relationship to `Project`:

| Field | Type | Description |
|-------|------|-------------|
| `project` | `Project` (required `@ManyToOne`) | The project this repository belongs to |

## API

### Project CRUD

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/projects` | Create a new project |
| `GET` | `/projects` | List all projects |
| `GET` | `/projects/{id}` | Get a project by ID |
| `PUT` | `/projects/{id}` | Update a project |
| `DELETE` | `/projects/{id}` | Delete a project (cascades to repositories and feature flows) |

### Repository Sub-resources

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/projects/{projectId}/repositories` | List repositories belonging to the project |
| `POST` | `/projects/{projectId}/repositories` | Clone/create a repository directly under the project |

### Feature Flow Configuration Sub-resources

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/projects/{projectId}/feature-flow-configurations` | List feature-flow configurations for the project |
| `POST` | `/projects/{projectId}/feature-flow-configurations` | Create a feature-flow configuration under the project |

## Open Questions

1. Should projects support additional metadata (tags, labels, timestamps) in the near term?
2. Should deleting a project trigger any disk-level cleanup for repositories?
