# Onboarding a newly-added submodule so its sibling points at the real backend

## Introduction

Extends **[workspace submodule support](2026-07-14_workspace-submodule-support.md)** (the
`RepositorySubmodule` sibling model, project-scoped name aliases, and the full-closure import) with
the missing *authoring* half: how a submodule that does **not exist yet** gets added to a repository
that qits already hosts, so its imported sibling points at the real backend (e.g. GitHub) instead of
at qits' own git host.

Motivated by extracting **`qits-gateway`** (`docs/epics/qits-gateway/epic.md`) into its own repo
(`github.com/wohlben/qits-gateway`) and wiring it as a submodule of the qits monorepo while qits is
being dogfooded — the qits repo is itself a repository (`qits-backend`) inside a running qits, whose
workspace container clones from the qits git host, not GitHub.

Related: `githost/GitHostRoutes` (name-addressed `/git/<projectId>/<name>` serving),
`RepositoryNameRepository` (the alias table), `GitSubmoduleParser.resolveSubmoduleUrl` (relative-url
folding). This is the deliberately-chosen **convention + convenience** onboarding path — not a
remap-what-was-committed mechanism.

## The problem

Adding a brand-new submodule to an already-hosted repo hits two failures the base feature never
covered, because it assumed submodules already existed in the imported `.gitmodules`:

1. **Chicken-and-egg on `git submodule add`.** Inside the workspace container, `git submodule add
   ../qits-gateway.git <path>` resolves the relative url against the container's `origin`
   (`http://qits:8080/git/<projectId>/qits-gateway`) and tries to clone it — but qits only serves a
   sibling once that sibling exists as a repository. Until qits-gateway is a served sibling, the add
   404s.

2. **Self-referential backend.** Import resolves each `.gitmodules` url against the parent's stored
   `Repository.url` (the real backend). A **relative** `../qits-gateway.git` folds correctly to
   `github.com/wohlben/qits-gateway.git` ✅. But an **absolute** `http://qits:8080/git/…` url (what
   you get if you commit the origin-resolved form) is kept verbatim, so the imported sister would
   `--mirror`-clone from **qits itself** — a caching loop, not the real backend. ❌

## The mechanism

### Convention — relative submodule urls

Committed submodule urls are **relative** (`../<name>.git`). Import folds them against the
superproject's real backend, so the sibling always points upstream. This works when the submodule's
backend is a sibling of the superproject's backend under the same host/org — the qits-gateway case
(`qits-gateway` alongside `qits-backend` under `github.com/wohlben`), and the shape all existing
`.gitmodules` fixtures already use.

### Convenience — pre-serve the backend (`prepare`)

`RepositoryService.prepareSubmoduleBackend(superprojectId, backendUrl)` clones the submodule's real
backend as a served sibling under the superproject's project **before** the `.gitmodules` reference
is committed, so the in-container `git submodule add` resolves. Key detail: it clones from the
**canonical** url the superproject's own re-import will resolve for `../<name>.git`
(`resolveSubmoduleUrl(superproject.url, "../<name>.git")`), not the raw `backendUrl` string — so a
later `importDirectSubmodules` **dedups onto this very sibling** (dedup is by exact url) instead of
creating a duplicate. Returns `{ repositoryId, name, relativeUrl, backendUrl }`; `relativeUrl` is
the value to `git submodule add`, and the returned `backendUrl` surfaces the resolved canonical url
so a cross-host mismatch is visible.

- **REST:** `POST /api/repositories/{repositoryId}/submodules/prepare` (`RepositorySubmoduleController.prepare`).
- **MCP:** `prepareSubmoduleBackend` on the `repository` server (for the coding agent).
- **UI:** an "Add a submodule — pre-serve its backend" control on the repository detail submodules
  section (`repository-submodules.component.ts`), which echoes the `git submodule add` line to run.

### Guard — reject qits-host self-references

`GitSubmoduleParser.isQitsHostUrl(url)` flags a url whose first path segment after the authority is
`/git/…` (qits' own git host). The import path (`importSubmoduleClosure`), `cloneOne`, and `prepare`
all **reject** such a url with an actionable `BadRequestException` steering to the relative
convention — so the caching anti-pattern becomes a clear error instead of a silently self-referential
sibling. Best-effort by design (keys on the distinctive `/git/` segment).

## qits-gateway walkthrough

1. Push at least one commit (a README) to `github.com/wohlben/qits-gateway` — a `--mirror` of an
   empty repo has no default branch for `detectDefaultBranch`.
2. On the `qits-backend` repository, `prepare` with the gateway's GitHub url (UI control, or `POST
   …/submodules/prepare`). qits now serves `/git/<projectId>/qits-gateway`; the response gives
   `relativeUrl = ../qits-gateway.git`.
3. In the `qits-backend` workspace: `git submodule add ../qits-gateway.git <path>`, commit, push.
4. Pull `qits-backend` in qits (refreshes its bare origin's `.gitmodules`), then **Import
   submodules** — the reference resolves to the GitHub backend and dedups onto the pre-served
   sibling, linking the edge. Done: qits-gateway is a sister repository pointing at GitHub.

## Files

- `domain/.../control/GitSubmoduleParser.java` — `isQitsHostUrl`.
- `domain/.../control/RepositoryService.java` — guards in `cloneOne` + `importSubmoduleClosure`;
  `prepareSubmoduleBackend` + the `PreparedSubmoduleBackend` record.
- `service/.../repository/api/RepositorySubmoduleController.java` — `prepare` endpoint.
- `service/.../repository/mcp/RepositorySubmoduleMcpTools.java` — `prepareSubmoduleBackend` tool.
- `service/src/main/webui/src/app/pattern/repository/repository-submodules.component.ts` — UI control.
- Tests: `GitSubmoduleParserTest` (`isQitsHostUrl`), `RepositoryServiceSubmoduleTest`
  (prepare→import dedup, idempotency, three guard paths), `RepositorySubmoduleControllerTest`
  (prepare REST + guard).

## Out of scope

- Building the qits-gateway **app** (the gateway epic).
- **Remapping** an already-committed qits-host url back to a backend (rejected in favor of the guard
  + relative convention).
- Automating the in-container `git submodule add`/commit (would need daemon container exec); the two
  git commands stay manual, everything around them is automated/guided.
