# Fixture repos: split, extract the Angular SPA, compose via submodules

> **Status: shipped 2026-07-14.** The three GitHub repos exist and are populated, the in-tree fixtures
> are git submodules, and the build derives the classpath bares from them offline. What actually
> landed, and where it deviated from the plan below:
>
> - **Three repos created & pushed** — `wohlben/qits-fixture-testing-repo` (`master`/`feature`),
>   `wohlben/qits-fixture-angular` (`main`, `feature/greeting` FF, `feature/diverged` conflict — the
>   SPA carved out with `git subtree split`, plus a standalone README on `main`),
>   `wohlben/qits-fixture-quarkus-angular` (`main`/`feature/greeting`/`feature/diverged`, each pinning
>   the matching `angular` tip through a `src/main/webui` submodule with relative url
>   `../qits-fixture-angular.git`).
> - **Phase 3 divergence built for gitlink-only divergence** (matches *Consequences*), which the plan's
>   naive per-branch loop would **not** have produced: `main'` = main tip + de-vendor (submodule pinned
>   at angular `main`); `feature/greeting'` = `main'` + a gitlink bump to angular `feature/greeting` (a
>   clean superproject FF); `feature/diverged'` = main tip + an independent de-vendor pinning angular
>   `feature/diverged` (diverges from `main'` by the gitlink + `.gitmodules` only — backend text
>   identical). The original early-branched `feature/diverged` backend history was intentionally dropped.
> - **In-tree swap (Phase 4)** — the three submodules mount at the unchanged fixture dir names
>   (`testing-repo`, `testing-repo-angular`, `testing-repo-quarkus-angular`) with **relative**
>   `.gitmodules` urls (follow qits' own origin protocol). `scripts/derive-fixture-bares.sh`, run via a
>   `runAlways` maven-antrun step in domain/service/cli, derives the classpath bares from each
>   submodule's fetched refs. The angular bare is derived as **`qits-fixture-angular.git`** (not
>   `testing-repo-angular.git`) so the quarkus-angular fixture's `../qits-fixture-angular.git` resolves
>   to a sibling on the classpath during qits' recursive submodule import — offline.
> - **Not done here** (unchanged from *Open follow-ups*): the parent plan's `git filter-repo`
>   history purge of the old bare `*.git` blobs; a dedicated seed/tests for the standalone
>   `qits-fixture-angular`; submodule *write*-path support.

## Introduction

Preparatory plan that turns the two committed bare fixtures into **three** standalone GitHub
repositories, **extracts the Angular SPA** out of the Quarkus fixture into its own showcase repo, and
recomposes it back as a **nested submodule** (`quarkus-angular` → `src/main/webui` → `angular`). This
is the "create the repos + split the code + link it back in" groundwork; it deliberately stops short
of the qits-history purge.

Related / dependent plans:

- `docs/features/2026-07-14_workspace-submodule-support.md` — the **qits capability this prep depends
  on**, split out to be implemented **first**: recursive import of a repo's submodules as sibling
  repositories, materialized offline via the qits git host. **✅ Shipped 2026-07-14** (moved from
  `docs/feature-ideas/`), so Phase 4 (the in-tree fixture swap) is now unblocked. Two things to carry
  forward into Phase 4: materialization is **single-level** (a superproject's direct submodules — fine
  for `webui` → leaf `angular`; a nested submodule level would not resolve offline), and the container
  wires each submodule via `git config submodule.<name>.url <…/git/<childId>>` before
  `submodule update` (not a clone-time `-c`). This doc's *Nested submodules in workspaces* section was
  the requirement; the shipped doc is the authoritative spec.
- `docs/features/2026-07-14_fixture-repos-history-purge.md` — the **parent** plan (fixtures-as-submodules +
  `git filter-repo` history rewrite of the superproject). This prep doc **fed** it: it produced the
  three GitHub repos and the working submodule wiring; the parent's history-rewrite section (purging
  the old bare `*.git` blobs from qits history) ran **after** this. **✅ Shipped 2026-07-14** (moved
  from `docs/feature-ideas/`) — the blobs are purged from `main` (`f71cab3` → `ea27179`), anchored
  behind a `backup/pre-fixture-purge` tag so the physical removal on GitHub is deferred but reversible.
  This doc superseded the parent's "two repos" target with a **three-repo** target.
- `docs/features/2026-07-05_servable-quarkus-angular-fixture.md` — created the Quarkus+Angular fixture
  and the current "bare repo committed as plain files + gitignored checkout" layout being replaced.
- `docs/features/2026-07-05_quarkus-angular-fixture-full-integration.md`,
  `docs/features/2026-07-06_spa-observability.md`,
  `docs/features/2026-07-11_spa-telemetry-meta-enrichment.md`,
  `docs/features/2026-07-14_capture-state-snapshot.md` — the SPA features that move **with** the SPA
  into the new `angular` repo. Their behaviour is untouched; only where the SPA lives changes.
- `docs/features/2026-07-13_qits-angular-integration-library.md` — the SPA depends on `@qits/angular`
  (`git+https://github.com/wohlben/qits-angular-integration.git#<sha>`). That library repo already exists and is
  **not** part of this split; it stays a normal git dependency of the extracted SPA (pnpm still
  fetches it from GitHub, exactly as today).
- `docs/features/2026-07-05_maven-build-cache.md` — the build-cache excludes and the per-module
  input-hashing must be reworked (see Touch points).
- `docs/features/2026-07-04_workspace-containers.md`,
  `docs/features/2026-07-08_lazy-workspace-container-provisioning.md` — the workspace-materialization
  path (`RepositoryService` `--mirror` clone + container clone from the JGit host) is what the nested
  submodule extends; see **Nested submodules in workspaces**.
- `docs/guides/quarkus-angular-integration.md` — durable guide; the "where the SPA lives" note and any
  fresh-clone instructions get updated in the same change.

## Decisions locked in

| Question | Decision |
|---|---|
| Repo naming | **`wohlben/qits-fixture-*` prefix** — `qits-fixture-testing-repo`, `qits-fixture-angular`, `qits-fixture-quarkus-angular`. Fixture **directory** names in qits stay unchanged. |
| Angular scope | **Both** — the `angular` repo is a qits fixture in its own right (Angular-only workspace showcase) **and** the `src/main/webui` submodule of the Quarkus fixture. |
| Workspace SPA delivery | **Real submodule via a *relative* URL; each submodule becomes a first-class `Repository` under the same `Project`** — `src/main/webui`'s `.gitmodules` url is `../qits-fixture-angular.git`, which resolves against the superproject's origin (GitHub for humans, the qits git host in a container). qits recursively imports submodules as **sibling repositories** so the fetch resolves **offline on qits-net**. No flattening. |
| SPA history | **Subtree split** — carry the ~13-commit `src/main/webui` history (the `@qits/angular` / observability integration narrative) into the `angular` repo. |

> **Scope note.** The workspace-SPA decision turns this from pure fixture packaging into a small **qits capability** — "workspace submodule support" — because a real nested submodule must resolve when qits materializes a workspace. It builds on qits' existing **multiple-repositories-per-project** model: a submodule is imported as another repository bundled under the same project, linked to its superproject by a parent + mount-path. A genuine product feature (real user repos use submodules too), scoped below in *Nested submodules in workspaces*. It **replaces** the parent plan's "derived flattened bare" idea for the runtime path.

## Use cases & target repository set

Each fixture earns its place by the qits capability it exercises. The split adds a pure-frontend axis
and a nested-composition axis.

| Repo (GitHub `wohlben/…`) | Fixture dir (unchanged) | Use case in qits | Branches |
|---|---|---|---|
| `qits-fixture-testing-repo` | `…/fixtures/testing-repo` | **Git mechanics**: clone, pull, branch discovery, ahead/behind/conflict divergence probes, the JGit git host. Drives the divergence/conflict unit tests. | `master`, `feature` |
| `qits-fixture-angular` *(NEW)* | `…/fixtures/testing-repo-angular` *(NEW)* | **Angular-only workspace**: framework detection = Angular, SPA capture button / OPTIONS-gated availability, `withQitsSnapshot` state capture, `@qits/angular` consumption — all **without a backend**. Standalone showcase of the frontend surface. | `main`, `feature/greeting` (FF), `feature/diverged` (conflict) — the divergence is Angular content (`greeting.ts`). |
| `qits-fixture-quarkus-angular` | `…/fixtures/testing-repo-quarkus-angular` | **Full-stack**: Quarkus framework detection, web-view proxy, OTEL + log observation, feature-flows, coding agent, backend git divergence. `src/main/webui` is a **submodule → `qits-fixture-angular`**. | `main`, `feature/greeting`, `feature/diverged` (each pins the matching `angular` branch). |
| `qits-angular-integration` *(exists)* | — (pnpm git dep) | The `@qits/angular` instrumentation **library**. Not part of this split; consumed by `qits-fixture-angular`. | — |

**Why the divergence follows the SPA.** Measured on the current fixture:

- `feature/greeting` differs from `main` in **exactly one file**: `src/main/webui/src/app/greeting.ts`
  (a single FF commit, "Add a welcome note under the greeting"). Pure Angular content.
- `feature/diverged`'s conflicting commit ("Reword the greeting") also lands in `greeting.ts`.

So the greeting divergence is *native* to the extracted SPA. In `qits-fixture-angular` it stays a real
text divergence. In `qits-fixture-quarkus-angular` the same three branches survive, but there the
divergence rides the **submodule gitlink** (each superproject branch pins a different `angular` tip) —
a genuine nested-submodule FF/conflict, which is itself part of "illustrating the whole thing." See
**Consequences** for what that changes about the probes.

## Minimal manual steps (you)

Everything else is scripted in-workspace. You only need to:

1. **Create three empty GitHub repos** (no README, no license — must be empty so the first push
   defines history):
   - `wohlben/qits-fixture-testing-repo`
   - `wohlben/qits-fixture-angular`
   - `wohlben/qits-fixture-quarkus-angular`
2. Confirm push access over SSH (`git@github.com:wohlben/…`) from this workspace — same key already
   used for `qits-backend` / `qits-angular-integration`.
3. (Per the parent plan's rule for the sibling library) pushing these fixture repos directly is fine —
   no checkpoint needed.

That's it. No local tooling install is required — the extraction needs only `git subtree` (stock git,
present); the chosen real-submodule direction drops the `git-filter-repo` flatten entirely.

## In-workspace execution plan

All staging happens under a single **gitignored** scratch dir so qits' own tree stays clean until the
final swap. Nothing here touches qits history yet.

```
/workspace/.fixture-staging/            # add to /workspace/.gitignore for the duration
  testing-repo/                         # clone of the (empty) qits-fixture-testing-repo
  angular/                              # clone of the (empty) qits-fixture-angular
  quarkus-angular/                      # clone of the (empty) qits-fixture-quarkus-angular
```

Add `.fixture-staging/` to `/workspace/.gitignore` first.

### Phase 0 — snapshot the source of truth

The current bare fixtures are the source of truth for branches/tips:

- `domain/src/test/resources/fixtures/testing-repo.git` — `master`, `feature`.
- `domain/src/test/resources/fixtures/testing-repo-quarkus-angular.git` — `main`, `feature/greeting`,
  `feature/diverged`.

Record each branch tip SHA (for a post-migration assertion). The gitignored editing checkouts
(`testing-repo/`, `testing-repo-quarkus-angular/`) are disposable.

### Phase 1 — `qits-fixture-testing-repo` (trivial mirror)

No split; just relocate.

```bash
git clone --bare domain/src/test/resources/fixtures/testing-repo.git .fixture-staging/testing-repo.git
git -C .fixture-staging/testing-repo.git push --mirror git@github.com:wohlben/qits-fixture-testing-repo.git
```

Verify `master` + `feature` arrived with the recorded tips.

### Phase 2 — `qits-fixture-angular` (subtree split of the SPA, with history)

Extract `src/main/webui` **per branch**, preserving history, from a working clone of the Quarkus
fixture:

```bash
git clone domain/src/test/resources/fixtures/testing-repo-quarkus-angular.git .fixture-staging/qa-work
cd .fixture-staging/qa-work
# one synthetic subtree history per fixture branch:
git subtree split --prefix=src/main/webui main            --branch angular-main
git subtree split --prefix=src/main/webui feature/greeting --branch angular-feature-greeting
git subtree split --prefix=src/main/webui feature/diverged --branch angular-feature-diverged
```

`git subtree split` rewrites each branch to only the `src/main/webui` subtree, dropping non-webui
changes from mixed commits (7 of the 15 commits touch both — subtree keeps the commit boundary where
webui changed). The FF/conflict relationships are preserved because subtree split keeps the DAG.

Push into the `angular` repo with the fixture's expected branch names:

```bash
git push git@github.com:wohlben/qits-fixture-angular.git \
  angular-main:main \
  angular-feature-greeting:feature/greeting \
  angular-feature-diverged:feature/diverged
```

**Standalone-fixture touch-ups** (small commits on the `angular` repo, on `main` then merge/rebase the
feature branches — keep them so `feature/greeting` stays a clean FF over `main`):

- Add a top-level `package.json`/`angular.json` context so the SPA builds at the **repo root** (today
  it lives at `src/main/webui/` of the Quarkus app; after subtree split the webui files ARE the repo
  root, so `angular.json` etc. are already at root — confirm the build works with `pnpm i && pnpm build`).
- Add a `README.md` describing the Angular-only workspace use case and the `@qits/angular` dependency.
- Keep `proxy.conf.js` (it already degrades to base `/` → `:8080` for standalone `pnpm start`; with no
  backend the capture button self-hides via its OPTIONS probe — that IS the showcase).

### Phase 3 — `qits-fixture-quarkus-angular` (de-vendor the SPA → submodule)

Rebuild the Quarkus fixture with `src/main/webui` as a submodule. Work per branch so each superproject
branch pins the matching `angular` tip:

```bash
cd .fixture-staging/qa-work
# Point origin at the real GitHub superproject so the RELATIVE submodule url resolves to the
# sibling repo pushed in Phase 2 (else `../` resolves against the local bare path and add fails):
git remote set-url origin git@github.com:wohlben/qits-fixture-quarkus-angular.git
for br in main feature/greeting feature/diverged; do
  git checkout "$br"
  git rm -r --quiet src/main/webui           # drop the vendored SPA files (kept in history)
  git submodule add -b "$br" \
    ../qits-fixture-angular.git src/main/webui   # RELATIVE url → github.com/wohlben/qits-fixture-angular.git
  # gitlink now points at angular's $br tip; .gitmodules records url=../qits-fixture-angular.git, branch=$br
  git commit -am "Make src/main/webui a submodule of qits-fixture-angular ($br)"
done
git push origin main feature/greeting feature/diverged
```

**Why the relative url matters** (`../qits-fixture-angular.git`, not an absolute GitHub URL): a submodule
url beginning with `../` resolves against the **superproject's origin remote**, regardless of the
`src/main/webui` depth. So the *same* `.gitmodules` resolves to `github.com/wohlben/qits-fixture-angular.git`
for humans and to `http://<qits-host>:<port>/git/<siblingId>` inside a qits workspace container — the
mechanism that makes the nested submodule fetch offline on qits-net (see next section).

Result on GitHub: cloning `qits-fixture-quarkus-angular --recurse-submodules` yields the full app; the
superproject FF (`main`→`feature/greeting`) is now a gitlink advance; `feature/diverged` is a gitlink
conflict.

### Phase 4 — swap qits' in-tree fixtures to submodules + rewire the build

Only now touch qits' own tree (a normal reviewable commit on this branch):

1. Delete the bare dirs and gitignored checkouts:
   `domain/src/test/resources/fixtures/{testing-repo.git, testing-repo, testing-repo-quarkus-angular.git, testing-repo-quarkus-angular}`.
2. Add three submodules at the fixture paths (`.gitmodules` in qits):
   - `…/fixtures/testing-repo` → `qits-fixture-testing-repo`
   - `…/fixtures/testing-repo-angular` → `qits-fixture-angular` *(new standalone fixture path)*
   - `…/fixtures/testing-repo-quarkus-angular` → `qits-fixture-quarkus-angular`
3. Drop the fixture `.gitignore` (nothing left to ignore).
4. Apply the **Touch points** below (build derivation, seed fallbacks, cache config, docs).
5. Remove `.fixture-staging/` and its `.gitignore` entry.

The parent plan's `git filter-repo` purge of the now-deleted bare `*.git` blobs from qits history runs
**after** this lands and is otherwise unchanged (it just has three globs, or the same two — the new
`angular` repo never lived in qits history as a bare).

## Nested submodules in workspaces (the qits capability this needs)

> **Split out.** This capability is now specified in full in
> `docs/feature-ideas/workspace-submodule-support.md` and is implemented **first** (Phase 4 depends on
> it). The summary below is retained as the requirement that motivated it; the linked doc is the
> authoritative design.

qits materializes a workspace as: `RepositoryService` `git clone --mirror <fixture> origin`
(`RepositoryService.java:74`) → container `git clone --branch <br> http://<qits-host>:<port>/git/<repoId> /workspace`
(`WorkspaceService.java:139`, url from `cloneUrl`, `WorkspaceService.java:58`). Today **neither step
recurses submodules**: the `--mirror` origin carries `.gitmodules` + the gitlink but **not the
submodule's git objects** (they belong to a separate repo), and the container clone has no
`--recurse-submodules`. So a live `src/main/webui` submodule lands as an **empty directory** and
Quinoa's build fails. The container network (`qits-net`) also has no path to GitHub.

**Chosen resolution — each submodule becomes a first-class `Repository` under the same `Project`,
served offline via qits' own git host.** qits already models **multiple repositories per project**; a
submodule is just another repository in that project, related to its superproject by a parent link and a
mount path. This reuses all existing machinery — the git host already serves `/git/<id>` for any
repository, `--mirror` cloning, workspace creation, browsing/observability — so "serve the sibling" is
free. The relative url (`../qits-fixture-angular.git`) already points a container's submodule fetch back
at `http://<qits-host>:<port>/git/<X>` instead of GitHub; three small changes make `<X>` a real
sibling repository and the fetch succeed on qits-net:

1. **Model: submodules are sibling repositories, related by an *edge*.** A submodule is just another
   repository under the project; the parent→child relationship is a **link entity**
   `RepositorySubmodule(parentRepoId, childRepoId, path)`, *not* a field on the child. An edge (rather
   than a `parentRepository` field) lets **one** repository be the submodule of several superprojects
   *and* be used standalone — which is what makes deduplication possible. The pinned commit is not
   stored: it lives in the superproject's gitlink, read at `submodule update` time.
2. **Recursive import with dedup** (`RepositoryService.cloneRepository`). After the `--mirror` clone of a
   superproject, parse its `.gitmodules`; for each submodule, **resolve its url relative to the parent's
   url** (`../qits-fixture-angular.git` against `git@github.com:…/qits-fixture-quarkus-angular.git` → the
   GitHub sibling; against a local fixture bare → the local sibling). **If a repository with that
   resolved url already exists in the project, reuse it** (just add the `RepositorySubmodule` edge);
   otherwise clone it into the **same project** and recurse. So the child is imported **once** and every
   reference — nested submodule *and* standalone showcase — is the same row. Cycle/depth guard. (Consider
   suppressing the auto `createMainWorkspace` for child repos, or keep it — cheap now that containers are
   lazy.)
3. **Relative-url resolution + recurse at materialization** (`WorkspaceService`). The committed url is a
   *name* but qits addresses repos by id, so before the container clone set
   `submodule.<name>.url = ../<childRepoId>` (config override), then add **`--recurse-submodules`** to the
   container `git clone` in `provisionContainer` (`WorkspaceService.java:139`) — or a follow-up
   `git submodule update --init --recursive`. `../` resolves against the container origin `…/git/<repoId>`
   to `…/git/<childRepoId>`, which is served because the child is a real repository. Completes **offline
   on qits-net**.

Notes / boundaries:

- **Pathing is not a blocker.** The submodule mounts at a subpath (`src/main/webui`) of the *parent's
  working tree*, but the child is a whole repo; the path is only link metadata (on the edge) used at
  `submodule update`. qits' flat, id-keyed data-dir (`<data-dir>/<id>/origin`) puts child origins as flat
  siblings of the parent under `/git/`, exactly what `../<childId>` resolution needs.
- **One row per repo per project — dedup, not duplication.** Within a project the child is imported once
  (deduped by resolved url) and shared by every reference. Two *different projects* still get independent
  mirrors, because a `Repository` belongs to exactly one `Project` (the aggregate-root boundary); true
  cross-project sharing (many-to-many / unowned repos + ref-counted cascade) is deliberately out of
  scope. Rule of thumb: **dedup within a project, isolate across projects.**
- **This generalizes.** It is not fixture-only plumbing: any user repo with submodules gets the same
  offline, self-contained materialization, and its submodules surface as sibling repositories under the
  project. That is the argument for doing it properly here rather than flattening.
- **Build-time classpath contract (tests) is a smaller, separate sub-problem.** Tests resolve the
  fixture as a bare on the classpath (`getResource("/fixtures/…​.git")`); the parent plan already derives
  those bares in `target/` from the submodule working trees. For `qits-fixture-quarkus-angular` the
  derivation must run `--recurse-submodules` so the derived bare/working area carries SPA content for
  tests that read it (e.g. `AngularComponentParserTest` reads `greeting.ts`, `CaptureResourceTest`).
  Since the submodule working tree is already checked out in the qits source tree, the simplest path is
  to point those tests/derivation at the checked-out working tree; a **tip-only** flatten of just the
  classpath bare is an acceptable fallback (tests read files, they don't need the FF DAG).
- **`@qits/angular` is unaffected.** It is a pnpm git dependency resolved by `pnpm install` from GitHub —
  exactly as today, needing container internet for npm regardless. Only the *submodule* (source files)
  becomes offline-resolvable via qits; the npm graph is unchanged.
- **Divergence probes are unchanged in shape.** qits' ahead/behind/conflict probes run on the
  superproject; `feature/greeting` vs `main` is a gitlink (submodule-pointer) advance — a real FF — and
  `feature/diverged` a gitlink conflict, both handled by git natively.

## Consequences to accept

- **Quarkus-level divergence is now a gitlink divergence.** `feature/greeting`/`feature/diverged` on
  `qits-fixture-quarkus-angular` differ from `main` by the **submodule pointer**, not backend text. git
  treats a linear gitlink advance as a fast-forward and a two-sided gitlink move as a conflict, so
  seed-webapp's FF workspace and the ahead/behind probes behave as before — but a *manual* inspection of
  the diff shows `Subproject commit <sha>` lines, not `greeting.ts` text. The text divergence still
  exists, now one level down in `qits-fixture-angular`.
- **qits grows a real feature.** Recursive import of submodules as sibling repositories (deduped by url)
  + relative-url resolution + `--recurse-submodules` clone (see *Nested submodules in workspaces*) is
  net-new behaviour that ships with this and applies to every repo qits imports, not just the fixture.
  Importing a repo with submodules adds the distinct submodules as sibling rows under the project
  (visible in the repo list); a repo referenced more than once within the project is imported **once**.
- **Fresh clones need `--recurse-submodules`** (reverses today's "no `--recurse-submodules` needed"
  note), and nested: `git clone --recurse-submodules` of qits pulls
  `qits-fixture-quarkus-angular`, which pulls `qits-fixture-angular`.
- **Only tip SHAs are pinned** (per the parent plan's trade-off), now across two submodule levels.
  Treat the fixture repos as append-only; a branch-tip change is deliberate and paired with a gitlink
  bump.
- **Editing round-trip is now two-level** for a Quarkus-fixture SPA change: commit+push in
  `qits-fixture-angular`, bump the gitlink in `qits-fixture-quarkus-angular`, bump that gitlink in qits.

## Touch points

- **qits runtime (the new capability)** — new `RepositorySubmodule` link entity
  `(parentRepoId, childRepoId, path)` (+ a hand-written Flyway `V#__…​.sql` for its table); no parent
  field on `Repository`. `RepositoryService.cloneRepository` recurses `.gitmodules` into sibling child
  repositories under the same project, **deduped by resolved url** (url resolved relative to the parent),
  adding an edge per reference; `WorkspaceService` relative-url resolution (`submodule.<name>.url` →
  `../<childRepoId>`) + `--recurse-submodules` on the container clone (`WorkspaceService.java:139`);
  repository DTO/mapper + delete cascade already flow from the existing project→repositories
  relationship (the edge table cascades with either endpoint); `QitsRepositoryResolver` already serves
  any `/git/<id>` so needs no change. See *Nested submodules in workspaces*.
- `domain/pom.xml` / `cli/pom.xml` — replace the fixture-checkout excludes with the submodule-derived
  bare step; for `testing-repo-quarkus-angular` the derivation runs **`--recurse-submodules`** so the
  classpath bare carries SPA content for tests that read it (no flatten). Three fixtures now, not two.
- `.mvn/maven-build-cache-config.xml` — hash the submodule working trees as test inputs; exclude the
  *inner* generated paths that reappear when the servable fixture builds in place
  (`…/testing-repo-quarkus-angular/target`, `…/src/main/webui/node_modules`,
  `…/testing-repo-angular/node_modules`, etc.).
- `cli/src/main/java/.../SeedWebappService.java` — the disk-fallback fixture paths
  (`SeedWebappService.java:359,371-373`) point at the derived `target/` bare (a working-tree path is no
  longer a bare repo). Its clone source flows through the new recursive provisioning, so the seeded
  workspace's `src/main/webui` populates offline. `SeedService` similarly for `testing-repo`.
- `domain/src/test/resources/fixtures/.gitignore` — delete.
- `.gitmodules` (new, qits root) — three entries.
- `CLAUDE.md` "Test fixtures" section + `README.md` — three fixtures; nested submodule note; fresh
  clone needs `--recurse-submodules`; two-level editing workflow.
- `docs/guides/quarkus-angular-integration.md` — "where the SPA lives" (now a submodule).
- Any CI / fresh-checkout instructions assuming a plain clone.

## Acceptance

- The three GitHub repos exist with the expected branches/tips; `qits-fixture-angular` builds
  standalone (`pnpm i && pnpm build`); `qits-fixture-quarkus-angular --recurse-submodules` builds
  full-stack with its own `./mvnw`.
- Fresh `git clone --recurse-submodules` of qits + `./mvnw install` is green with no other manual step.
- A materialized `qits-fixture-quarkus-angular` workspace has a **populated** `src/main/webui`
  (submodule fetched offline from the qits git host) and Quinoa builds; `seed-webapp` produces the
  `greeting` FF workspace. Verified with docker unplugged from GitHub (only pnpm needs the network).
- A standalone `qits-fixture-angular` workspace detects Angular, serves the SPA, and shows the capture
  button self-hiding without a backend.
- Fixture edit round-trips: commit in `angular` → push → bump gitlink in `quarkus-angular` → bump in
  qits → tests/seed see the change.
- The parent plan's history purge can then run: `git log --all -- '*fixtures/*.git/*'` empty afterward.

## Open follow-ups (not in this prep)

- ~~The parent plan's `git filter-repo` superproject-history purge + GitHub repo recreate.~~ **✅ Done
  2026-07-14** — `docs/features/2026-07-14_fixture-repos-history-purge.md`. Purged from `main`; old
  history anchored behind a `backup/pre-fixture-purge` tag (physical GitHub gc / repo-recreate deferred
  until the tag is deleted).
- A dedicated `seed`/showcase or tests exercising the standalone `qits-fixture-angular` (the repo is
  created here; its qits-side consumption beyond framework-detection can follow).
- **Submodule support depth**: this plan covers *fetch/materialize* (read path). Pushing a change made
  *inside* a submodule working tree from a workspace (write path — a two-repo push) is out of scope;
  the workspace git verbs operate on the superproject. Flag as a known limitation until a use case needs
  it.
- The new recursive-provisioning behaviour deserves its own feature doc when implemented (it is a qits
  capability, not just fixture wiring); this prep doc is where it is first specified.
