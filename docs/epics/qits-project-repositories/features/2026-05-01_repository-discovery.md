# Repository Discovery

## Introduction

This document describes a feature that bridges the gap between database entities and the filesystem for repositories and workspaces. Currently, repository and workspace data lives awkwardly between the two. This feature introduces **auto-discovery** of repositories from the configured data directory and a **metadata directory** within each repository that stores the same data as simple JSON files.

### Related / Dependent Plans
- **Workspaces domain package** (existing): Workspaces and their IDs are referenced in metadata file names (`workspace_$workspace-id.json`).
- **Actions domain package** (planned): Future workspace-action associations may reference the same workspace identifiers.

## Goals

1. Automatically discover repositories in the configured data directory based on directory structure.
2. Persist repository and workspace metadata to the filesystem as JSON, mirroring what is stored in the database.
3. Keep the database and filesystem metadata in sync at startup.

## Non-Goals

1. Real-time filesystem watching (polling or inotify are out of scope).
2. Conflict resolution between database and filesystem state beyond "filesystem wins at startup" or "database wins at runtime".

## Directory Structure

Given a configured data directory (e.g. `~/.local/share/app/data/`):

```
{data-dir}/
├── {repository-1}/
│   ├── metadata/
│   │   ├── repository.json
│   │   └── workspace_{workspace-id}.json
│   └── origin/          # ← presence of origin/ triggers auto-discovery
├── {repository-2}/
│   ├── metadata/
│   │   ├── repository.json
│   │   └── workspace_{workspace-id}.json
│   └── origin/
```

### Auto-Discovery Rule

If a subdirectory of the data directory contains an `origin/` folder, it is treated as a repository and automatically added at application startup.

## Metadata Files

### `metadata/repository.json`

Stores the primary configuration for the repository. Mirrors the database entity fields (e.g. name, remote URL, branch, etc.).

Example shape:
```json
{
  "id": "...",
  "url": "git@github.com:...",
  "archetype": "SERVICE"
}
```

### `metadata/workspace_{workspace-id}.json`

Stores per-workspace metadata. One file per workspace. The workspace ID is embedded in the filename.

Example shape:
```json
{
  "workspaceId": "...",
  "parent": "..."
}
```

## Implementation

### Components

- **`MetadataService`** (`control/MetadataService.java`): Reads and writes JSON metadata files to the filesystem. Provides methods for repository and workspace metadata CRUD.
- **`RepositoryDiscoveryService`** (`control/RepositoryDiscoveryService.java`): Scans the data directory at application startup (`@Observes StartupEvent`), detects repositories by the presence of `origin/`, reads metadata, and upserts records into the database.
- **`RepositoryMetadata`** / **`WorkspaceMetadata`** (`control/RepositoryMetadata.java`, `control/WorkspaceMetadata.java`): Simple Jackson-serializable DTOs that mirror the entity fields.

### Integration Points

- **`RepositoryService.cloneRepository`**: After cloning and persisting the repository, writes `metadata/repository.json`.
- **`WorkspaceService.createWorkspace`**: After creating and persisting the workspace, writes `metadata/workspace_{id}.json`.
- **`WorkspaceService.discardWorkspace`**: After deleting the workspace from the database, deletes `metadata/workspace_{id}.json`.

## Startup Flow

1. **Scan** — Iterate over subdirectories of the configured data directory.
2. **Detect** — For each subdirectory, check if `origin/` exists.
3. **Read** — If yes, read `metadata/repository.json` and any `metadata/workspace_*.json` files.
4. **Upsert** — Ensure the database contains corresponding records:
   - Create repository if missing; update fields if metadata file exists.
   - Create workspaces if missing; update fields if metadata file exists.
   - Delete database workspaces that have no corresponding metadata file (filesystem wins).

## Runtime Behavior

When the application writes repository or workspace changes to the database, it also writes the corresponding JSON file(s) to the metadata directory.

## Open Questions (Resolved)

1. **Should `origin/` be a hardcoded directory name or configurable per repository?**  
   *Resolved:* Hardcoded for simplicity. The feature is focused on convention-over-configuration discovery.

2. **What is the authoritative source when database and JSON metadata disagree at startup?**  
   *Resolved:* Filesystem wins at startup. If a metadata file exists, its contents overwrite the database. If no metadata file exists, the repository is still discovered from directory structure, but existing database fields are preserved.

3. **Should old or orphaned `workspace_*.json` files be cleaned up automatically?**  
   *Resolved:* Orphaned database workspaces (not present in filesystem metadata) are deleted at startup. Orphaned metadata files are left alone; they will be re-imported if the workspace is recreated.
