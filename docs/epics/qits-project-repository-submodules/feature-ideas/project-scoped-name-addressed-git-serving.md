# Project-scoped, name-addressed git serving (repository name-alias link table)

## Introduction

qits serves every repository from its in-process JGit host under a single, flat, **id-addressed**
path — `/git/<repoId>`, where `repoId` is an opaque UUID (`GitHostRoutes`, `REPO_ID_PATTERN =
[A-Za-z0-9][A-Za-z0-9-]{0,63}`, resolving `<data-dir>/<repoId>/origin` DB-free). That single design
choice is what forces the submodule **url-override hack**: a committed `.gitmodules` uses a
**relative url** (`../qits-fixture-angular.git`) which git resolves against the superproject's origin
— which is `/git/<superUuid>` — yielding `/git/qits-fixture-angular.git`, a name-based path the
id-addressed host **cannot serve** (dots aren't even allowed in `repoId`). So provisioning cannot use
git's native `git submodule update --recursive`; instead `WorkspaceService.wireSubmodules` /
`submoduleWiringCommands` walk the DB submodule-edge closure level by level and, per level, override
`submodule.<name>.url` to the child's `/git/<childId>` before a path-scoped, non-recursive
`submodule update --init`.

This feature **removes that hack at the root** for the common case by giving the git host a
**project-scoped, name-addressed** URL space: a project's repositories become siblings under
`/git/<projectId>/<name>`. Git's native relative resolution (`../qits-fixture-angular.git`) then
lands on the correct sibling with **no override**; the diamond case (`submodule-shared` referenced by
multiple parents) resolves for free. Provisioning becomes a plain clone plus a **bounded,
depth-capped walk over the imported submodule-edge closure**: a relative committed url resolves
natively (no override — the hack gone), while an **absolute** committed url (e.g. `https://github…`)
is still redirected to its name-addressed sibling so the fetch stays offline. The walk stays scoped
to the DB's **imported** edges (so an un-imported `.gitmodules` entry can't be pulled in — which
could otherwise resolve a colliding name to an unrelated repo) and depth-capped (the cycle backstop,
in place of git's own `--recurse-submodules`).

Names are modeled as a **link table**, not a column on `Repository`: identity stays the internal
UUID (deduped on exact `url`), and a repository carries **as many name-aliases as there are links to
it**, so a submodule declared under a different name still resolves as long as it points at the same
underlying repository.

### Related / dependent plans

- **Simplifies the workspace-daemon provisioning-inversion track**
  ([`docs/implementation-plan.md`](../../../implementation-plan.md), Part 1
  [autonomous-self-clone-on-boot](../../qits-workspace-daemon/feature-ideas/autonomous-self-clone-on-boot.md)).
  Native relative resolution removes the **id→url mapping / per-level override** from the daemon's
  job: relative submodules just work off the name-addressed origin. The daemon still receives the
  **imported-edge closure** (to scope the walk and redirect any absolute urls), so the
  `ProvisionRequest` / "submodule closure source" design question is **reduced, not eliminated**.
  This feature is a **prerequisite** of that track.
- **Deletes the workaround in**
  [`docs/issues/resolved/2026-07-16_nested-submodule-clone-fails-workspace-container.md`](../../../issues/resolved/2026-07-16_nested-submodule-clone-fails-workspace-container.md)
  — the level-by-level `submodule.<name>.url` override this replaces.
- **Supersedes a decision in**
  [workspace-submodule-support](../features/2026-07-14_workspace-submodule-support.md) — the
  **user-driven layer-by-layer** partial import becomes **full-closure recursive** import (all
  siblings must be servable for a native recursive clone).
- **Builds on** [qits-project-repositories](../../qits-project-repositories/epic.md) (the
  `Repository`/`Project` entities) and lives in the
  [qits-project-repository-submodules](../epic.md) epic (submodule serving/materialization).

## The core idea

Serve a project's repositories as **siblings** in a name-addressed namespace:

```
/git/<projectId>/<name>[.git]/info/refs         (and .../git-upload-pack, .../git-receive-pack)
```

Because imported submodule children are already created **in the same project** with `url` = the
resolved submodule url — and thus a **url basename equal to the committed submodule url's basename**
— git's native relative resolution just works:

```
superproject cloned from   http://qits:8080/git/<projectId>/testing-repo-quarkus-angular
  .gitmodules ../qits-fixture-angular.git
  → resolves to            http://qits:8080/git/<projectId>/qits-fixture-angular.git   ✅ a real sibling
```

The `submodule-super.git` diamond (`super → child-a, shared`; `child-a → grandchild, shared`, all
relative `../`) resolves at every level, and the shared child is one served repo referenced by many
parents. No override, no level-by-level walk.

## Names as a link table (not a column)

`Repository` keeps its internal UUID id as the **technical identity**, deduped on exact `url`
(`RepositoryRepository.findByUrlInProject`). Addressable **names are aliases**:

- New entity **`RepositoryName`** — `id`, `name` (the addressable segment, a url basename, no
  `.git`), `project` (`@ManyToOne`, the scope), `repository` (`@ManyToOne`, the identity). Unique on
  `(project_id, name)`; **many rows per repository** allowed.
- `RepositoryNameRepository.findRepositoryByProjectAndName(projectId, name) → Optional<Repository>`
  (the git-host lookup) + idempotent `ensureAlias(project, name, repository)`.

A repository accrues an alias per reference. Two superprojects that reference the same underlying
repository (same `url`) under different names both get an alias row → both names resolve to the one
repository. This also dissolves the common "basename collision" worry: same url, many names = one
repo, many aliases (distinct urls that collide on basename remain the only genuine ambiguity — see
Open questions).

## What changes

### Git host (`service` — `githost/GitHostRoutes`)

- Add `/git/:projectId/:repoName/…` routes beside the existing single-segment ones.
- `open(projectId, repoName)`: strip a trailing `.git`, slug-validate each segment, resolve
  `RepositoryNameRepository.findRepositoryByProjectAndName` → repo id, then reuse the **existing**
  `<data-dir>/<repoId>/origin` open (disk layout unchanged — repos stay stored by UUID). The class
  gains a `RepositoryNameRepository` injection (service→domain dependency already exists).
- Keep `/git/<repoId>/…` for back-compat (already-provisioned containers, metadata sidecars,
  discovery-by-directory-name are all unaffected). `PublicPaths` already matches `startsWith("/git/")`,
  so nested paths stay token-free.

### Import (`domain` — `RepositoryService`)

- `cloneOne(…)`: after persisting a repo, `ensureAlias(project, basename(url), repo)`.
- `importDirectSubmodules` → **recursive full-closure import**: walk `.gitmodules` transitively
  (`GitSubmoduleParser.readSubmodules` + `resolveSubmoduleUrl`), cycle-guarded (link back to the
  existing row — the `submodule-cycle-a/b` pair) and depth-capped, importing each child as a sibling
  `Repository` in the same project (dedup by url) and ensuring an alias `(project, basename(childUrl))`.
  The `RepositorySubmodule` edges still drive provisioning (they scope the materialization walk). The
  creation `importSubmodules` toggle and the per-repository "import submodules" action both pull the
  **full closure** now.

### Provisioning (`domain` — `WorkspaceService`)

- `cloneUrl(repoId)` → project-scoped `http://<qitsHost>:<port>/git/<project.id>/<name>` (resolved
  in its own transaction, retried on a unique-constraint race; falls back to the id route if the
  repo/name is absent).
- `provisionContainer`: a plain `git clone --branch <branch> <cloneUrl> /workspace` (commit identity
  still arrives as container `GIT_*` env), then `materializeSubmodules` — a **bounded, depth-capped
  walk over the DB's IMPORTED submodule-edge closure** (not the raw `.gitmodules`, so an un-imported
  entry can't be pulled in). Per imported edge: a **relative** committed url resolves natively (no
  override); an **absolute** committed url is redirected with `config submodule.<name>.url
  cloneUrl(child.id)` (name-addressed, stays offline); then `submodule update --init -- <path>` runs
  through `containerGit`, which **throws** on failure (an imported-but-unreachable submodule fails the
  provision loudly). Branch-mismatch (`ls-files --error-unmatch`) and descent (`<path>/.git`) guards
  are kept.
- **Change** the old `wireSubmodules`/`submoduleWiringCommands` from an *always* `/git/<childId>`
  (id-addressed) override to native-for-relative + name-addressed-override-for-absolute; keep
  `gitlinkOnBranch` / `submoduleCheckedOut` and the depth cap (the cycle backstop, in place of git's
  override-less `--recurse-submodules`).

### Daemon track prep (`domain` — `WorkspaceContainerFactory`) — deferred to Part 1

- The in-container daemon's autonomous self-clone needs `QITS_WORKSPACE_DAEMON_PROJECT_ID` +
  `QITS_WORKSPACE_DAEMON_REPO_NAME` to build `/git/<projectId>/<name>`, **plus the imported-edge
  closure** to scope + wire (absolute urls) its submodule walk. These are injected/handed over **with
  Part 1** (their only consumer) rather than here, to avoid shipping dead env.

### Data model & migration (Flyway — `domain/.../db/migration`)

- New `repository_name(id, project_id, name, repository_id)`, unique `(project_id, name)`, indexed on
  `(project_id, name)` and `repository_id`.
- Backfill one alias per existing repository from its url basename, using a basename derivation that
  matches `RepositoryNameRepository.basename()` (scp/trailing-slash aware); **only non-colliding
  names** are backfilled (a colliding basename gets its correct name from `registerSelfName` on next
  provision, avoiding a wrong-repo alias).

### Tests / cross-copies

- `FakeContainerRuntime` (×3) — the clone-url rewrite handles `/git/<project>/<name>[.git]` and
  materializes an on-disk name farm (symlinks per alias) so the container-side walk resolves siblings
  offline; a `GIT_CONFIG` env enables git's file transport (the real host uses HTTP).
- Delete `WorkspaceProvisionSubmoduleArgvTest` (override argv gone); extend
  `RepositoryServiceSubmoduleTest` (full-closure import + alias rows); add `WorkspaceSubmoduleProvisionTest`
  (offline depth-2 diamond through the fake); take `WorkspaceSubmoduleMaterializationIT` to
  native-resolution siblings over the depth-2 `submodule-super.git` diamond; add name-addressed-route
  coverage to `GitHostTest`.

## Non-goals

- A pretty project **slug** in the URL — `<projectId>` is the UUID; a slug is a later nicety.
- Removing the id-addressed `/git/<repoId>` route — kept for back-compat.
- The daemon self-clone itself — this makes it a plain clone + a name-addressed submodule walk (with
  the imported-edge closure handed over); the daemon work stays in the
  [workspace-daemon](../../qits-workspace-daemon/epic.md) track.

## Open questions

- **Basename collision within a project (same name, distinct urls).** `(project, name)` maps to one
  repository; native `../name.git` is inherently ambiguous across distinct urls. Default: first-writer
  wins (`ensureAlias` logs + keeps); the migration backfill skips colliding names entirely, and a
  losing repo still owns a disambiguated self-name (`<basename>-<idPrefix>`) for its own clone. The
  cross-superproject case (two superprojects whose relative `../foo.git` resolve to *different*
  children) remains genuinely unresolvable by name alone — the old id-addressed override could
  distinguish them; name-addressing cannot. Rare; documented.
- **Cycle safety** — a submodule cycle is bounded by `MAX_SUBMODULE_DEPTH` on the manual walk (git's
  `--recurse-submodules` has no such cap); the `submodule-cycle-*` fixtures exercise it.
