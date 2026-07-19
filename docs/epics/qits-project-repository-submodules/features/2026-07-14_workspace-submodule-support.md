# Workspace submodule support — import a repo's submodules as sibling repositories, materialized offline

> **Status: implemented (2026-07-14); import model redesigned (2026-07-16).** The 2026-07-16 redesign
> (prompted by the first prod encounter of the nested-submodule boundary — see
> `docs/issues/resolved/2026-07-16_nested-submodule-clone-fails-workspace-container.md`) replaces the
> automatic recursive import and lifts the single-level materialization boundary:
>
> - **Import is user-driven, layer by layer.** Repository creation takes an `importSubmodules` toggle
>   (default true) that imports the DIRECT submodules only; going deeper is the user invoking
>   `POST /api/repositories/{id}/submodules/import` on an imported child (the repository detail
>   view's "Import submodules" action, offered while `GET …/submodules` reports `available` entries)
>   — as far down as they care to recurse. Dedup is unchanged (children by resolved url within the
>   project, edges by `(parent, path)`), which is also what terminates cycles now: the second,
>   user-invoked import of a cyclic pair links back to the existing row. `RepositoryService.
>   importDirectSubmodules` / `listUnimportedSubmodules`; the old `visitedUrls`/depth recursion is
>   gone.
> - **Container materialization walks the imported edges level by level — nested submodules now
>   materialize.** git's own `--recursive` cannot be used (it derives nested urls from each child's
>   `.gitmodules`, which no override reaches, yielding un-servable name-based `/git/...` paths), so
>   `WorkspaceService.wireSubmodules` re-applies the override→update sequence per level over the DB
>   edge closure, path-scoping each `submodule update --init -- <paths>` to the imported edges —
>   unimported submodules stay uninitialized directories (the layer-by-layer contract), and edges
>   whose gitlink is absent on the workspace's branch are filtered out (`ls-files --error-unmatch`).
>   Depth-capped as the cycle backstop; descent is guarded on the child's `.git` marker.
> - **Pull refreshes the imported children (added 2026-07-18).** `RepositoryService.pullRepository`
>   recursively pulls the imported submodule siblings after its own successful pull (visited-set
>   guard over the edge graph; child failures degrade loudly as `WARNING:` output lines), so a
>   gitlink bump arriving on the superproject's main branch never points at a commit the sibling's
>   origin can't serve — see
>   `docs/issues/resolved/2026-07-18_pull-leaves-imported-submodule-siblings-stale.md`.
>
> Original 2026-07-14 ship notes (still accurate where not superseded above):
>
> - **Materialization uses a `git config` override, not a clone-time `-c`.** `git submodule update
>   --init` runs `submodule init`, which copies the `.gitmodules` url into `.git/config` — it does
>   *not* respect a `submodule.<name>.url` set via `-c` on the `git clone`, so that override is lost.
>   The working sequence is: **plain** `git clone` (byte-for-byte the historical argv), then one
>   `git config submodule.<name>.url <childCloneUrl>` per edge (an **absolute** `/git/<childId>` url,
>   which `submodule update --init` *does* respect because it never re-derives an already-set url),
>   then the path-scoped `git submodule update --init`. See `WorkspaceService.submoduleWiringCommands`.
> - **API/MCP surface:** `GET /api/repositories/{id}/submodules` (now also reporting `available`
>   unimported entries) + `POST …/submodules/import`, and the `listSubmodules` tool on the
>   `repository` MCP server, backed by `RepositorySubmoduleDto` + `RepositorySubmoduleMapper` +
>   `RepositoryService.listSubmodules`. The UI surfaces both: a toggle on the repository create form
>   and the submodules section on the repository detail view
>   (`pattern/repository/repository-submodules.component.ts`).
>
> New test fixtures under `domain/src/test/resources/fixtures/`: `submodule-super.git` (diamond +
> depth over `submodule-child-a.git`, `submodule-shared.git`, `submodule-grandchild.git`),
> `submodule-cycle-a/-b.git` (cycle-pair linking), `submodule-simple-super.git` (single leaf, for the
> IT; the depth-2 IT drives `submodule-super.git`).

## Introduction

Add a real qits capability: when qits imports a git repository that has **submodules**, recursively
import each submodule as a **sibling `Repository` under the same `Project`** (deduplicated), and
materialize it **offline** inside a workspace container by fetching it from qits' own git host. This is
net-new product behaviour that applies to every repo qits imports — not fixture-only plumbing.

It is **split out of** the fixture-split prep plan as the piece that must ship **first**.

Related / dependent plans:

- `docs/epics/qits-testing-fixtures/features/2026-07-14_fixture-repos-split-and-submodules.md` — the **consumer** (shipped). Its
  `qits-fixture-quarkus-angular` fixture makes `src/main/webui` a real submodule → `qits-fixture-angular`;
  that submodule only materializes offline (Quinoa build succeeds in a workspace) **if this capability
  exists**. The prep doc's Phase 4 in-tree swap and its "Nested submodules in workspaces" section are
  the requirements that motivated this doc; that section is a summary pointing here.
- `docs/epics/qits-workspaces/features/2026-07-04_workspace-containers.md`,
  `docs/epics/qits-workspaces/features/2026-07-08_lazy-workspace-container-provisioning.md` — the materialization path
  (`RepositoryService` `--mirror` clone → container `git clone` from the JGit host) this extends.
- `docs/epics/qits-live-deployment/features/2026-07-07_qits-net-devcontainer-unification.md` — the shared `qits-net` and the
  `qits` git-host alias; this is why submodule fetches can resolve **offline**, without GitHub.
- `docs/epics/qits-testing-fixtures/features/2026-07-14_fixture-repos-history-purge.md` — grandparent plan (history purge).
  **✅ Shipped 2026-07-14** (moved from `docs/feature-ideas/`): the old bare `*.git` blobs are purged
  from `main`, anchored behind a `backup/pre-fixture-purge` tag.

## Motivation

qits materializes a workspace in two clones, **neither recursing submodules**:

1. Host: `git clone --mirror <url> <data-dir>/<repoId>/origin` (`RepositoryService.cloneRepository`,
   `RepositoryService.java:70-74`). A `--mirror` is bare — `--recurse-submodules` is a **no-op** here,
   and the mirror carries `.gitmodules` + the gitlink but **not the submodule's git objects** (they
   belong to a separate repo).
2. Container: `git clone --branch <br> http://<qits-host>:<port>/git/<repoId> /workspace`
   (`WorkspaceService.provisionContainer`, `WorkspaceService.java:130-140`) — **no
   `--recurse-submodules`**, and `qits-net` has no route to GitHub.

So a live submodule lands as an **empty directory** and the build fails. This blocks the fixture split
and any real user repo that uses submodules.

## Decisions locked in

| Question | Decision |
|---|---|
| Parent→child relationship | A **link entity** `RepositorySubmodule(parent, child, path, name)`, **not** a field on `Repository`. An edge lets one child be the submodule of several superprojects *and* be used standalone — which is what makes dedup possible. |
| Where the pinned commit lives | **Not stored.** It lives in the superproject's gitlink and is read at `submodule update` time. Storing it would drift from the gitlink. |
| Dedup scope | **Within a project**, keyed by **resolved url**. A child referenced more than once in a project is imported **once**; every reference is the same row. Two *different* projects get independent mirrors (`Repository` belongs to exactly one `Project`). Rule: **dedup within a project, isolate across projects.** |
| Child main workspace | **Suppressed** for imported children — a submodule is materialized *inside* its superproject's container, not as an independent sibling workspace. The child stays usable standalone (`createMainWorkspace` is idempotent, callable later). |
| Offline resolution | The committed `.gitmodules` uses a **relative url** (`../qits-fixture-angular.git`); qits overrides `submodule.<name>.url = ../<childRepoId>` at materialization so `../<childId>` resolves against the container origin `/git/<repoId>` → `/git/<childId>`, served by the JGit host. Completes on `qits-net`, no GitHub. |

## The model — submodules are sibling repositories linked by an edge

New link entity following the modern `RepositoryDaemon` pattern (Hibernate-generated UUID id, two
`@ManyToOne` FKs), **no field added to `Repository` or `Project`** (the DB `on delete cascade` handles
cleanup; the service queries the edge directly, as daemons are queried):

- `domain/.../repository/entity/RepositorySubmodule.java` — `@Entity @Table("repository_submodule")`,
  `@Id @GeneratedValue(strategy=UUID) String id`, `@ManyToOne(optional=false) Repository parent`,
  `@ManyToOne(optional=false) Repository child`, `String path` (`.gitmodules` `path =`), `String name`
  (the `.gitmodules` section name → the `submodule.<name>.url` config key). Unique constraint
  `(parent_repo_id, path)` makes re-import idempotent.
- `domain/.../repository/persistence/RepositorySubmoduleRepository.java` —
  `PanacheRepositoryBase<RepositorySubmodule, String>`; `findByParentId`, `existsByParentAndChild`.
- `domain/.../repository/dto/RepositorySubmoduleDto.java` + `mapper/RepositorySubmoduleMapper.java`
  (`@Mapper(componentModel="jakarta")`, flatten both relations to ids) — only if surfaced via API/MCP;
  otherwise defer.
- `domain/src/main/resources/db/migration/V33__repository_submodule.sql` (highest committed is V32):
  table + unique `(parent_repo_id, path)` + **two** FKs `references Repository (id) on delete cascade`.
  Both cascades are **mandatory**, not optional — `ProjectService.delete` deletes repositories one by
  one (`ProjectService.java:81-83`), so an edge whose other endpoint isn't deleted yet would throw a
  referential-integrity violation without them (the exact bug `V32` fixed for `command_agent_session`).

**Why store `name`+`path` but not `branch`:** `name` is needed at materialization as the
`submodule.<name>.url` key; re-deriving it would couple provisioning to whatever commit the origin's
branch currently points at. `path` is free and useful for diagnostics. `branch` is deliberately **not**
stored — the pinned commit lives in the gitlink; the `.gitmodules` `branch =` key only matters for
`submodule update --remote`, which this feature does not do.

## Host-side recursive import (`RepositoryService.cloneRepository`)

Add a private overload so the public signature and every existing caller
(`ProjectService.createRepositoryUnderProject`, seeds, REST/MCP) are untouched:

```
public  Repository cloneRepository(url, archetype, project)                        // unchanged entry
private Repository cloneRepository(url, archetype, project, visitedUrls, depth, createMainWorkspace)
```

Flow (extends today's lines 51-88, all inside the existing single `@Transactional`):

1. URL validation gate — unchanged (`RepositoryService.java:51-61`).
2. Create/persist row, mirror-clone, `detectDefaultBranch`, `writeRepositoryMetadata` — unchanged.
3. `createMainWorkspace` — **gated** on the flag: `true` for the top-level superproject, `false` for
   imported children.
4. **New: recurse.** Read `.gitmodules` from the mirror tree object; for each submodule resolve its url
   relative to `repo.url`; **dedup** via a new `RepositoryRepository.findByUrlInProject(url, projectId)`
   — reuse the existing row if present, else clone-and-recurse (`createMainWorkspace=false`); then
   persist a `RepositorySubmodule` edge if one doesn't already exist. Guard with a threaded
   `visitedUrls` set (normalized url) for A→B→A cycles and a `MAX_SUBMODULE_DEPTH` (≈10) backstop.

Whole recursion stays in **one transaction** (children join it — do **not** open `requiringNew` per
child, or a mid-tree failure commits orphan rows). A late failure rolls back all DB rows; partially
cloned on-disk `<data-dir>/<childId>` dirs become orphans — same failure mode as today's single clone,
amplified; documented, cleaned on retry.

## Relative-url resolution (`GitSubmoduleParser`)

A new pure `@ApplicationScoped` helper `domain/.../repository/control/GitSubmoduleParser.java` (kept
separate so parse/resolve are unit-testable without the transactional service):

- `readSubmodules(git, originPath, branch)` — `git.execAllowNonZero(originPath, "git","show",
  branch+":.gitmodules")`; **non-zero → empty list** (this is the no-op branch that keeps the ~45
  submodule-free fixture tests unchanged). Parse the INI-style output into
  `record Submodule(name, path, url, Optional<branch>)`; reject entries missing `path`/`url`; apply the
  same argv-safety gate (`-`/`ext::`/blank) to every resolved child url.
- `resolveSubmoduleUrl(superprojectUrl, rawUrl)` — mirrors git's relative-url rules:
  - not `./`/`../` → absolute, return as-is.
  - `../foo.git` against `https://github.com/wohlben/super.git` → `https://github.com/wohlben/foo.git`.
  - `../foo.git` against a **local bare path** `/abs/testing-repo.git` → `/abs/foo.git` (the fixture
    case, where a superproject is cloned from a local `.git` dir). One algorithm operating on the
    substring after scheme/authority: drop the last path segment, fold the `./`/`../` chain.

## Container materialization (`WorkspaceService.provisionContainer`)

Inject `RepositorySubmoduleRepository`. The clone stays the **plain, historical** argv; submodule
wiring is a separate step gated on the edge set (`WorkspaceService.submoduleWiringCommands`):

```
git  clone  --branch <br>  http://<qits-host>:<port>/git/<repoId>  /workspace   # unchanged
# then, per edge (only when edges is non-empty):
git  config  submodule.<name>.url  http://<qits-host>:<port>/git/<childId>
git  submodule  update  --init  --recursive
```

> **Deviation from the original plan (see the status note at the top).** The clone-time
> `-c submodule.<name>.url` override does **not** survive: `git submodule update --init` runs
> `submodule init`, which copies the `.gitmodules` url into `.git/config` and shadows the `-c` value.
> The reliable override is a `git config submodule.<name>.url <absolute /git/<childId> url>` **before**
> `submodule update` — `submodule init` respects an already-set url and does not re-derive it. An
> **absolute** child url is used (not a relative `../<childId>`), which is unambiguous and avoids
> relative-resolution surprises.

When `edges` is empty (the common case — plain `testing-repo`) the clone argv is **byte-for-byte
today's** and no extra command runs — which is what makes the existing suite a strict no-op **by
construction**. Each `/git/<childId>` is served by `QitsRepositoryResolver` from
`<data-dir>/<childId>/origin` (already on disk from the import). Offline on qits-net.

The two-step (plain clone, then `submodule update` via the existing `containerGit` seam whose
throw-without-`rm` keeps the superproject checkout on an unreachable submodule) is used over
`clone --recurse-submodules`. **Nested (transitive) submodules are not offline-resolvable** — the
overrides cover only the superproject's direct edges, so a submodule that itself has sub-submodules
fails the recursive update at the nested level. Single-level (the fixture case) works; nested container
materialization is a documented follow-up.

**Re-provision path needs no change:** `ensureContainer` (`WorkspaceService.java:691`) calls
`provisionContainer(repoId, …)`, and the edge lookup is keyed by `repoId` inside it — so submodule
wiring is reapplied on every fresh provision automatically. The "stopped → `docker start`" branch
correctly does not re-clone, preserving already-materialized submodules.

`QitsGitServlet` / `QitsRepositoryResolver` need **no change** — they already serve any `/git/<id>` whose
`<data-dir>/<id>/origin` exists, and a 36-char dashed UUID matches the resolver's id pattern.

## Test strategy

- **Host side is fully testable without docker** (mirror-clone + parse + resolve + dedup + edge creation
  run under `@QuarkusTest` with the global `FakeContainerRuntime`, like `RepositoryServiceTest`).
- **Container-side submodule *checkout* is NOT faithfully testable through the fake**: `FakeContainerRuntime`
  rewrites the parent clone url `http://…/git/<repoId>` → absolute `<data-dir>/<repoId>/origin`
  (`FakeContainerRuntime.java:403-411`), so a relative `../<childId>` would resolve to a non-existent
  `<data-dir>/<repoId>/<childId>`. Cover real materialization with a real-docker IT (behind `skipITs`),
  the only place `/git/<childId>` is actually served and resolved by real git.
- **New tests:** `GitSubmoduleParserTest` (plain JUnit — parsing + both resolution cases + safety gate);
  `RepositoryServiceSubmoduleTest` (`@QuarkusTest` + a **new bare fixture**: a superproject `.git` with a
  committed `.gitmodules` → `../child-a.git`, a sibling `child-a.git`, a grandchild for depth, a shared
  child for the diamond/dedup case) asserting child rows in the same project, correct edges, dedup
  (diamond → one child + two edges), cross-project isolation, cycle termination, children have no main
  workspace, and `ProjectService.delete` removes superproject + children + edges;
  `WorkspaceProvisionSubmoduleArgvTest` (exact clone/update argv per edge set); a **no-op regression
  test** (import plain `testing-repo`, assert zero edges and unchanged argv); a real-docker
  materialization IT.
- **Risk to the ~45 existing tests is zero by construction** — both new code paths are gated on
  "has `.gitmodules`" / "has edges", so submodule-free fixtures take the identical old path. Re-confirm
  `deleteRepositoryRemovesContainersAndOnDiskData` and the delete-cascade tests.

## Consequences / boundaries

- **qits grows a real feature** applied to every imported repo, not just fixtures: importing a repo with
  submodules adds the distinct submodules as sibling rows under the project (visible in the repo list); a
  child referenced more than once in the project is imported once.
- **Write path is out of scope.** Pushing a change made *inside* a submodule working tree from a
  workspace (a two-repo push) is not covered; workspace git verbs operate on the superproject. Known
  limitation until a use case needs it.
- **Orphaned-child GC is out of scope.** Deleting a superproject cascades away its edges but leaves a
  shared/standalone child's origin (correct — a standalone use is legitimate). A "GC orphaned imported
  submodule repos" pass is a possible follow-up, not auto-deletion here.
- **Only tip SHAs are pinned** (inherited trade-off), now across submodule levels.

## Touch points

- `domain/.../repository/entity/RepositorySubmodule.java` (new),
  `persistence/RepositorySubmoduleRepository.java` (new),
  `dto/RepositorySubmoduleDto.java` + `mapper/RepositorySubmoduleMapper.java` (new, optional/deferred),
  `db/migration/V33__repository_submodule.sql` (new).
- `RepositoryService.java` — recursion + dedup; new `RepositoryRepository.findByUrlInProject`.
- `GitSubmoduleParser.java` (new) — parse + relative-url resolution.
- `WorkspaceService.java` — `provisionContainer` argv (`-c submodule.<name>.url` + recurse/update); inject
  `RepositorySubmoduleRepository`.
- `FakeContainerRuntime.java` — test-strategy pivot (documented; not necessarily changed).
- No change: `QitsGitServlet`, `QitsRepositoryResolver`, `Project`, `Repository` entity.

## Acceptance

- Importing a repo with a submodule creates a sibling child `Repository` under the same project + a
  `repository_submodule` edge; a diamond reference yields one child + two edges; two projects importing
  the same superproject get independent children.
- A materialized workspace of a repo with a submodule has a **populated** submodule dir, fetched
  **offline** from the qits git host (verified with docker cut off from GitHub).
- Importing / materializing a submodule-free repo (`testing-repo`) is a byte-for-byte no-op; the full
  existing suite stays green.
- `ProjectService.delete` cleanly removes superproject + imported children + edges (no FK violation).

## Recommended commit breakdown

1. `feat(repo): RepositorySubmodule link entity + V33 migration` (+ `findByUrlInProject`) — additive.
2. `feat(repo): parse .gitmodules and resolve relative submodule urls` (`GitSubmoduleParser` + test).
3. `feat(repo): recursive submodule import with per-project dedup` (wire into `cloneRepository` + tests
   + submodule fixtures).
4. `feat(workspace): materialize submodules in provisioned containers` (argv + edge lookup + argv/no-op
   tests).
5. `test(workspace): real-docker submodule materialization IT` (behind `skipITs`).
6. *(optional)* `feat(api): expose repository submodule edges` (DTO/mapper via controller/MCP) — defer
   unless the UI needs the tree.

## Open follow-ups (not in this feature)

- Submodule **write path** (push from inside a submodule working tree).
- **GC** of orphaned imported children.
- Surfacing the submodule tree in the UI / MCP (commit 6).
