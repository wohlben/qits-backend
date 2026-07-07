# Project/repository delete leaves workspace containers (and on-disk origins) behind

## Introduction

Found during the manual E2E of
[observability](../features/2026-07-04_observability.md): deleting the throwaway test project
returned 200 and removed all DB rows, but the workspace's Docker container
(`qits-ws-otel-e2e-…`) kept running and had to be `docker rm -f`'d by hand. Not caused by the
observability feature — it's the delete paths of
[workspace containers](../features/2026-07-04_workspace-containers.md) predating it.

Related/dependent plans:

- [Workspace containers](../features/2026-07-04_workspace-containers.md) — owns the
  container-per-workspace lifecycle whose teardown is incomplete here.
- [Disposable workspace containers](../features/2026-07-04_workspace-containers.md) /
  `WorkspaceService.stopContainer` — already has the correct removal primitive to reuse.

## Observed

1. Create project → repository → workspace (container starts).
2. `DELETE /api/projects/{id}` → 200, rows cascade away.
3. `docker ps` still shows `qits-ws-<workspaceId>-<repoId[0:8]>` running. Nothing will ever
   reclaim it: the workspace row it belonged to no longer exists.

## Cause

Container removal lives only in `WorkspaceService` (`deleteWorkspace`, `stopContainer`,
`cleanupBranch` call `containers.rm(...)`). The aggregate delete paths bypass it:

- `ProjectService.delete` deletes repository rows directly via `repositoryRepository.delete`
  (JPA cascade), never touching `ContainerRuntime`.
- `RepositoryService.delete(repoId)` likewise deletes only the row.

The same runs bypass the on-disk cleanup too: the bare origin under
`<data-dir>/<repoId>/` survives a repository/project delete — visible at every startup as
`RepositoryDiscoveryService` warnings ("Discovered repository … on disk but it has no project
association; skipping").

## Suggested fix

Before deleting a repository row (both in `RepositoryService.delete` and in
`ProjectService.delete`'s loop), iterate its active workspaces and remove each container
(`containers.rm(containers.containerName(workspaceId, repoId))` — best-effort, like
`stopContainer`), then delete the repository's data dir. A regression test can use
`FakeContainerRuntime` to assert the container is gone after a project delete.

**Trigger:** next time anyone touches the repository/project delete paths — or the next time a
stale `qits-ws-*` container shows up in `docker ps`.

## Resolution (2026-07-07)

Implemented essentially as suggested, in `RepositoryService.delete` /
`ProjectService.delete` (already in `main` at verification time):

- **`RepositoryService.delete(repoId)`** now tears down the whole footprint before deleting the
  row: it iterates `containerRuntime.listWorkspaceContainers(repoId)` and best-effort `rm`s each
  (a warn on failure, mirroring `stopContainer`), then `deleteDataDir(repoId)` recursively removes
  `<data-dir>/<repoId>` (bare origin + merge scratch), then deletes the repository row (DB
  workspaces/commands/events/daemons cascade off it). Driving teardown off `listWorkspaceContainers`
  rather than the active-workspace rows is stricter than the original suggestion — it reclaims any
  container carrying the repo's label, including ones whose workspace row is already gone.
- **`ProjectService.delete(id)`** delegates each repository to `repositoryService::delete` instead
  of a raw `repositoryRepository.delete`, so the container + data-dir teardown runs per repository
  (this also covers the `seed`/`seed-webapp` reset path, which deletes then recreates).

Regression test: `RepositoryServiceTest.deleteRepositoryRemovesContainersAndOnDiskData` — creates a
project → repository → workspace container, asserts the clone dir and container exist, calls
`projectService.delete`, then asserts both the on-disk clone dir and the workspace containers are
gone. Green (`FakeContainerRuntime`, no docker needed).

This clears the startup `RepositoryDiscoveryService` "on disk but has no project association;
skipping" warnings the leaked origins used to produce.
