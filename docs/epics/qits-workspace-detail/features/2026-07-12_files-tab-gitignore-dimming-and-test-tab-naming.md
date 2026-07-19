# Files tab: dim gitignored files + name the test tabs (and fold qualified tests in)

## Introduction

Two restylings of the workspace detail page's **Files** tab
(`WorkspaceFileBrowserComponent`), plus one detection-logic extension the second one needs:

1. **Gitignored entries render de-emphasised**: a slightly grayed background and reduced
   opacity, so the contents of `node_modules/`, `target/`, `logs/` etc. read as "not source"
   at a glance.
2. **The viewer's linked-group tabs get real names**: the tab currently labelled `Test` shows
   the test class/file name instead (`OtelProxyUnreachableTest`, `foo.component.spec`) — which
   only becomes useful once several test tabs can coexist, so:
3. **Java test→source folding becomes more permissive**: a test whose name *extends a camel
   prefix* of a source class is folded into that source's tab strip **unless a more specific
   main code file exists** — e.g. `OtelProxyUnreachableTest.java` links to
   `OtelProxyResource.java` because no `OtelProxyUnreachable.java` (or `OtelProxy.java`)
   exists; the name is essentially `$classPrefix($CamelCaseWords)(Test|IT)` (`…QuarkusTest`
   ends in `Test`, so it is covered).

Related / dependent plans:

- `docs/epics/qits-workspace-detail/features/2026-07-02_workspace-file-browser.md` — the file browser both changes land in
  (`workspace-file-browser.component.ts`: `nodeTemplate`, `tabLabel`, `linkedGroup`).
- `docs/epics/qits-workspace-detail/features/2026-07-03_framework-aware-file-browser.md` — owns
  `shared/utils/detect-frameworks.ts` (`linkedTestsOf`/`linkedSourcesOf`/`ownerSource`/
  `camelPrefixes`), the single primitive behind the viewer's test tabs *and* the tree's
  redundant-test hiding; the folding extension changes it for both consumers at once.
- `docs/epics/qits-workspace-detail/features/2026-07-03_lazy-directory-exploration.md` — lazy (gitignored) directory
  stubs are the *only* way ignored content enters the tree; the dimming derives "is
  gitignored" from them (`allLazyDirs`).
- `docs/epics/qits-workspace-detail/features/2026-07-03_workspace-tree-path-compaction.md` — compacted chain nodes carry
  the deepest dir as `key`, which the dimming check matches against.
- `docs/epics/qits-testing-fixtures/features/2026-07-05_servable-quarkus-angular-fixture.md` — the fixture holding the
  motivating pair (`OtelProxyResource.java` + `OtelProxyUnreachableTest.java` +
  `OtelProxyResourceTest.java`); `seed-webapp` is the manual-verification fixture.

## Motivation

- Opening a lazy directory (say `logs/` or `node_modules/`) splices its files into the tree
  looking exactly like tracked source. Only the *unopened* stub is currently dimmed
  (`node.lazy` → `dimOpacity`); once opened, the visual cue disappears.
- A source with several detected tests shows multiple tabs all labelled `Test` — with the
  file paths only in the `title` tooltip. Indistinguishable tabs made the strict one-test-glob
  detection tolerable; named tabs make folding *more* tests in genuinely useful.
- The current java source→test glob (`${name}*Test.java`) requires the **full** source class
  name as prefix, so `OtelProxyUnreachableTest` (a scenario-named test of
  `OtelProxyResource`) is detected as belonging to nothing: it clutters the tree and opens
  with no Code tab.

## Design

### 1. Gitignored dimming in the tree

The backend's root listing is `git ls-files --cached --others --exclude-standard` — ignored
files are never in the eager list; ignored *directories* arrive as lazy stubs
(`GitignoreLazyDirectoryStrategy`), and their children arrive via plain `find`-style listings
when opened (`WorkspaceFilesService.listDirectory`). Individually-ignored files are not
surfaced at all. So the client-side rule is exact without parsing any `.gitignore`:

> a node is gitignored iff it is **at or under any known lazy directory** — i.e. its `key`
> equals or is prefixed by a key of `allLazyDirs` (which retains opened dirs and accumulates
> nested lazy dirs from loaded listings).

- Component: an `isIgnored(node)` helper (`node.lazy || underLazyDir(node.key)`) plus a
  wrapper `<span>` around the existing `nodeTemplate` content carrying
  `flex min-w-0 flex-1 items-center gap-1.5` and, when ignored,
  `-mx-1 rounded-sm bg-muted/50 px-1 opacity-70` — a full-row muted chip, less highlighted,
  without touching the CLI-managed zard tree components.
- Compacted chains: `key` is the deepest directory, so a chain ending inside an ignored dir
  dims as a whole (acceptable — every rendered descendant row is ignored too).
- Lazy stubs keep their existing count-suffix styling; the wrapper adds the background so
  stubs and opened ignored content read as one family. (Strictly, "lazy" is
  strategy-defined — `qits.repositories.file-tree.laziness` defaults to `gitignore` — the UI
  already treats lazy as ignored-ish by dimming stubs; this extends that stance.)

### 2. Named test tabs

`tabLabel(file)` in `workspace-file-browser.component.ts` currently returns `Test`/`Code`.
Change: `code` stays **Code** (the anchor tab), `test` returns the file's basename minus its
final extension — `OtelProxyUnreachableTest`, `OtelProxyResourceTest`, `foo.component.spec`.
The `title` tooltip keeps the full path. No other tab-strip changes.

Optional symmetry (small, makes the naming shine): `resolveLinkedGroup` for a *test* path
currently returns `[source, thisTest]` only; resolve it as `[source,
...linkedTestsOf(source)]` instead, so opening any member of a group shows the identical,
fully-named tab strip. (`path` is always contained in `linkedTestsOf(source)` when
`ownerSource(path) === source`, so the opened file keeps its tab.)

### 3. Permissive java test folding (`detect-frameworks.ts`)

Ownership walk, per test base name (suffix `Test`/`IT` stripped), over its camel prefixes
**longest-first** (`OtelProxyUnreachable` → `OtelProxyUnreachable`, `OtelProxy`, `Otel`):

1. **Exact** (today's rule): a source named exactly the prefix exists → it owns the test.
2. **Extension** (new): otherwise, if **exactly one** source *extends* the prefix at a camel
   boundary (glob `P[A-Z]*.java`, same package) → it owns the test. Only tried for prefixes
   of **≥ 2 camel words** (so a bare `Otel`/`Workspace` first word never fuzzy-claims a
   test); ambiguity (two `OtelProxy*` sources) claims nothing at that level and the walk
   continues.
3. No prefix yields an owner → the test stays a free-standing file (in the tree, no tabs).

"Unless there is a more specific main code file" falls out of longest-first: if
`OtelProxyUnreachable.java` existed it would win at step 1 before `OtelProxyResource.java`
is ever considered.

Mechanics:

- `sourceCandidates` (java) emits, per prefix, the exact path then the `P[A-Z]*.java`
  pattern (≥ 2-word prefixes only). The interface doc already says "globs".
- `ownerSource` learns pattern candidates: a candidate containing `*` compiles via
  `gitignoreGlobToRegExp` (which supports `[A-Z]` classes) and matches against the existing
  set — **unique match required**; plain candidates keep the `existing.has` check.
- `testCandidates` (java) widens its pre-filter globs from `${name}*Test.java` to the
  source name's **2-word camel prefix** (`OtelProxy*Test.java` / `*IT.java`; the full name
  when it has fewer words) — ownership then decides which matched candidate truly belongs.
- Because tabs and tree-hiding share `linkedTestsOf`, a newly folded test automatically also
  disappears from the tree while its source is visible (existing `treeVisiblePaths` rule),
  and reappears under name-search — no new wiring.
- Angular is untouched (`foo.ts ↔ foo.spec.ts` stays exact).

## Touch points

- `service/src/main/webui/src/app/pattern/workspace/workspace-file-browser.component.ts` —
  `isIgnored` + node-template wrapper span; `tabLabel` naming.
- `service/src/main/webui/src/app/shared/utils/detect-frameworks.ts` — java
  `testCandidates`/`sourceCandidates`, pattern-aware `ownerSource`, optional symmetric
  `resolveLinkedGroup`.
- Specs: `detect-frameworks.spec.ts` (extension folding: `OtelProxyUnreachableTest` →
  `OtelProxyResource`; more-specific exact source wins; two-source ambiguity → no fold;
  1-word shared prefix never fuzzy-folds — the existing `OrphanTest` case must stay green),
  `workspace-file-browser.component.spec.ts` (tab labels; ignored-node styling; folded test
  hidden from tree / findable by name).
- Manual verification: `seed-webapp`, greeting workspace → Files tab; open `target/` or
  `node_modules/` (dimmed children); open
  `src/main/java/…/OtelProxyResource.java` (tabs: `Code · OtelProxyResourceTest ·
  OtelProxyUnreachableTest`).

## Acceptance

- Children of an opened gitignored directory render with a muted background chip and reduced
  opacity at every depth; tracked files are unchanged; selection/hover/click behaviour is
  unchanged.
- Opening `OtelProxyResource.java` shows three named tabs; `OtelProxyUnreachableTest.java`
  is hidden from the tree while its source is visible and findable via the name filter;
  opening it directly shows the same tab strip (if the symmetric-group option is taken).
- A test whose ≥2-word camel prefix matches **two** sources folds into neither; a test
  sharing only its first camel word with any source folds into nothing (today's behaviour).
- `…QuarkusTest.java` folds like any `…Test.java`.

## Open questions

- Ambiguous extension matches: claim nothing (proposed, predictable) vs pick the closest by
  `byClosest`? Lean nothing — a wrongly-claimed test silently vanishes from the tree.
- Should the ignored-chip background also apply to the *unopened* lazy stub rows, or is the
  existing count-suffix dimming enough there? Lean: apply to both for one visual family.
- Is a ≥2-camel-word floor the right permissiveness knob, or should it be "≥ half the source
  name's words"? Start with 2; revisit with real repos.
