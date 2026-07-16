# Nested (depth ≥ 2) submodules fail the workspace container clone

First real-world hit of the boundary `docs/features/2026-07-14_workspace-submodule-support.md`
documents as a follow-up ("only single-level submodules materialize offline"): a workspace for a
repo whose submodule itself has submodules fails to start.

## Introduction

Related/dependent plans:

- `docs/features/2026-07-14_workspace-submodule-support.md` — the feature this bounds; its status
  note already names nested container materialization as the follow-up. The host-side import is
  fully recursive (edges for all levels exist in the DB); only the container-side URL wiring stops
  at depth 1.
- `docs/features/2026-07-08_lazy-workspace-container-provisioning.md` — `provisionContainer` is
  where the wiring happens.
- `docs/features/2026-07-16_build-variant-auth.md` — unrelated to the failure (the git host is on
  the public path list in every variant; the errors are genuine 404s, not auth denials), noted only
  because this surfaced during the first Dokploy prod deployment.

## Observed (prod, Dokploy deployment, 2026-07-16)

Imported `qits-backend` itself as a repository, created a workspace, clicked start:

- The three top-level fixture submodules got their URLs rewritten to sibling-repo UUID urls
  (`http://qits:8080/git/<uuid>`) and cloned fine.
- The nested submodule — `testing-repo-quarkus-angular`'s `src/main/webui`, declared as the
  RELATIVE url `../qits-fixture-angular.git` — resolved against its parent's already-rewritten url
  to `http://qits:8080/git/qits-fixture-angular.git`, which 404s on every attempt (incl. git's own
  one-shot retry), aborting `git submodule update --init --recursive` → "Failed to start the
  container".
- Side observation: one top-level submodule 404'd on its FIRST attempt and succeeded on git's
  automatic retry. Sibling materialization is eager at import (`RepositoryService.cloneRepository`
  mirrors synchronously), so this is NOT lazy-materialization racing; unexplained, self-healing,
  possibly a serving-side timing issue in `GitHostRoutes`. Watch for recurrence.

## Cause

`WorkspaceService.provisionContainer` (domain, `repository/control/WorkspaceService.java:161-196`)
wires ONLY the superproject's direct edges: `findByParentId(repoId)` → one
`git config submodule.<name>.url http://<host>/git/<childId>` each, in the superproject's
`.git/config`, then a single `git submodule update --init --recursive`.

When git's `--recursive` descends into a checked-out child, it reads the CHILD's own `.gitmodules`
— whose urls nothing overrode — and folds relative urls against the child's rewritten origin,
producing name-based paths like `/git/qits-fixture-angular.git`. `GitHostRoutes` serves repos only
under UUID-slug ids (`REPO_ID_PATTERN` `[A-Za-z0-9][A-Za-z0-9-]{0,63}` — dots not even allowed), so
these can never resolve. The nested edges ARE in the DB (`RepositorySubmodule` rows exist for all
levels — host import recurses with cycle guard and `MAX_SUBMODULE_DEPTH=10`); the container wiring
just never consults them.

## Suggested fix direction

Replace the single recursive update with a level-by-level walk driven by the DB's transitive
submodule closure: `submodule update --init` (non-recursive) at the current level, then for each
checked-out child that has edges of its own, write that child's `submodule.<name>.url` overrides
into the child's config (`git -C <path> config …`) and recurse. `WorkspaceService.
submoduleWiringCommands` already isolates the argv assembly and has a pinned unit test
(`WorkspaceProvisionSubmoduleArgvTest`) to extend.

Test gap to close alongside: no test drives a real `git submodule update` through a depth-2 super —
the real-docker `WorkspaceSubmoduleMaterializationIT` deliberately uses the single-level
`submodule-simple-super.git`; the depth-2 `submodule-super.git` diamond is only exercised host-side
(`RepositoryServiceSubmoduleTest`, DB assertions). Extend the IT (or add a sibling) over
`submodule-super.git`.
