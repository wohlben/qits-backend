# Backend framework detection via a dedicated `/detection` endpoint

## Introduction

Detection — *what kind of project(s) a workspace holds*, *which files belong to which framework*, and
*which tests link to which source* — used to be computed entirely on the **frontend**, as a pure pass
over the loaded path list (`service/src/main/webui/src/app/shared/utils/detect-frameworks.ts`),
duplicated at two call sites (the file browser and the plugins recommender). This feature moves that
knowledge **server-side** behind one new endpoint,
`GET /repositories/{repoId}/workspaces/{workspaceId}/detection`, computed once over the workspace's
live working tree. The frontend now consumes structured metadata instead of re-deriving it from path
strings; the browser is ~200 lines lighter and renders what it's told.

`/files` is left **completely untouched** (still `paths: String[]`, still lazy) — detection is a
*sibling* endpoint, not an enrichment of the lazy `/files` levels. This avoids the transport break and
the per-level recompute the earlier "bake it into `/files`" draft would have needed (a lazy `?path=`
level never holds the full path set that link/membership resolution requires).

Related / dependent plans:

- **Reworks the detection half of**
  [framework-aware file browser](2026-07-03_framework-aware-file-browser.md). That feature's
  `detectFrameworks` / `owningProject` / `resolveLinkedGroup` / `linkedTestsOf` / `linkedSourcesOf` /
  `frameworkToRules` (all in `detect-frameworks.ts`) are now **backend-computed**; the framework
  filter, quick-access footer, test↔code tabs, and test-hiding all keep working but read the data off
  the detection query. `detect-frameworks.ts` shrank to a presentation module (icons + landing dirs).
- **Leaves the transport of** [lazy directory exploration](2026-07-03_lazy-directory-exploration.md)
  **untouched** — `/files` and its `{ paths, lazyDirs }` shape are unchanged.
- **Re-architects where framework membership is *computed*, not where filtering happens**
  ([workspace-filter-ordered-rules-and-ignorelists](2026-07-03_workspace-filter-ordered-rules-and-ignorelists.md)):
  the server owns *what belongs* to a framework (a resolved path set); the client's filter pipeline is
  unchanged — the framework rule still leads `effectiveFilters` as a `restrict` whitelist, ignorelists
  follow, manual wins last.
- **Interim freshness only; live push is a follow-up.** Detection is fetched once on demand (like
  `/files`) and cached server-side against a working-tree marker. The live SSE watcher that would
  *trigger* refetches when the agent scaffolds files without a commit is split into
  [detection live freshness over SSE](../feature-ideas/detection-live-freshness-sse.md).

## What was built

### Pure detector — `FrameworkDetectionService` (domain)

`domain/.../repository/control/FrameworkDetectionService.java`: a faithful, **container-free** Java
port of `detect-frameworks.ts`, pure over a `List<String>` of paths. It owns the framework registry
(three `Descriptor`s: `java-quarkus`, `ts-angular`, `docs`) and the ported helpers — `markerRoots`,
`docsRoots`, `owningProject` (deepest root wins), the CamelCase-prefix owner resolution
(`camelWords`/`camelPrefixes`/`ownerSource`, including the `[A-Z]*` single-match fuzzy fold), the
gitignore glob → regex translator (ported char-for-char, **not** `PathMatcher`), and the public API
`detect` / `linkedTestsOf` / `linkedSourcesOf` / `resolveLinkedGroup` / `memberPaths`. Unit-tested
case-for-case against the old TS spec.

### Orchestrator + endpoint — `DetectionService` (domain), `WorkspaceController` (service)

`DetectionService` mirrors `ComponentMapService`: the same `validate` gate (`ensureContainer`), the
same per-workspace cache **validated against a working-tree marker** (`git status`+`git diff` sha),
and `@Observes WorkspaceContainerStopping` eviction — so a refetch after the agent edits the tree is
always fresh, never keyed on the commit SHA. Per request it runs one `git ls-files`, the pure
`detect`, and two content peeks layered on top:

- **Label refinement**: reads each Java root's `pom.xml`; a match on `quarkus` refines
  `Java / Maven` → `Java / Quarkus` (removing the client's old marker-fetch round-trip and flicker).
- **Test-runner disambiguation**: emits open string `kinds`. Java tests → `"junit"`; a `*.spec.ts`
  takes its owning Angular project's runner, **config-detected** (the `angular.json` test builder,
  else `vitest.config.*`/`playwright.config.*`/`cypress.config.*`/`karma.conf.*`), else
  `"unspecified"` — never a hardcoded default (this repo's own SPA runs Vitest).

It returns one `DetectionDto { projects, frameworks, links }` (new plain records in
`repository/dto/`; `frameworkId` and `kinds` are **open strings**, not enums, so adding a
framework/runner needs no client regen and an older client degrades to a generic icon). The endpoint
(`GET .../{workspaceId}/detection`) mirrors the `component-map` handler; `/files` is untouched.

### Frontend — consume the detection query

`workspace-file-browser.component.ts` fetches `['workspace-detection', repoId, workspaceId]` once (a
sibling of the `/files` query; no polling). `detectedProjects`, `frameworkOptions`,
`frameworkQuickAccess`, `frameworkRootIcons`, `linkedGroup`, and the tree's redundant-test hiding all
rebind to the server data. Framework membership is served as a **path set**: selecting a framework
contributes a leading `restrict` whitelist whose match set is the server's `memberPaths` — a minimal
addition to `filter-file-paths.ts` (a `paths?: readonly string[]` field matched by identity). The
filter pipeline (`applyPathFilters`, `effectiveFilters`, manual-wins-last) is otherwise unchanged, so
multi-framework unions, ignorelist composition, and manual re-reveal of a framework-hidden file all
compose exactly as before. `detect-frameworks.ts` now exports only `frameworkRootIcon`,
`autoExpandDir`, and the `LinkedFile` type. The plugins recommender
(`workspace-plugins.component.ts`) reads the same detection query's `projects[]`, so plugin
recommendation and the file tree never disagree.

## Testing

- `FrameworkDetectionServiceTest` (domain) — the ported detection/membership/link matrix, mirroring
  `detect-frameworks.spec.ts` case-for-case (nested detection, deepest-root ownership, qualified-test
  binding, the `[A-Z]*` folding matrix incl. ambiguity and shared-first-word, angular `.spec.ts`
  symmetry, membership scoping, the gitignore glob translator). Parity is by ported specs, not a
  cross-language oracle — the generated TS client re-converges through the normal build.
- `WorkspaceControllerTest` (service) — `/detection` returns `projects` (pom-refined labels), all
  frameworks' `memberPaths`, and per-file `links` with `kinds` (`["junit"]` for Java, `["vitest"]` for
  a spec under a Vitest-configured Angular root) in **one** call; plus an empty/negative case; `/files`
  unchanged.
- Frontend specs (`workspace-file-browser`, `workspace-plugins`) feed a `DetectionDto` via the
  detection query cache and assert the component wires it (framework offers/quick-access, membership
  filtering, test↔code tabs, redundant-test hiding, plugin recommendation), including a manual
  whitelist re-revealing a framework-hidden file.
- `docs/openapi.yml` + the webui typed client regenerated (`OpenApiSchemaExportTest`,
  `pnpm generate:api`).
