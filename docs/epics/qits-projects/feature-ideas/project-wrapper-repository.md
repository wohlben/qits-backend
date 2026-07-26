# The project wrapper repository — every project starts as a monorepo it can grow out of

## Introduction

Every `Project` gains exactly one **wrapper repository**: a new `RepositoryArchetype.PROJECT`,
named `<project>-<project>` (for the `qits` project: `qits-qits`), created automatically as the
**last step of project creation** — so project creation always ends with one repository, no matter
what. When its main branch is empty it is seeded with a **project template skeleton**
(`services/` `libs/` `integrations/` `apps/`, one directory per repository archetype). It starts as a
plain monorepo with all code *inline* in those directories, which are later extracted into sibling
repositories and re-attached as submodules at the same path — so the wrapper *becomes* the
superproject of a polyrepo incrementally instead of in a big bang, and a directory's parent tells you
the archetype its extraction produces.

This is **step 1 of two**: it establishes the wrapper, its name rule, the archetype↔directory
taxonomy, and the skeleton.
**[wrapper-declared-repositories](wrapper-declared-repositories.md)** is step 2 — it makes the wrapper
the *registry* of the project's repositories (every repository registered as a submodule in its
archetype directory) and authors the `AGENTS.md` contract this step leaves empty.

Related / dependent plans:

- **[qits-projects](../epic.md)** — the owning epic; this changes `ProjectService.create`, the
  project's cascade semantics, and adds the first project-level validator.
- **[docs/guides/project-model.md](../../../guides/project-model.md)** — the current-state contract
  this feature *changes*: "a project is an application organized as a polyrepository" becomes "a
  project starts as one wrapper repository and grows into a polyrepository". Must be updated in the
  same commit.
- **[qits-project-repositories](../../qits-project-repositories/epic.md)** —
  [repository-discovery](../../qits-project-repositories/features/2026-05-01_repository-discovery.md)
  owns `RepositoryService.cloneOne`, the archetype enum, and the on-disk bare origins this feature
  extends with a *remote-less, locally-initialized* origin.
- **[qits-project-repository-submodules](../../qits-project-repository-submodules/epic.md)** — the
  name-alias table (`RepositoryName`), native relative-url resolution, and especially
  [submodule-backend-onboarding](../../qits-project-repository-submodules/features/2026-07-25_submodule-backend-onboarding.md),
  whose `prepareSubmoduleBackend` is the mechanism the later extraction step reuses. The naming rule
  below exists *because* of how relative submodule urls resolve.
- **[qits-workspaces](../../qits-workspaces/epic.md)** /
  **[qits-workspace-daemon](../../qits-workspace-daemon/epic.md)** — the wrapper must be workable
  from minute one, which is what forces the initial-commit mechanics below.
- **[startup-qits-self-seed](../../qits-live-deployment/features/2026-07-19_startup-qits-self-seed.md)**
  — the `qits` project it seeds is the sharpest test of the naming rule (see *Open questions*).

## The gap

`POST /api/projects` today creates a bare row and nothing else: a project with zero repositories,
zero workspaces, and no way to do anything until someone pastes a git url. Two problems follow.

1. **There is no "start here".** qits can only ever *adopt* code that already lives in a git repo
   somewhere. You cannot start a new application in qits.
2. **Polyrepo-from-day-one is the wrong default.** The project model guide is right that a project
   *is* a polyrepo — but that is the *end state*. On day one nobody knows the component split, and
   forcing the decision up front (create N repos, guess the boundaries) is exactly the decision that
   should be deferred. A monorepo that can shed components one directory at a time is the honest
   starting shape.

The wrapper repository closes both: creation always produces something workable, and the monorepo →
polyrepo transition becomes a per-directory operation on an existing repo rather than a migration.

## The naming scheme, and why it must be *enforced* (not just derived)

The wrapper is named **`<project>-<project>`**. This is deliberately redundant-looking, and the
redundancy is load-bearing:

- A repository's name is a **project-scoped alias** served at `/git/<projectId>/<name>`, and a
  committed **relative** submodule url (`../<name>.git`) folds against the superproject's *real
  backend* url (`GitSubmoduleParser.resolveSubmoduleUrl`). For `../<name>.git` to resolve to the
  same thing locally and at the forge, a repository's **local alias must equal its remote basename**
  (`RepositoryNameRepository.basename`).
- Forge namespaces are **flat**: qits' own components sit side by side as
  `github.com/wohlben/qits-backend`, `…/qits-gateway`, `…/qits-angular-integration`. The `<project>-`
  prefix is what makes a component name unique upstream, so the existing convention is already
  `<project>-<component>`.
- The wrapper's "component" *is* the project. Applying the same rule yields `<project>-<project>`.
  No special case, no second convention, and no collision risk with a real component (a component
  literally named `qits` inside project `qits` *is* the wrapper).

So the scheme is not cosmetic — it is the rule that keeps every sibling, wrapper included,
addressable by one name both locally and upstream. **Validate it in the backend at project
creation.** Concretely, as a required part of this feature:

1. **A new custom Bean Validation constraint on the project name** — `@ProjectSlug`, in
   `domain/src/main/java/eu/wohlben/qits/validation/` alongside `@NotBlankIfPresent`, applied to
   `ProjectController.CreateProjectRequest.name` and `UpdateProjectRequest.name`. The project name is
   concatenated into a git-servable path segment *and* a forge repository name, so it must
   round-trip through `basename()` unchanged: `^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])$` — lowercase
   alphanumerics and inner dashes only; no leading/trailing dash, no `.`/`..`, no `.git` suffix, no
   `/`, `:`, whitespace, or unicode. A rejected name returns 400 from the controller before any
   repository work starts.
2. **The wrapper name is derived and asserted, never supplied.** `ProjectService.create` computes
   `wrapperName = name + "-" + name`; there is deliberately **no request field** for it, so
   derivation *is* the enforcement. Before creating, assert the name is free in the project
   (`RepositoryNameRepository.findRepositoryByProjectAndName`) and reject with a
   `BadRequestException` otherwise — impossible on a fresh project, but load-bearing for the
   retro-fit and idempotent-seed paths.
3. **A supplied url (brownfield adopt) is validated against the derived name.** When project
   creation is given a url to adopt as the wrapper, require
   `basename(url).equals(wrapperName)` and reject with an actionable message naming both values
   ("upstream is `qits-backend`, the wrapper of project `qits` must be `qits-qits`: rename the
   upstream repo, or create the project as `backend`"). This is the single check that guarantees
   local alias == remote basename, i.e. that relative submodule urls resolve identically in the
   workspace container and at the forge.
4. **Renaming a project re-derives and re-validates.** `ProjectService.update` changing `name`
   leaves the wrapper's alias `<old>-<old>` stale. Two options, pick one explicitly:
   **(a)** rename the alias to `<new>-<new>` (cheap — one `repository_name` row) and warn that the
   configured backup remote's basename now mismatches, which the user must fix at the forge; or
   **(b)** refuse the rename while a wrapper exists. *(a) is recommended* — a name is a UI-level
   label and blocking rename over it is disproportionate — but it must be a decision, not an
   oversight.
5. **Tests for each rejection**: `ProjectServiceTest` for the derivation/assert/rename paths,
   `ProjectControllerTest` for the 400s (illegal slug, uppercase, dash-leading, `.git` suffix,
   basename mismatch on adopt).

## The archetypes: `PROJECT` plus the placeable set

`RepositoryArchetype` grows from `SERVICE, SERVICE_TEMPLATE, FORK` to:

| Archetype | Skeleton directory | Role |
|---|---|---|
| `PROJECT` | *(the wrapper itself — the repo root)* | at most one per project; the root superproject |
| `SERVICE` | `services/` | a deployable component (exists today) |
| `LIBRARY` | `libs/` | shared technical code consumed by the components |
| `INTEGRATION` | `integrations/` | an adapter/client toward another system (`@qits/angular` is one) |
| `APPLICATION` | `apps/` | an end-user-facing app (a SPA, a CLI) |
| `SERVICE_TEMPLATE` | *(none)* | scaffolding a component is generated *from*, not part of the app |
| `FORK` | *(none)* | a downstream fork — an external repo, never inline |

`LIBRARY`, `INTEGRATION` and `APPLICATION` are **new**; `SERVICE` already exists and keeps its
meaning. The four **placeable** archetypes are exactly the four skeleton directories below —
directory *is* archetype, in both directions: a directory under `libs/` extracted into a sibling
becomes a `LIBRARY`, and a `LIBRARY` submodule is mounted under `libs/`. `SERVICE_TEMPLATE` and
`FORK` stay **non-placeable**: neither is a component of *this* application, so neither has a home in
the wrapper's tree, and neither is a valid extraction target.

- **Put the mapping on the enum**, since the names don't mechanically derive (`libs` ≠ `LIBRARY`,
  `apps` ≠ `APPLICATION`): `SERVICE("services")`, `LIBRARY("libs")`, `INTEGRATION("integrations")`,
  `APPLICATION("apps")`, and `null` for the three unplaceable ones, exposed as
  `RepositoryArchetype.directory()`. One source of truth, and the template test below asserts the
  skeleton contains exactly the non-null set.
- **Adding enum values is behaviorally inert.** Nothing branches on archetype today — it is stored
  (`Repository.archetype`), written to metadata (`MetadataService`), parsed from in-repo config
  (`QitsConfigParser`), and surfaced in `RepositoryDto`/MCP listings. The only real enforcement is
  the DB check constraint below.
- **A Flyway migration is required for the enum values**, which is easy to miss: `V1__init.sql`
  declares `create table Repository (archetype varchar(255) check ((archetype in
  ('SERVICE','SERVICE_TEMPLATE','FORK'))) …)`. Inserting any of the four new values violates that
  check. The constraint is **anonymous** (H2 auto-names it `CONSTRAINT_n`), so `V44` should drop it by
  recreating the column rather than by name — add `archetype_new`, copy, drop `archetype`, rename —
  which is deterministic and portable to Postgres.
- **Uniqueness** is best carried by a nullable `project.wrapper_repository_id` FK (same `V44`): it
  enforces one wrapper per project structurally *and* gives an O(1) "which repo is the wrapper"
  lookup. The apparent redundancy with `archetype` is deliberate — `archetype` answers *what kind of
  repo is this* (UI, in-repo config, MCP listings), the FK answers *which repo is this project's
  wrapper*. The alternative (a `RepositoryRepository.findWrapperByProject` query plus a service-level
  guard, no FK) is simpler but unenforced; decide before implementing.
- **`PROJECT` is not user-selectable, but the domain needs an adopt seam.** Reject it at the
  *boundary* — `ProjectController.CreateProjectRepositoryRequest` returns 400 (the wrapper is not
  created through the repositories endpoint) and the UI's
  `repository-archetype-input.component.ts` drops the option. The *domain* exposes one
  `ProjectService.adoptWrapperRepository(project, url)` that validates the name rule, creates (or
  promotes) the repository with `archetype = PROJECT`, and sets the wrapper FK. Both
  `ProjectService.create` and the `qits` retro-fit below go through it; nothing else may.
- **In-repo config must not be able to promote a repository.** `QitsConfigParser` parses
  `repository.archetype` from a committed `.qits-config.yml`
  (`QitsConfig.RepositorySection`) and `RepositoryDiscoveryService` writes it onto the row — so today
  a committed config could mint a second wrapper. Reject `PROJECT` at the parser with a clear
  message; add a `QitsConfigParserTest` case.
- **Deletion.** The wrapper cannot be deleted on its own (`RepositoryService.delete` refuses it — it
  is the project root); it goes with the project. `ProjectService.delete` already deletes each
  repository via `RepositoryService.delete`, so with the FK in place it must **null
  `project.wrapper_repository_id` first**, exactly the ordering care it already takes for flow
  configurations vs. repository-scoped actions.

## The project template skeleton

A wrapper whose main branch has **no commit** is seeded with a **project template**: the empty
polyrepo layout the project will grow into, so `main` is never unborn and the archetype taxonomy is
visible on disk from the first clone.

```
README.md            what this project is, and what the layout means
AGENTS.md            empty placeholder — the agent contract is filled in by step 2
CLAUDE.md            → symlink to AGENTS.md
.qits-config.yml     starter config (the workspace-scoped source of truth)
.gitignore
services/README.md   deployable components        → archetype SERVICE
libs/README.md       shared technical code        → archetype LIBRARY
integrations/README.md  adapters toward other systems → archetype INTEGRATION
apps/README.md       end-user-facing apps         → archetype APPLICATION
```

- **Why a README per directory, not `.gitkeep`.** Git cannot commit an empty directory, so a
  placeholder is required either way — and a short README makes the skeleton *teach* the convention
  (what belongs here, and which archetype an extraction into it produces) instead of just reserving
  the path.
- **The template lives as classpath resources**, `domain/src/main/resources/project-template/`, walked
  and committed verbatim. That keeps it reviewable as ordinary
  files, lets it grow without touching Java, and makes the sync test trivial: **assert every archetype
  with a non-null `directory()` has a directory in the template, and every template directory maps
  back to an archetype.** That test is what keeps taxonomy and skeleton from drifting.
- **Written with plumbing, no worktree.** Build the nested tree in a temp index
  (`GIT_INDEX_FILE=<tmp> git update-index --add --cacheinfo <mode>,<sha>,<path>` per
  `hash-object -w` blob, then `write-tree` — which handles nesting, unlike `mktree`), then
  `commit-tree` + `update-ref refs/heads/<main>`, all directly in the bare origin. This is the
  commit-without-checkout technique `RepositoryService.mergeDivergedRemote` already uses.
- **Seed only when there is nothing to lose**: no refs at all in the origin (or no commit on the main
  branch). Never overwrite, never merge into existing history — so the second boot sees a commit and
  skips, and an adopted repository with real content is untouched.
- **Known hazard: unrelated histories.** If the skeleton is seeded locally and someone *then* pushes
  a first commit straight to the remote, the two roots share no merge base, and
  [diverged-remote-reconciliation](../../qits-project-repositories/features/2026-07-21_diverged-remote-reconciliation.md)'s
  `merge-tree` path has nothing to merge against. Either push the skeleton immediately on seed (needs
  credentials at boot — a surprising side effect) or detect the no-merge-base case in pull and report
  it as "remote has an unrelated root; adopt one side" rather than a raw git failure. The second is
  the smaller change and keeps boot side-effect-free; see *Open questions*.

### `AGENTS.md` (+ the `CLAUDE.md` symlink)

The wrapper is where a coding agent lands first, so the skeleton reserves its agent-contract slot —
the same `AGENTS.md` + `CLAUDE.md`-symlink pair this repository itself uses. In **this** step the
`AGENTS.md` is an **empty placeholder**: the layout convention is self-evident from the directory
READMEs, and the contract that actually needs writing down is the submodule discipline, which only
exists once repositories are registered into the wrapper — so it is authored by
[wrapper-declared-repositories](wrapper-declared-repositories.md) (step 2), which owns both the
convention and the code that upholds it.

- **Empty, not absent.** Creating the file (and its symlink) here means step 2 fills content into a
  path that already exists in every wrapper, and an agent landing in a wrapper created before step 2
  finds the file where it expects it rather than nothing at all.
- **No title, so no substitution.** Nothing in the skeleton is project-specific, which keeps it
  **committed verbatim** — no placeholders, no template engine, and the seeding path stays "copy
  resources into a tree".
- **The symlink is a real git symlink**, mode `120000` with a blob whose content is `AGENTS.md`. The
  plumbing path already takes an explicit mode per entry (`update-index --cacheinfo
  <mode>,<sha>,<path>`), so this needs no new mechanism — it is the reason to keep `cacheinfo` rather
  than a worktree-based commit.
- **It cannot be a symlink in the resource directory.** Maven resource copying dereferences symlinks
  and classpath loading won't reproduce one, so the template declares it instead: a
  `CLAUDE.md.symlink` resource whose *content* is the target path, committed at `CLAUDE.md` with mode
  `120000`. Self-contained in the template directory, and extensible to further symlinks without a
  side-car descriptor. (A `.qits-template-symlinks` manifest is the alternative; the suffix convention
  is less indirection for the one entry we have.)
- **A checkout without symlink support** (Windows, `core.symlinks=false`) gets `CLAUDE.md` as a plain
  file containing the text `AGENTS.md`. Harmless, and irrelevant to the Linux workspace containers
  that actually run the agent.


## Empty-wrapper mechanics

`cloneOne` requires a non-blank url and shells `git clone --mirror`. Two wrapper cases don't fit, and
both converge on the skeleton above — which is why this is **not** a deferrable second step: the
`qits` retro-fit hits the second case.

- **Greenfield (no url).** A sibling of `cloneOne` — `initWrapperOrigin` — runs `git init --bare` at
  `<data-dir>/<repoId>/origin` and `git symbolic-ref HEAD refs/heads/main`, so `detectDefaultBranch`
  yields `main` rather than falling back to `master`. Then: skeleton commit.
- **Adopted but empty upstream.** `git clone --mirror` of an empty remote succeeds but yields no refs,
  and `detectDefaultBranch` has no `HEAD` to read (the trap
  [submodule-backend-onboarding](../../qits-project-repository-submodules/features/2026-07-25_submodule-backend-onboarding.md)
  step 1 works around by telling you to push a README first). Instead of requiring that push: set
  `HEAD` to `main` and seed the skeleton. **This is what removes the "push a commit first"
  prerequisite** — a brand-new, completely empty `wohlben/qits-qits` is a supported starting state.
- **A container clone must land on a real branch.** Both paths exist because `createMainWorkspace` and
  the workspace container clone need `refs/heads/<main>` to resolve; an unborn branch is what the
  skeleton commit prevents.
- **`Repository.url` becomes nullable in the model** (greenfield only; the adopted case has a url).
  The DB column already is; the *code* is not.
  Walk the blast radius explicitly, since a null url reaches more places than it looks:
  `registerSelfName` (`basename(null)` → `""`; must take the derived wrapper name instead —
  arguably `registerSelfName` should accept an explicit name), `resolveSubmoduleUrl(repo.url, …)`
  during import (a relative `../x.git` cannot fold with no backend url ⇒ either require the remote
  before importing submodules into the wrapper, or reject relative urls with an actionable message),
  `findByUrlInProject` dedup, pull/sync/push (no remote ⇒ skip with "no backup remote configured"
  rather than a git error), and `MetadataService.writeRepositoryMetadata`.
- **Attaching the backup remote later** is a distinct action ("configure backup remote"): validate
  `basename(url) == <project>-<project>` (rule 3 above, same check), set `url`, `git remote add
  origin` in the bare, and push via the existing push technical process.

## Retro-fitting the seeded `qits` project (the only retro-fit)

Existing projects predate the wrapper, so the DB invariant is *at most one* wrapper; *exactly one* is
guaranteed only for projects created after this lands. Rather than a generic migration or an
"adopt wrapper" action for every project, **only the seeded `qits` project is fixed**, and it is
fixed through the mechanism that already exists for exactly this: `SelfSeedService.reconcile()` runs
on **every boot**, additively and idempotently (project matched by name, each repository matched by
exact clone url, per-item try/catch). Appending a manifest entry is therefore all a deployed instance
needs to grow the wrapper on its next start.

- **No upstream prerequisite.** `wohlben/qits-qits` may be **completely empty** — a repo created on
  GitHub and never pushed to. The adopt path clones it, finds no refs, and seeds the
  [project template skeleton](#the-project-template-skeleton) on `main`, so the first boot produces a
  workable wrapper with the polyrepo layout already in place. Nothing has to be pushed by hand first.
- **Manifest entry**: `https://github.com/wohlben/qits-qits.git`, archetype `PROJECT`,
  `importSubmodules = true`, `deepImport = false` — placed **first** in `manifest()`, since it is the
  project root and (once extraction starts) the superproject of the others. Ordering is otherwise
  free, given per-item idempotency.
- **The name rule holds exactly, with no escape hatch.** `basename("…/qits-qits.git")` is
  `qits-qits`, which is `<project>-<project>` for project `qits`. The adopt validation (rule 3)
  passes as-is — which is why this url is the right fix rather than adopting `qits-backend` as the
  wrapper, and why the strict form of rule 3 survives.
- **Route it through the adopt seam, not `createRepositoryUnderProject`.** `reconcileRepository`
  branches on `entry.archetype() == PROJECT` and calls
  `ProjectService.adoptWrapperRepository(project, url)`; the ordinary entries keep the existing path
  (which now rejects `PROJECT` at the boundary anyway).
- **Idempotent by promotion, not just by skip.** `adoptWrapperRepository` must handle three states:
  no such repository (clone + set archetype + FK), a repository with that url already present but
  registered as `SERVICE` (promote in place — set archetype and the FK, no re-clone), and already the
  wrapper (no-op). The middle case is the one that makes the retro-fit safe on an instance where
  someone registered `qits-qits` by hand first. This promotion path is deliberately the *only* way a
  repository becomes a wrapper after creation — the in-repo-config route stays rejected.
- **Url override for symmetry**: `qits.startup-seed.wrapper-url`, alongside the existing
  `qits.startup-seed.repo-url` / `…​.angular-integration-url` (mirror/fork/air-gap, and how
  `SelfSeedServiceTest` redirects each manifest url at a local fixture). The same
  "override changes item identity" caveat as the other two applies, plus one extra: an override whose
  basename is not `qits-qits` fails the name validation, so the fixture the test points at must be
  named accordingly (a `qits-qits.git` derived bare, or a per-test project name).
- **Extraction converges on the already-seeded siblings.** Because the wrapper imports submodules and
  import dedups by exact resolved url within the project, a future `../qits-backend.git` in
  `qits-qits`'s `.gitmodules` folds to `https://github.com/wohlben/qits-backend.git` — the url the
  manifest already registered — so it links the **existing** `qits-backend` row as its child instead
  of cloning a duplicate. The retro-fit and the transition below fit together with no extra
  reconciliation step.
- **No other project is touched.** Projects created before this feature stay wrapper-less and remain
  fully functional; the wrapper is only mandatory for new projects.
- **Sequencing**: the retro-fit adopts an existing url, so it needs the archetypes, the validation,
  the adopt seam, **and** the skeleton seeding (because that url starts empty) — but *not* the
  greenfield `initWrapperOrigin`/nullable-`url` half, which only a project created with no remote
  needs. That is the natural cut line for a first step that already fixes `qits`.

## Why the wrapper exists: the gradual polyrepo transition

An **inline repository** is just a directory in the wrapper destined to become its own repo — and the
skeleton says where it lives: `services/checkout/` is a `SERVICE`-to-be, `libs/schema/` a `LIBRARY`.
The extraction step (a follow-up part, sketched here so the naming rule's and the skeleton's purpose
is visible):

1. Pick a path in a wrapper workspace; `git subtree split` / `filter-repo` it into its own history.
   Its parent directory determines the new repository's **archetype** (`libs/` → `LIBRARY`), so
   nothing has to be asked or guessed.
2. Create the sibling repository under the project — named `<project>-<component>` by the same rule,
   initially remote-less, exactly like the wrapper (this is `prepareSubmoduleBackend`'s pre-serve
   with a locally-initialized backend instead of a cloned one, which is what makes the in-container
   `git submodule add ../<name>.git` resolve). It must carry **at least one commit** before that add —
   the split history provides it; a sibling created empty would hit `fatal: you are on a branch yet to
   be born` and leave a stale `.git/modules/<name>` behind.
3. `git rm -r --cached <path>` + register it as a submodule at `<archetype-dir>/<name>`, commit on the
   workspace branch, integrate. The registration itself is
   [wrapper-declared-repositories](wrapper-declared-repositories.md)' job (step 2) — extraction just
   calls it, so there is one place that knows how a repository is written into the wrapper.

Afterwards the wrapper is the superproject at the root of the imported-edge closure a workspace
materializes — the model the submodule epic already implements. Nothing about workspaces, serving,
or materialization needs to change; the wrapper simply *is* the top of that graph from day one.

## Touch points (implementation checklist)

- **domain**: `RepositoryArchetype` (+`PROJECT`, `LIBRARY`, `INTEGRATION`, `APPLICATION`, +
  `directory()`); `RepositoryService.initWrapperOrigin` + `seedProjectTemplate` (plumbing tree +
  commit) + `delete` guard; nullable-`url` handling across `registerSelfName`, submodule-url
  resolution, pull/sync/push, metadata; `ProjectService.create/update/delete`;
  `RepositoryRepository.findWrapperByProject`; `ProjectService.adoptWrapperRepository` (create /
  promote / no-op); new `@ProjectSlug` + validator; `QitsConfigParser` rejecting `PROJECT`.
- **resources**: `domain/src/main/resources/project-template/` — the committed skeleton
  (root `README.md`, `AGENTS.md`, `CLAUDE.md.symlink`, `.qits-config.yml`, `.gitignore`, and a README
  under each of `services/`, `libs/`, `integrations/`, `apps/`).
- **migration**: `V44__project_wrapper_repository.sql` — archetype check-constraint rebuild (all
  seven values) + `project.wrapper_repository_id`.
- **service**: `ProjectController.CreateProjectRequest` gains an optional `url` (adopt) and its
  `Response` returns the wrapper `RepositoryDto`; `CreateProjectRepositoryRequest` rejects
  `PROJECT`.
- **openapi**: regenerate via `OpenApiSchemaExportTest` — and sync **both** committed copies
  (`docs/openapi.yml` *and* `service/src/main/webui/openapi.yml`) before `pnpm generate:api`.
- **UI**: project create form (optional adopt-url); project detail marks the wrapper distinctly;
  `repository-archetype-input` gains `LIBRARY`/`INTEGRATION`/`APPLICATION` and drops `PROJECT`;
  repository detail hides delete for the wrapper and offers "configure backup remote" while `url` is
  null.
- **seeding**: `SelfSeedService` — the `qits-qits` manifest entry, the `archetype == PROJECT` branch
  to the adopt seam, and the `qits.startup-seed.wrapper-url` override; `SeedService` /
  `SeedWebappService` create projects and so now get wrappers too, and `seed-webapp`'s
  idempotent-by-reset contract must still hold.
- **tests**: wrapper created + named + workable (a workspace on the skeleton commit); adopting an
  **empty** upstream yields the skeleton on `main` (a bare fixture with no refs — the
  `submodule-*.git` family shows the committed-bare pattern); adopting a **non-empty** upstream leaves
  history untouched; the skeleton↔`directory()` sync test; `CLAUDE.md` lands as mode `120000` pointing
  at `AGENTS.md`; each validation rejection; `PROJECT`
  rejected from the repositories endpoint and from in-repo config; the retro-fit's three adopt states
  (create / promote / no-op) and its idempotency across two reconciles; project delete with the FK
  ordering; `ProjectServiceTest`, `ProjectControllerTest`, `QitsConfigParserTest`,
  `RepositoryDiscoveryServiceTest`, `SelfSeedServiceTest`.
- **docs**: update `docs/guides/project-model.md` in place (current-state contract), plus the two
  places that describe the self-seed manifest — `docs/guides/qits-in-qits-registration.md` and
  [startup-qits-self-seed](../../qits-live-deployment/features/2026-07-19_startup-qits-self-seed.md)
  (its manifest and Config sections list the entries and url overrides).

## Decided

- **The seeded `qits` project is fixed via the boot reconcile**, with
  `https://github.com/wohlben/qits-qits.git` as the wrapper — see the retro-fit section. This
  settles what would otherwise have been the feature's three hardest open questions: the self-seed
  needs no escape hatch (that url's basename *is* `qits-qits`), so **rule 3 stays strict** (no
  `allowNameMismatch` flag), and **no generic retro-fit exists** — `qits` is the only project fixed,
  every other pre-existing project stays wrapper-less.

## Open questions

1. **Unrelated-root divergence** (from the skeleton section): report a missing merge base as an
   actionable "remote has an unrelated root" in pull, or push the skeleton at seed time? Boot-time
   push needs credentials, so the pull-side message is proposed.
2. **Does the wrapper behave as a `SERVICE`** for feature-flows, actions, and framework detection, or
   does `PROJECT` need distinct handling anywhere those branch on archetype? (Nothing branches on
   archetype today, so this is about intent, not a current bug.)
3. **Is the placeable set closed at four?** `SERVICE_TEMPLATE` has a plausible `templates/` home, and
   `FORK` deliberately has none. Adding a directory later is cheap (a template file + an enum
   `directory()` value), so four is the proposal, not a ceiling.
4. **Does the skeleton's `.qits-config.yml` need content**, or is a commented starter enough? The
   wrapper has no service to run until something is extracted into it, so a stub may be more honest
   than a guessed config. (Step 2 answers this the moment submodules are registered: it needs a
   bootstrap chain.)
5. **The forge-org case.** A project that owns its own forge org (`github.com/qits/qits`) has
   basename `qits`, not `qits-qits`. Is `<project>-<project>` the enforced rule, or the enforced
   *default* with a per-project override of the wrapper name? (Not urgent — `wohlben/qits-qits`
   makes qits itself the flat-namespace case the strict rule is built for.)
