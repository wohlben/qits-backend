# Fixture repos as submodules — purge the nested bare repos from history

> **Status: shipped 2026-07-14.** The old bare `*.git` fixtures are purged from `main`'s history. The
> split + submodule wiring landed earlier via
> `docs/epics/qits-testing-fixtures/features/2026-07-14_fixture-repos-split-and-submodules.md`; this doc is the remaining **history
> purge**. What actually ran, and how it diverged from the proposal below:
>
> - **Tag-first safety, over HTTPS.** The executing session had no GitHub SSH key, so every push went
>   over **HTTPS** (VS Code Dev Containers credential helper). Before rewriting, the pre-purge tip
>   `f71cab3` was tagged **`backup/pre-fixture-purge`** and **pushed to origin** on the original
>   history — anchoring the untouched old history so the rewrite is fully reversible
>   (`git reset --hard backup/pre-fixture-purge && git push --force origin main`).
> - **Rewrite.** `git filter-repo --invert-paths` with two globs — `*fixtures/testing-repo.git/*` and
>   `*fixtures/testing-repo-quarkus-angular.git/*` — in a **fresh clone**, with filter-repo installed as
>   the **single-file script** (`raw.githubusercontent.com/newren/git-filter-repo`; no pip/pipx on the
>   box). 18 commits carried the blobs across **two** historical prefixes —
>   `service/src/test/resources/fixtures/testing-repo.git/` (pre-module-split) and
>   `domain/src/test/resources/fixtures/{testing-repo,testing-repo-quarkus-angular}.git/` (after) — and
>   both `*` globs covered them. `qits-fixture-angular` never lived as a bare in qits history, so no
>   third glob was needed. The one commit that touched **only** the bare files
>   (`Update testing-repo.git bare repo with new README commit`) became empty and was pruned. All SHAs
>   from the initial commit onward changed (`f71cab3` → `ea27179`, module-split commit `f827152` →
>   `c957522`); pack **4.61 → 3.92 MiB**.
> - **Force-pushed `main` only — not tags.** So origin's `backup/pre-fixture-purge` still reaches the
>   old history (and its blobs). Verified: `git log main -- '*fixtures/*.git/*'` is empty; the current
>   tree (the seven `submodule-*.git` plain-file bares + the three submodule mounts) is **untouched** —
>   the globs require a `.git/` path segment with children, which gitlinks and the `submodule-*.git`
>   dirs' children didn't match in a way that removed them.
> - **Logical purge now; physical purge deferred behind the tag.** Branch history is clean, but a full
>   `git log --all -- '*fixtures/*.git/*'` still reaches the blobs via the backup tag — **by design**.
>   The original plan's "delete + recreate the GitHub repo" (step 6 below) is **replaced** by: once
>   confident, delete the anchor — `git push origin :refs/tags/backup/pre-fixture-purge` — and let
>   GitHub gc reclaim the objects. **Not done here** (the tag is the whole point of keeping it).
>
> Everything below is the original proposal, kept as the record; where it says "two repos" or "delete +
> recreate the repo," see the header above for what actually shipped.

## Introduction

Extract the two committed bare git fixture repos (`domain/src/test/resources/fixtures/testing-repo.git` and `testing-repo-quarkus-angular.git`) into their own standalone GitHub repositories, integrate them back as **git submodules**, and **rewrite the qits history** so the nested bare repos never existed in it.

Related / dependent plans:

- `docs/epics/qits-testing-fixtures/features/2026-07-05_servable-quarkus-angular-fixture.md` — created the second fixture and the current "bare repo committed as plain files + gitignored editing checkout" layout this idea replaces. Its regeneration workflow section becomes obsolete.
- `docs/epics/qits-testing-fixtures/features/2026-07-05_quarkus-angular-fixture-full-integration.md` — the fixture's feature integration is untouched; only where the fixture *lives* changes.
- `docs/epics/qits-build-setup/features/2026-07-05_maven-build-cache.md` — the build-cache excludes for the fixture checkouts must be reworked (see Touch points).
- No open feature-ideas depend on this; it is orthogonal to [spa-observability](../../qits-observability/features/2026-07-06_spa-observability.md) (implemented) and `quarkus-angular-integration-guide.md`.

## Motivation

Today each fixture is a **bare repo committed as plain files** (76 tracked files of `objects/pack/*`, `refs/`, sample hooks), with a gitignored editing checkout beside it:

- The bare internals are opaque binary blobs in qits history — unreviewable diffs, and every fixture change permanently grows the superproject history (pack is only ~2.4 MiB today, so this is about *cleanliness and workflow*, not urgent size pressure).
- The editing workflow is awkward: edit in the gitignored checkout, push into the bare sibling, commit the resulting pack-file churn in qits.
- A repo-inside-a-repo confuses tooling (IDE git integrations, `git grep`, the sample-hooks noise in searches).

As submodules, the fixtures become **normal, browsable repos** with their own history; the superproject records a single pinned SHA (gitlink) per fixture, and the current gitignored editing checkouts *become* the submodule working trees — same paths, now tracked.

## Target state

1. Two new GitHub repos, e.g. `wohlben/qits-fixture-testing-repo` and `wohlben/qits-fixture-testing-repo-quarkus-angular`, seeded via `git push --mirror` from the current bare dirs (preserves all branches: `master`/`feature`, and `main`/`feature/greeting`/`feature/diverged`).
2. Submodules mounted at the **existing checkout paths** `domain/src/test/resources/fixtures/testing-repo` and `.../testing-repo-quarkus-angular` (drop the `.gitignore` entries for them; delete the `*.git` bare dirs).
3. qits history rewritten with `git filter-repo` so no commit ever contained `*.git` fixture files; force-push `main`.

## The bare-repo contract — derived at build time

Tests and both seed commands resolve the fixture as a **bare repo on the classpath** (`getResource("/fixtures/testing-repo.git")`) and clone/branch-probe against it. A submodule working tree cannot satisfy this directly:

- Its `.git` is a **gitfile** pointing into `<superproject>/.git/modules/...` — copying the tree into `target/test-classes` (what the Maven resource copy does today with the bare dirs) yields a broken non-repo.
- After `git submodule update`, the module store has the pinned commit checked out **detached**, with the fixture's branches only as remote-tracking refs (`refs/remotes/origin/*`) — but tests need them as real local branches of a bare repo.

So the classpath contract stays, and a small build step derives it: in `domain` (`generate-test-resources`) and `cli` (`generate-resources`, which today copies the fixtures dir as main resources), run per fixture:

```bash
git clone --bare <submodule-dir> target/<classes-dir>/fixtures/<name>.git
git -C target/<classes-dir>/fixtures/<name>.git fetch <submodule-dir> '+refs/remotes/origin/*:refs/heads/*'
git -C target/<classes-dir>/fixtures/<name>.git symbolic-ref HEAD refs/heads/<default-branch>
```

(exec-maven-plugin or a shared ant-run snippet; git is already a hard runtime dependency of qits via `GitExecutor`). The `SeedService`/`SeedWebappService` on-disk fallback paths (`domain/src/test/resources/fixtures/<name>.git`) must be updated to the derived `target/` locations — the source-tree path is now a working tree, not a bare repo.

## Trade-off: only HEAD's SHA is pinned

Today the committed pack files pin **every branch tip** exactly. A submodule gitlink pins only one commit; the other branches (`feature`, `feature/diverged`, …) are whatever the fixture remote had when the submodule was cloned/updated. Divergence/conflict tests depend on those tips.

Mitigation: treat the fixture repos as effectively append-only — any branch-tip change is deliberate and paired with a submodule bump in qits; the derivation step could additionally assert expected tip SHAs from a small committed manifest if this ever bites. Acceptable for a single-developer prototype.

## History rewrite plan

**Tool: [`git-filter-repo`](https://github.com/newren/git-filter-repo)** — the tool the git project itself recommends for history rewriting (`git filter-branch`'s own man page defers to it; filter-branch is slow and has correctness footguns, and BFG Repo-Cleaner can't do path-based deletion with this precision). It is a separate install, not part of core git: `pipx install git-filter-repo` (or `pip install`/distro package — it's a single Python script). By design it **refuses to run on a non-fresh clone** and strips the `origin` remote after rewriting, both deliberate safety rails against pushing a botched rewrite over the only copy.

1. Push the fixture repos (from the current bare dirs) **first**, verify all branches arrived.
2. Work in a **fresh clone** (`git clone git@github.com:wohlben/qits-backend.git rewrite && cd rewrite`) — this doubles as the untouched-original backup, since the existing working copy stays as-is.
3. Enumerate every historical path of the bare fixtures: `git filter-repo --analyze` writes reports to `.git/filter-repo/analysis/` (`path-all-sizes.txt` etc.); the fixtures predate the module split (`f827152`), so old locations like `src/test/resources/fixtures/*.git/**` must be covered too.
4. Rewrite:

   ```bash
   git filter-repo --invert-paths \
     --path-glob '*fixtures/testing-repo.git/*' \
     --path-glob '*fixtures/testing-repo-quarkus-angular.git/*'
   ```

   (exact globs from step 3's analysis). `filter-repo` rewrites **all refs**, updates commit messages that reference rewritten SHAs, and finishes with its own `reflog expire` + `git gc --prune=now`, so the local clone contains no trace of the old objects afterwards — no manual `git reflog expire --expire=now --all && git gc --prune=now --aggressive` pass is needed (that incantation is the manual equivalent, required only after filter-branch/BFG).
   Verify locally: `git log --all --oneline -- '*fixtures/testing-repo*.git/*'` is empty and `git count-objects -vH` shrank.
5. Re-add `.gitmodules` + gitlinks and all Touch-point changes in one follow-up commit; re-add the remote (filter-repo removed it) and `git push --force --all && git push --force --tags`.
6. **Server side — force-push alone does not delete the old objects from GitHub.** They stay reachable via GitHub's internal refs (PR heads, activity events) and any cached views until GitHub runs gc, which cannot be triggered by the user. For a single-developer prototype the pragmatic, guaranteed route is: after verifying the rewritten repo, **delete the GitHub repo and recreate it, then push the rewritten history** (loses stars/issues/PR metadata — none of consequence here). The alternative for repos that must be preserved is contacting GitHub Support to expire cached views and dislodged objects (the process documented in GitHub's "Removing sensitive data from a repository" guide, which this plan follows generally).
7. Consequences to accept: **all commit SHAs from the first fixture commit onward change**; every existing clone/worktree must be re-cloned (never pull a rewrite into an old clone — it merges the two histories back together); any commit hashes quoted in docs/issues become stale (grep `docs/` for 7+-hex strings and fix); local `~/.m2/build-cache` should be reset.

## Touch points

- `domain/pom.xml` — replace the testResource excludes (they excluded the *checkouts*; now exclude the submodule dirs entirely from the plain copy) + add the derivation step.
- `cli/pom.xml` — same for the shared-fixtures main-resource block.
- `.mvn/maven-build-cache-config.xml` — the submodule working tree is now the test input and should be hashed, but building the servable fixture in place creates its `target/` and `node_modules/` inside it again → exclude those *inner* paths (`src/test/resources/fixtures/testing-repo-quarkus-angular/target`, `.../node_modules`) instead of the whole checkout.
- `SeedService`/`SeedWebappService` disk-fallback paths → derived `target/` bare repos.
- `domain/src/test/resources/fixtures/.gitignore` — delete (nothing left to ignore).
- `CLAUDE.md` "Test fixtures" section + `README.md`: fresh clones now need `git clone --recurse-submodules` (reversing the current "no `--recurse-submodules` needed" note); editing workflow becomes commit+push in the submodule, then bump the gitlink.
- CI/fresh-checkout instructions anywhere else that assume a plain clone suffices.

## Alternative considered

A single `qits-fixtures` repo that commits the bare `*.git` plain files exactly as today, submoduled at `fixtures/`: zero build changes, exact pinning of all refs — but it keeps the opaque-pack-files editing workflow, just one repo over. Kept as fallback if the derivation step proves flaky.

## Acceptance

- `git log --all -- '*fixtures/testing-repo*.git/*'` on the rewritten repo returns nothing.
- Fresh `git clone --recurse-submodules` + `./mvnw install` is green with no other manual steps.
- `seed` and `seed-webapp` both work against a running service (branch discovery, divergence probes, web view).
- A fixture edit round-trip works: commit in submodule → push → bump gitlink → tests see the change.
