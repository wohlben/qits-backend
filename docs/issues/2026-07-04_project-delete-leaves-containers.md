# Project/repository delete leaves worktree containers (and on-disk origins) behind

## Introduction

Found during the manual E2E of
[observability](../features/2026-07-04_observability.md): deleting the throwaway test project
returned 200 and removed all DB rows, but the worktree's Docker container
(`qits-wt-otel-e2e-…`) kept running and had to be `docker rm -f`'d by hand. Not caused by the
observability feature — it's the delete paths of
[workspace containers](../features/2026-07-04_workspace-containers.md) predating it.

Related/dependent plans:

- [Workspace containers](../features/2026-07-04_workspace-containers.md) — owns the
  container-per-worktree lifecycle whose teardown is incomplete here.
- [Disposable workspace containers](../features/2026-07-04_workspace-containers.md) /
  `WorktreeService.stopContainer` — already has the correct removal primitive to reuse.

## Observed

1. Create project → repository → worktree (container starts).
2. `DELETE /api/projects/{id}` → 200, rows cascade away.
3. `docker ps` still shows `qits-wt-<worktreeId>-<repoId[0:8]>` running. Nothing will ever
   reclaim it: the worktree row it belonged to no longer exists.

## Cause

Container removal lives only in `WorktreeService` (`deleteWorktree`, `stopContainer`,
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
`ProjectService.delete`'s loop), iterate its active worktrees and remove each container
(`containers.rm(containers.containerName(worktreeId, repoId))` — best-effort, like
`stopContainer`), then delete the repository's data dir. A regression test can use
`FakeContainerRuntime` to assert the container is gone after a project delete.

**Trigger:** next time anyone touches the repository/project delete paths — or the next time a
stale `qits-wt-*` container shows up in `docker ps`.
