# Repository pull leaves imported submodule siblings stale — container start fails on the bumped gitlink

Updating a superproject from its remote does not refresh the imported submodule sibling
repositories, so a gitlink bump arriving on the superproject's main branch points at a commit the
child sibling's origin does not have — and the next workspace container start fails its
`submodule update --init`.

> **Resolved 2026-07-18.** `RepositoryService.pullRepository` now recursively pulls the
> repository's IMPORTED submodule children (the sibling repositories) after its own successful
> pull, over the DB edge graph with a visited-set guard (terminates the `submodule-cycle-*` pair,
> dedups the diamond). A child pull failure degrades loudly, never blocks: the superproject's pull
> already succeeded, so the child's error becomes a `WARNING:` line in the returned output instead
> of failing the operation. `syncRepository` (pull-then-push) inherits the refresh via its pull
> step. Regression tests: `RepositoryServiceSubmoduleTest.pullRefreshesImportedSubmoduleSibling-
> Repositories` (advance child upstream + bump the super's gitlink, pull the super, assert the
> child's origin now contains the commit), `…childPullFailureWarnsWithoutFailingTheSuperprojectPull`,
> `…pullTerminatesOnCyclicSubmoduleImports`.

## Introduction

Related/dependent plans:

- `docs/epics/qits-project-repository-submodules/features/2026-07-14_workspace-submodule-support.md` — the feature this bounds: submodules
  are sibling repositories; workspace containers clone them from the siblings' bare origins via the
  git host. Import materializes each sibling **once**; nothing refreshed them afterwards.
- `docs/issues/resolved/2026-07-16_nested-submodule-clone-fails-workspace-container.md` — the
  previous encounter of this feature's boundary, in the same dogfooding setup (qits importing
  itself).
- `docs/epics/qits-workspaces/features/2026-07-08_lazy-workspace-container-provisioning.md` — container materialization
  (`WorkspaceService.ensureContainer` → `wireSubmodules`) is where the staleness surfaces.

## Observed (2026-07-18, qits self-import)

With qits imported as a repository (submodules imported as siblings): updated the repository from
`main` (which included commit `83b71be7`'s fixture bump — the `testing-repo-quarkus-angular`
gitlink moved to `4bd4062c`, the tip that adds the fixture's `.qits-config.yml`), created a new
workspace, started it:

```
Failed to start the container: Container git failed [128]: git -C . submodule update --init -- …
Submodule path '…/testing-repo': checked out '0ceff224…'
Submodule path '…/testing-repo-angular': checked out '291899c8…'
error: Server does not allow request for unadvertised object 4bd4062c836205a18e344bacf2f708f77fc08d51
fatal: Fetched in submodule path '…/testing-repo-quarkus-angular', but it did not contain 4bd4062c….
Direct fetching of that commit failed.
```

## Cause

`RepositoryService.pullRepository` fetched and fast-forwarded ONLY the repository's own main
branch (plus `.qits-config.yml` re-ingestion). The imported submodule children are separate
sibling repositories, each with a bare origin mirrored **once** at import time
(`importDirectSubmodules` → `cloneOne`) and never fetched again.

The failing sequence: the superproject's pull lands a gitlink pointing at a commit that exists
upstream but not in the stale sibling origin. Container materialization clones the submodule from
that origin via the git host (`GitHostRoutes`, JGit `UploadPack` with the default `ADVERTISED`
request policy); the clone completes without the commit, git falls back to a direct fetch of the
sha, and the server refuses the unadvertised (in fact absent) object. Note the JGit request policy
is not the culprit — no policy can serve a commit the origin doesn't have.

## Fix

Extend pull to the imported edge closure (user decision: "extend the pull/sync functions to also
pull/update all the imported submodules"). See the resolution note above;
`RepositoryService.pullRepository(String, Set)` / `withImportedChildPulls`.
