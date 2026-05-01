# Project Domain Package

## Introduction

This document describes the **project** domain package, which provides referential integrity and discovery for other entities. As of this implementation, repositories can be associated with projects. Repositories without a project association are considered **dangling**.

### Related / Dependent Plans
- **Repository domain package** (existing): Repositories are the first entity type that can be associated with a project. The `Repository` entity was extended with an optional `@ManyToOne` relationship to `Project`.
- **Additional entity associations** (future): More entity types (e.g., workspaces, pipelines) may be associated with projects in future features.

## Goals

1. Provide a standalone domain package for managing projects.
2. Enable projects to act as a grouping mechanism for repositories.
3. Support dangling repositories that exist independently of any project.
4. Offer a shortcut API to create a repository directly under a project.
5. Provide explicit associate / disassociate APIs for existing repositories.

## Non-Goals

1. Enforcing that every repository must belong to a project.
2. Hierarchical or nested projects.
3. Project-level access control or permissions.

## Domain Model

### Project

| Field | Type | Description |
|-------|------|-------------|
| `id` | string (PK) | Primary key |
| `name` | string (required) | Human-readable name |
| `description` | string (optional) | What the project is about |

### Repository (extended)

The existing `Repository` entity was extended with an optional relationship:

| Field | Type | Description |
|-------|------|-------------|
| `project` | `Project` (optional `@ManyToOne`) | The project this repository belongs to, if any |

## API

### Project CRUD

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/projects` | Create a new project |
| `GET` | `/projects` | List all projects |
| `GET` | `/projects/{id}` | Get a project by ID |
| `PUT` | `/projects/{id}` | Update a project |
| `DELETE` | `/projects/{id}` | Delete a project |

### Repository Associations

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/projects/{projectId}/repositories` | List repositories associated with the project |
| `POST` | `/projects/{projectId}/repositories` | Shortcut: clone/create a repository directly under the project |
| `PUT` | `/projects/{projectId}/associate` | Associate an existing repository with the project (body: `{repositoryId}`) |
| `DELETE` | `/projects/{projectId}/associate/{repositoryId}` | Disassociate a repository from the project |

## Open Questions

1. Should projects support additional metadata (tags, labels, timestamps) in the near term?
2. Should disassociating a repository trigger any cleanup or notification?
