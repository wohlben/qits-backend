# Backend framework detection & file classification, served through a dedicated detection endpoint

## Introduction

Today the workspace file browser figures out *what kind of project(s) a workspace holds* and *which
files are tests (and of what source)* entirely on the **frontend**, as a pure pass over the loaded
path list (`service/src/main/webui/src/app/shared/utils/detect-frameworks.ts`). This idea **moves
that knowledge into the backend** and ships it through **one dedicated detection endpoint** —
`GET .../{workspaceId}/detection` — returning the detected projects, per-framework membership sets,
and the source↔test link graph in a single call, computed once over the workspace's working tree.
The frontend consumes structured metadata instead of re-deriving it from path strings.

**Why a separate endpoint and not an enrichment of `/files`.** An earlier draft baked the metadata
*into* the `/files` response (per-file `role`/`tests`, a widened `paths`). That was rejected: (1)
`/files` reads the **live working tree** and is level-addressable/lazy, so per-file link data — which
needs the *full* path set to resolve — would be wrong on a `?path=<dir>` level or force a full-root
re-derivation on every lazy open; (2) `role`/`tests` are only needed when a file is *opened* (the
Code/Test tabs), so embedding them in every listing row bloats the transport with on-open-only data;
(3) it breaks the `/files` response type (`paths: String[] → record[]`) for no gain. Keeping `/files`
a **pure filesystem transport** and putting **all** detection behind one working-tree-keyed endpoint
avoids the recompute, the transport break, and the split-brain of two endpoints running the same
detection pass. See the Open questions.

Related / dependent plans:

- **Reworks the detection half of**
  [framework-aware file browser](../features/2026-07-03_framework-aware-file-browser.md). That
  feature's `detectFrameworks` / `owningProject` / `resolveLinkedGroup` / `linkedTestsOf` /
  `linkedSourcesOf` (all in `detect-frameworks.ts`) become **backend-computed fields**; the
  frontend's framework filter, quick-access footer, test↔code tabs, and test-hiding all keep working
  but read the data off the detection query instead of computing it. The `FrameworkDescriptor`
  *registry* moves server-side; the frontend keeps only presentation (icons/labels).
- **Leaves the transport of**
  [lazy directory exploration](../features/2026-07-03_lazy-directory-exploration.md) **untouched.**
  `/files` and its `{ paths, lazyDirs }` shape are unchanged — detection is a *sibling* endpoint, not
  an enrichment of the lazy levels. This is deliberate (see Introduction and Open questions):
  detection is a whole-tree concept and the eager root already contains every non-ignored file, so it
  resolves in one shot without smearing metadata across lazy `?path=` levels (`WorkspaceFilesService`,
  `WorkspaceController`).
- **Re-architects where framework membership is *computed*, not where filtering happens**
  ([workspace-filter-ordered-rules-and-ignorelists](../features/2026-07-03_workspace-filter-ordered-rules-and-ignorelists.md)).
  Today the client generates `restrict` glob whitelists (`frameworkToRules`) *and* evaluates them.
  This idea moves only the **membership computation** server-side: a framework request returns, as
  **metadata**, the set of paths each detected framework owns. The client's filter pipeline is
  **unchanged** — the framework filter is still a `restrict` whitelist that leads `effectiveFilters`,
  ignorelists follow, and a manual whitelist still wins last — the *only* change is that the rule's
  match set is now a server-supplied path set instead of a client-evaluated glob. Because all files
  stay in the client's set, everything (including manual re-reveal of a framework-hidden file)
  composes exactly as today. The division of labour: **server owns *what belongs* to a framework
  (extensible); client owns *applying* the filter (untouched).**
- **Consumed elsewhere too**: `pattern/workspace/workspace-plugins.component.ts` and
  `agent-plugin-registry.ts` call `detectFrameworks(paths)` to recommend agent plugins; they should
  read the same server-supplied project list so plugin recommendation and the file tree never
  disagree.

## Motivation

- **Single source of truth.** Detection heuristics currently live only in TypeScript and are
  duplicated at two call sites (the browser and the plugins component). A backend implementation is
  authoritative and language-agnostic — any future API consumer (CLI, coding agent, MCP tools) gets
  the same classification for free.
- **The backend already holds better inputs, cheaply.** The one content peek the frontend does —
  reading `pom.xml` to upgrade the `Java / Maven` label to `Java / Quarkus` — forces a lazy marker
  fetch (`frameworkMarkersToFetch`, `refinedLabel`) and a round trip. Server-side that is a local
  `cat` inside the container the listing already runs against (`ContainerFileAccess`), so the refined
  label ships in the first response with no extra request and no "unrefined then refined" flicker.
- **Richer test typing than the client can infer.** The client's classification is effectively
  two-valued (Java `*Test`/`*IT` vs. `*.spec.ts`) and keyed on the framework descriptor, not a named
  runner. Moving server-side lets us name the **runner** (`"junit"`, `"playwright"`, `"vitest"`,
  `"cypress"`, …, as open string ids), **detected from project config** where the extension alone is
  ambiguous (a `*.spec.ts` run by Vitest vs. Playwright) — the shape the request asked for:
  `tests: [{ filename, kinds[] }]`.
- **Smaller, honest client.** The browser stops owning ~200 lines of CamelCase-prefix test-matching
  and framework-glob logic; it renders what it's told.

## Proposed shape (one detection response)

`/files` is left alone. All detection ships from a single new endpoint, computed once over the
workspace's working tree:

```
GET .../{workspaceId}/detection
    -> DetectionDto {
         projects:   DetectedProjectDto[],   // one per detected root
         frameworks: FrameworkMembershipDto[],// per-framework resolved member path sets (the filter input)
         links:      FileLinkDto[]            // source↔test graph, precomputed
       }
```

```java
public record DetectedProjectDto(
    String root,          // dir relative to workspace root ("" = workspace root)
    String frameworkId,   // OPEN string id: "java-quarkus" | "ts-angular" | "docs" | ...  (NOT a closed enum)
    String label) {}      // presentation label, already pom-refined ("Java / Quarkus")

public record FrameworkMembershipDto(
    String frameworkId,
    String root,
    String label,
    List<String> memberPaths) {}  // the resolved set the client whitelists (see the membership section)

public record FileLinkDto(
    String path,               // a CODE file that has detected test(s)
    String projectRoot,        // owning project root, or null
    List<TestLinkDto> tests) {}// its detected test file(s) + runner kinds

public record TestLinkDto(
    String path,
    List<String> kinds) {}     // OPEN string ids: "junit" | "playwright" | "vitest" | ... (NOT a closed enum)
```

- **`frameworkId` and `kinds` are open `String` ids, not closed Java enums.** The whole design rests
  on a pluggable descriptor registry; a closed enum would make adding a framework an enum change +
  client regen, and would make an older client hitting a newer server *fail to deserialize* an
  unknown constant instead of degrading gracefully. The current client already keys on string ids
  (`'java-quarkus'`). The client maps unknown ids to a generic icon/label. This is the
  forward-compatible seam the feature is *for*: server owns *what belongs*; client owns presentation.
- **`projects`** is the server-side `detectFrameworks(...)` result: one entry per detected root,
  deepest root winning ownership (`owningProject`). Computed over the **full eager working tree**
  (`git ls-files --cached --others --exclude-standard` already returns every tracked + non-ignored
  file across the whole tree — not just top level — so markers `pom.xml` / `angular.json` and all
  tests are present; only *gitignored* dirs are lazy stubs and hold no framework markers).
- **`links`** is exactly what `linkedTestsOf` / `linkedSourcesOf` produce today, precomputed over the
  full path set. Shipping it from one endpoint (rather than per-file on `/files`) is what makes the
  full-path-set resolution correct — a lazy `?path=` level never has the full set. Symmetric
  test→source lookup is derivable by inverting `links`; the client keeps the group-normalization it
  already does (`resolveLinkedGroup` re-resolves the group off the *owning source* so any opened
  member shows the same tab strip — that stays client-side either way).

## Backend design

- **A pure detection service in `domain` control** — e.g.
  `repository.control.FrameworkDetectionService`, a straight Java port of `detect-frameworks.ts`:
  a registry of framework descriptors (detect roots, framework globs, `isTestPath`,
  `testCandidates`, `sourceCandidates`, the CamelCase-prefix owner resolution), plus `detect(paths)`
  and the link resolvers. **Pure over a path list — no container access** — so it is unit-testable
  without a container and mirrors `detect-frameworks.spec.ts` case-for-case. Keep the content-peek
  (below) as a *separate* injected step layered on top, so the pure pass stays a faithful port.
- **A thin orchestrator behind the endpoint** (in `WorkspaceFilesService` or a sibling): fetch the
  eager `git ls-files` set once, run `FrameworkDetectionService.detect(paths)`, apply the label peek,
  resolve membership + links, return the one `DetectionDto`. `/files` / `listRoot` / `listDirectory`
  are **not touched** — no per-file enrichment, no widened `paths`.
- **Faithful-port parity is a first-class risk.** `gitignoreGlobToRegExp` and the CamelCase-prefix
  owner resolution (`camelPrefixes` longest-first; the `[A-Z]*` *single-match-only* fuzzy rule) are
  subtle; a Java reimplementation can diverge silently and change which test binds to which source.
  Beyond "port the specs," add a **golden-parity test**: a fixed input path list → identical
  projects/links from TS and Java, keeping the TS as the oracle through the migration.
- **Label refinement server-side (separate step)**: the `pom.xml` Quarkus peek uses
  `WorkspaceFileAccess.read` (or a narrow `grep -qi quarkus` exec) once per detected Java root; the
  refined label ships in the detection response. Removes the client's `frameworkMarkersToFetch` /
  `refinedLabel` / `refinedKindLabel` machinery and its extra round trip.
- **Test-runner disambiguation**: extension-plus-context, emitting **open string kinds**.
  `*Test.java`/`*IT.java` → `"junit"`. For `*.spec.ts`, **detect the runner from config rather than
  guessing a canonical default** — read the owning project's test setup (`vitest.config.*` or
  `test` builder in `angular.json`/`package.json` → `"vitest"`; `playwright.config.*` → `"playwright"`;
  `cypress.config.*` → `"cypress"`; `karma.conf.*` → `"karma-jasmine"`). When nothing matches, emit
  `"unspecified"` — never silently assert a canonical runner. (Concretely: this repo's own
  `service/src/main/webui` runs **Vitest** (`@angular/build:unit-test`), so a hardcoded
  `karma-jasmine` default would mislabel qits' own SPA — hence config-detected, not defaulted.)
- **Config / strategy parity**: detection is deterministic and cheap; no new config needed. If it
  ever isn't, hang it off the same pluggable-strategy pattern as `LazyDirectoryStrategy`.

### Membership is metadata (a path set), not a filtered tree

Framework scoping is served by the `frameworks[]` slice of the **same `/detection` response** — the
"fetch-result-the-client-incorporates" idea borrowed from the lazy-directory pattern — but what it
returns is **membership metadata**, and the client still does the filtering. **It is not
per-framework** (that would be the N+1 storm to avoid — qits' four Java roots + Angular root): the one
detection call returns the membership of **all** detected frameworks at once, so toggling any subset
afterwards is pure client-side work with no re-fetch.

- **All frameworks in the one detection call.** `FrameworkDetectionService` evaluates each
  descriptor's `frameworkGlobs` (the ported `frameworkToRules` logic) against the eager tree and
  returns each detected framework's resolved member path set. The glob lists never cross the wire;
  the *resolved sets* do. Fetched on demand (async, when the file browser / framework UI is first
  engaged).
- **Freshness caveat — the resolved set is a snapshot, the globs weren't.** Today the filter is
  `**/*.java` evaluated client-side against the *current* path set, so a brand-new uncommitted
  `Foo.java` is scoped in the instant it appears. A server-resolved `memberPaths` snapshot only
  includes files present at fetch time. In a live-editing workspace (the coding agent scaffolds
  files) this must be re-fetched when the tree changes — see the working-tree-freshness open question;
  the same trigger that refreshes `/files` refreshes `/detection`.
- **The client filters, unchanged.** Selecting frameworks builds a `restrict` whitelist `PathFilter`
  from the union of the selected entries' `memberPaths` and drops it into the **same**
  `effectiveFilters` pipeline (`applyPathFilters`) used today — framework rule leads, ignorelists
  follow, manual whitelist wins last. Toggling is instant and offline; no request per selection
  change. This is why the manual-override behaviour is preserved: the framework filter hides files
  client-side, so a manual rule can still un-hide them.
- **Whole-tree by nature.** Membership is globs over the tree, so resolving the whole set in one shot
  (in the detection response) is cleaner than smearing per-file scope tags across the lazy `/files`
  levels (that alternative is noted in Open questions). Framework files aren't gitignored, so the
  eager tree already contains them — membership is complete without opening any lazy dir (same
  boundary the current client detection has).
- **Extensible seam.** Because membership is a server call, future scoping logic (a framework that
  spans non-glob-expressible sets, a "changed-since-branch" scope, a language-server-derived set)
  slots in behind the detection endpoint with **no client change** — the whole point of moving it.
  The client contract stays "here is a set of paths to whitelist," whatever computes it.

## Frontend changes

- `workspace-file-browser.component.ts`: drop `detectFrameworks`/`resolveLinkedGroup` calls; read
  `projects`, `frameworks`, and `links` off a single `GET .../detection` query. `detectedProjects`,
  `frameworkOptions`, `frameworkQuickAccess`, `linkedGroup`, and `treeVisiblePaths` test-hiding all
  rebind to the server data. `linkedGroup` reads the precomputed `links` graph (and its inverse for
  test→source) instead of running `resolveLinkedGroup`; the group-normalization off the owning source
  stays client-side (small).
- **Framework membership comes from the server; the client filter pipeline is untouched.** Delete
  `frameworkToRules` / `generatedFrameworkRules` / `generatedQuickFrameworkRules` (client glob
  evaluation) but **keep** the `framework` `DynamicFilter` variant and `effectiveFilters` exactly as
  they are. Fetch `GET .../detection` once (on demand); the quick-access footer + per-root dialog
  toggles select from its `frameworks[]`, and each active selection contributes a `restrict`
  whitelist built from that entry's `memberPaths`. The rules still lead `effectiveFilters`,
  ignorelists follow, manual wins last — so multi-framework unions, ignorelist composition, and
  manual re-reveal all behave identically to today. No per-toggle request; no restricted server tree.
- `detect-frameworks.ts` shrinks to presentation: framework `id → icon/label` maps
  (`frameworkRootIcons`) and a runner `kind id → icon` map (unknown ids fall back to a generic icon).
  The detection/matching functions and their spec move to (or are deleted in favour of) the backend.
- `workspace-plugins.component.ts` / `agent-plugin-registry.ts`: recommend plugins from the detection
  response's `projects` list.
- Regenerate `docs/openapi.yml` + the webui typed client (`OpenApiSchemaExportTest`).

## Trade-offs & open questions

- **Lazy-level ownership without the full tree.** Root detection sees everything eager; a `?path=`
  level into a *gitignored* dir (e.g. generated sources) has no project context from git. Resolve by
  passing the root `projects` down and attributing by prefix (`owningProject`) — a file in an
  unopened lazy dir simply inherits the nearest enclosing detected root, or `null`. Same limitation
  the current feature notes: a counterpart inside an unopened lazy dir isn't linked until opened
  (non-issue: tests aren't gitignored).
- **Working-tree freshness (the key one).** Detection depends on structural files (`pom.xml`,
  `*Test.java`, `angular.json`) and `/files` reads the **live working tree** — the coding agent can
  create/delete these *without a commit*. So detection (projects, membership, links) and the pom peek
  **must not be cached on the commit SHA** — that goes stale exactly when the agent scaffolds a module
  or test. Don't cache on the commit SHA — detection is "deterministic and cheap" (one `git ls-files`
  + a pure pass), so recompute per detection request and refresh it live.

  **Freshness mechanism: one watcher per workspace, fanned out over SSE.** A **single** file watcher
  per workspace, rooted at the **worktree root** (`/workspace`, recursive), pushes change events to the
  browser (no polling — the project's mandated freshness pattern), and both `/files` and `/detection`
  refetch off it. Crucially it is **one long-lived daemon tied to the container, not one per tab / SSE
  connection / query** — its lifecycle follows `ensureContainer` (start with the container, stop on
  teardown). It lives **inside the workspace container** — that's where the agent's edits land
  (`/workspace`, via `docker exec`) — so it's container-side `inotify` → qits → the browser SSE stream,
  one relay hop. qits holds a **single** subscription to that watcher and **fans out** to every
  connected SSE client via a per-workspace broadcaster (a hot `Multi` / broadcast sink); a new tab
  *attaches* to the existing broadcaster and never spawns a second watcher (inotify watches are a
  finite kernel resource — per-tab watchers would leak and duplicate).

  Carry the **change kind** in the event so the client refreshes only what's needed: a content-only
  edit to an existing file → refetch just that file's content; a **structural** change (a path
  added/removed, a new `pom.xml`/test) → refetch `/detection` (+ the affected `/files` level), since
  detection is a whole-tree concept. Debounce/coalesce a burst of edits into one refetch. Compute the
  tree generation/fingerprint (below) **once per raw event, centrally**, and broadcast a tick only when
  it actually changed — so a gitignored-dir edit (`node_modules/`, `target/`) that doesn't alter `git
  ls-files` yields the same fingerprint, no broadcast, and every listener is spared a no-op refetch,
  deduped in one place rather than N.

  This closes the freshness gap properly. Two things are distinct and only the second matters:
  *wire-atomicity* (both responses computed from one identical snapshot) genuinely needs a single
  request — the rejected `/files` enrichment — but nobody observes that. *Render-consistency* (the user
  never sees a skewed **combination** of tree + detection) is fully achievable with the two separate
  fetches: **stamp each SSE event and both endpoint responses with a cheap tree generation/fingerprint
  (hash of the sorted `ls-files`), and have the client apply detection only when its token matches the
  `/files` token it is rendering** — mismatched data is held, not shown. The SSE stream is the natural
  carrier for that generation token, so this is the design, not a bolt-on. Result: no visible drift;
  in-flight mutations resolve on the next event. (`memberPaths` snapshots are acceptable for the same
  reason — they refresh, generation-matched, with the tree.)
- **Open string ids vs. closed enums (settled).** `frameworkId` and `TestLinkDto.kinds` are `String`,
  not Java enums — so adding a framework/runner needs no enum change, and an older client degrades
  (generic icon) instead of failing to deserialize an unknown constant. Matches the client's existing
  string ids and the pluggable-registry premise.
- **Symmetric links.** Ship `links` (source→tests) and let the client invert for test→source, or also
  precompute a `sources` field? Inverting a small graph client-side is trivial and keeps the payload
  lean; recommend ship `links` and invert. (Either way the client keeps `resolveLinkedGroup`'s
  group-normalization off the owning source.)
- **No transport break.** Because detection is its own endpoint, `/files` keeps `paths: String[]`
  and every existing consumer is untouched — the earlier `paths → FileEntryDto[]` break is gone. New
  DTOs are additive, behind the new route.
- **Membership metadata vs. a filtered tree (settled).** Detection returns *membership* (path sets)
  and the client filters, rather than returning a pre-filtered tree. This is deliberate: it keeps
  every file in the client's set so the existing rule pipeline — including manual `wins-last`
  re-reveal of a framework-hidden file — composes unchanged. A server-side filtered tree would drop
  hidden files from the payload and break that override; not worth it.
- **One detection endpoint vs. per-file `scopes` on the `/files` rows.** Membership could instead be a
  per-file `scopes: string[]` tag baked into each `/files` entry, needing no new endpoint. Rejected as
  the primary shape because membership is a whole-tree glob concept and would have to be
  recomputed/streamed across every lazy `/files` level (and would re-break the `/files` type), whereas
  one detection call resolves all sets once; the dedicated endpoint is also the extensibility seam the
  design wants. Kept as a fallback only if the batched `memberPaths` payload ever proves too large
  (then tag per file and drop the endpoint).
- **`memberPaths` payload size.** The sets duplicate paths already in the tree (as strings) and a
  file can appear under several frameworks. For qits (~640 files) this is trivial; if it ever isn't,
  compress to root-relative paths or switch to the per-file-tag fallback above. Fetched with the
  detection call, not per toggle.
- **Content-peek cost.** One `pom.xml` read per Java root plus one runner-config peek per JS root, per
  detection request. Subject to the same working-tree-freshness rule above (don't cache on commit);
  almost certainly negligible either way.

## Touch points

- `domain/.../repository/control/FrameworkDetectionService.java` (new, **pure**, no container access)
  + spec (port of `detect-frameworks.spec.ts`) + a golden-parity fixture shared with the TS oracle.
- `domain/.../repository/control/WorkspaceFilesService.java` (or a sibling orchestrator) — add
  `detect(repoId, workspaceId)`: one `git ls-files`, run detection, apply the label/runner peek,
  return `DetectionDto` (projects + membership + links). **`/files` / `listRoot` / `listDirectory`
  unchanged.**
- `domain/.../repository/dto/` — new `DetectionDto`, `DetectedProjectDto`, `FrameworkMembershipDto`,
  `FileLinkDto`, `TestLinkDto`; ids are `String` (no `FrameworkId` / `TestKind` enums). `LazyDirDto`
  and the `/files` DTOs unchanged.
- `service/.../repository/api/WorkspaceController.java` — the new `GET .../{workspaceId}/detection`
  endpoint (one call: projects + all frameworks' membership + links); map the new records. Existing
  `/files` endpoint untouched.
- `service` webui: `workspace-file-browser.component.ts` (framework toggles select from the fetched
  `frameworks[]` and build `restrict` whitelists from `memberPaths`; `linkedGroup` reads `links`;
  delete `frameworkToRules`/`generated*FrameworkRules`, keep the `framework` `DynamicFilter` variant
  and `effectiveFilters`), `workspace-plugins.component.ts`, `agent-plugin-registry.ts`,
  `detect-frameworks.ts` (shrunk to presentation), specs.
- `docs/openapi.yml` + webui typed client (regenerate via `OpenApiSchemaExportTest`).
- `WorkspaceControllerTest` — assert `/detection` returns `projects`, per-file `links`/test-kinds, and
  **all** detected frameworks' `memberPaths` in **one** call; `FrameworkDetectionServiceTest` — the
  ported detection + membership matrix + golden parity against the TS spec.

## Acceptance

- `GET .../detection` on the qits workspace returns `projects` with the four `Java / Quarkus`
  roots (root/cli/domain/service, pom-refined) and the `TypeScript / Angular` webui root — no client
  round trips to refine labels.
- A source file (e.g. `AgentLaunchService.java`) links to its `*Test`/`*IT` counterpart(s) in `links`
  with `kinds: ["junit"]`; the Angular SPA's `.spec.ts` files link with `kinds: ["vitest"]`
  (config-detected, **not** a `karma-jasmine` default); opening either still shows working Code/Test
  tabs.
- The framework quick-access footer, per-root dialog filters, and redundant-test hiding behave
  identically to today, now driven by server data — including a **manual whitelist re-revealing a
  file that a framework filter hid** (the composition the metadata design preserves).
- Detection (projects + all frameworks' `memberPaths` + links) is fetched in a **single**
  `GET .../detection` request (verified in the network panel: selecting the four-module Java stack +
  Angular triggers no per-framework fan-out and no per-toggle refetch — toggling after load makes
  zero requests). `/files` is unchanged (still `paths: String[]`).
- `detect-frameworks.ts` no longer performs detection, test-matching, or framework-rule generation;
  those specs pass against the backend service instead.
