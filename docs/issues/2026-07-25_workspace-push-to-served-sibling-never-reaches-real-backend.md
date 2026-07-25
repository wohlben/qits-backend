# A pre-served submodule backend is never synced, because `prepare` leaves it unlinked

## Introduction

Observed while landing the first commit of the extracted **qits-gateway** repository
(`docs/epics/qits-gateway/epic.md`) from inside a qits workspace, using the onboarding path in
[submodule backend onboarding](../epics/qits-project-repository-submodules/features/2026-07-25_submodule-backend-onboarding.md).

Related: `RepositoryService.prepareSubmoduleBackend` (creates the served sibling), the
`importDirectSubmodules` path (creates the `RepositorySubmodule` edge), `githost/GitHostRoutes` (what
a workspace pushes into), and the sync that pushes a repository's bare origin to its real backend.

## Observed

1. `prepare` pre-served the gateway's GitHub backend as a sibling, so the in-container
   `git submodule add ../qits-gateway.git qits-gateway` resolved. Committed and pushed. ✅
2. In the workspace, the submodule's `origin` is the qits git host
   (`http://qits:8080/git/<projectId>/qits-gateway.git`). `git push origin main` **succeeds**, and
   `git ls-remote` against that url shows the new commit. ✅
3. `github.com/wohlben/qits-gateway` stays at its previous commit. ❌ Sync — which *is* bi-directional
   — never touches this repository.
4. The superproject's submodule-pointer bump then breaks **GitHub Actions CI**, which checks out with
   `submodules: recursive` against GitHub and resolves `../qits-gateway.git` to the GitHub sibling:

   ```
   fatal: remote error: upload-pack: not our ref 03470b6dae47a2c132ad0ca3e2f58913c4c7f5f7
   fatal: Fetched in submodule path 'qits-gateway', but it did not contain 03470b6…
   ```

## Cause

**The pre-served sibling is not marked as a submodule of the superproject.** `prepare` creates the
sibling repository (and its name alias, so the git host serves it) but creates **no
`RepositorySubmodule` edge** — by design, since the `.gitmodules` entry does not exist yet at that
point; the edge is created later by an explicit **import submodules** run, once the entry is
committed and the superproject's bare origin has been refreshed.

Sync walks the superproject *and its submodule edges*. Confirmed on the live instance:
`listSubmodules(qits-backend)` returns exactly three edges — the three fixture repos — and none for
`qits-gateway`. So the gateway sibling is a repository nothing syncs: pushes into it land in the qits
mirror and stop there.

The trap is that **every step reports success**. The workspace push succeeds, the superproject
syncs, and the divergence is invisible until CI (or a fresh clone from GitHub) fails on a ref that
only ever existed inside qits.

## Unblocking the current state

On the `qits-backend` repository: **Pull** (refresh the bare origin, which now has the
`.gitmodules` entry on `main`), then **Import submodules** — the reference resolves to the GitHub
backend and dedups onto the already-served sibling, creating the missing edge. Sync then includes it
and pushes the gateway commit to GitHub, and CI resolves.

## Suggested fix direction

1. **Close the gap in `prepare`.** It already knows the superproject, the canonical backend url and
   the name — everything an edge needs except the mount path, which the caller supplies to
   `git submodule add` moments later. Either take the path as a parameter and create the edge
   immediately, or record the sibling as *pending* so sync and the UI treat it as part of the
   superproject before the first import.
2. **Warn on unlinked `.gitmodules` entries.** After a pull, an entry in the superproject's
   `.gitmodules` with no corresponding edge is a one-line detectable condition and exactly the state
   that silently breaks CI — surface it on the repository detail view with the "import submodules"
   action as the remedy.
3. **Report ahead-of-backend.** More generally, a repository whose bare origin holds commits its real
   backend does not is worth showing ("3 commits not on `<backendUrl>`"), whatever the reason — it
   turns a silent divergence into a prompt.
