# Repository Discovery

## Introduction

This document describes a feature that bridges the gap between database entities and the filesystem for repositories and worktrees. Currently, repository and worktree data lives awkwardly between the two. This feature introduces **auto-discovery** of repositories from the configured data directory and a **metadata directory** within each repository that stores the same data as simple JSON files.

### Related / Dependent Plans
- **Worktrees domain package** (existing): Worktrees and their IDs are referenced in metadata file names (`worktree_$worktree-id.json`).
- **Actions domain package** (planned): Future worktree-action associations may reference the same worktree identifiers.

## Goals

1. Automatically discover repositories in the configured data directory based on directory structure.
2. Persist repository and worktree metadata to the filesystem as JSON, mirroring what is stored in the database.
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
│   │   └── worktree_{worktree-id}.json
│   └── origin/          # ← presence of origin/ triggers auto-discovery
├── {repository-2}/
│   ├── metadata/
│   │   ├── repository.json
│   │   └── worktree_{worktree-id}.json
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
  "name": "my-project",
  "remote_url": "git@github.com:...",
  "default_branch": "main",
  "created_at": "...",
  "updated_at": "..."
}
```

### `metadata/worktree_{worktree-id}.json`

Stores per-worktree metadata. One file per worktree. The worktree ID is embedded in the filename.

Example shape:
```json
{
  "id": "...",
  "worktree_id": "...",
  "branch": "feature/x",
  "path": "...",
  "created_at": "...",
  "updated_at": "..."
}
```

## Startup Flow

1. **Scan** — Iterate over subdirectories of the configured data directory.
2. **Detect** — For each subdirectory, check if `origin/` exists.
3. **Read** — If yes, read `metadata/repository.json` and any `metadata/worktree_*.json` files.
4. **Upsert** — Ensure the database contains corresponding records (create if missing, update if changed).

## Runtime Behavior

When the application writes repository or worktree changes to the database, it should also write the corresponding JSON file(s) to the metadata directory.

## Open Questions

1. Should `origin/` be a hardcoded directory name or configurable per repository?
2. What is the authoritative source when database and JSON metadata disagree at startup?
3. Should old or orphaned `worktree_*.json` files be cleaned up automatically?
