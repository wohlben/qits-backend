# Framework-aware file browser: project detection, framework filters, and test↔code tabs

## Introduction

Grows the worktree file browser from "one file, two modes" (the Preview/Code toggle of
[smart file display](2026-07-03_worktree-smart-file-display.md)) into a browser that *understands
what kind of project(s)* a worktree contains, and turns that into two payoffs: a **framework filter**
in the tree and **test↔code tabs** in the viewer. Both sit on a recursive language/framework
detection foundation that runs as a pure frontend pass over the already-loaded path list.

Related/dependent plans:

- Builds on the dynamic-filter infrastructure of
  [ordered rules + ignorelists](2026-07-03_worktree-filter-ordered-rules-and-ignorelists.md) — the
  framework filter is another dynamic-filter *type* feeding the same `effectiveFilters` pipeline. It
  needed one addition to that model: a `restrict` flag on generated glob whitelists (below).
- Extends the viewer of [smart file display](2026-07-03_worktree-smart-file-display.md)
  (`ui/components/file-viewer/`) and the browser
  (`pattern/worktree/worktree-file-browser.component.ts`). File tabs (which file) are kept orthogonal
  to the Preview/Code mode toggle (how to render): **file tabs outer, mode toggle inner**.
- Composes with [lazy directory exploration](2026-07-03_lazy-directory-exploration.md): detection
  markers (`pom.xml`, `angular.json`) and test files (`src/test`, `*.spec.ts`) are tracked/non-ignored,
  so they are in the eager list and detection works without opening any lazy directory.

## What was built

### Detection registry (`shared/utils/detect-frameworks.ts`)

A registry of `FrameworkDescriptor`s shaped like the viewer's `SMART_RENDERERS`, owning all
framework-specific knowledge (detection, filter globs, test rules). Three descriptors ship:

| id | detectRoots | frameworkGlobs (root-relative) | test rule |
|---|---|---|---|
| `java-quarkus` | parent dir of every `pom.xml` | `pom.xml`, `**/*.java`, `src/main/resources/**`, `src/test/resources/**` | `src/main/java/<pkg>/Foo.java` ↔ `src/test/java/<pkg>/Foo*Test.java` / `Foo*IT.java` |
| `ts-angular` | parent dir of every `angular.json` | `package.json`, `angular.json`, `tsconfig*.json`, `src/**`, `public/**` | `foo.ts` ↔ `foo.spec.ts` (sibling) |
| `docs` | every dir named `docs` containing a `*.md` | `**` (everything under the docs dir) | — |

- `detectFrameworks(paths)` runs each descriptor's `detectRoots` — a pure, content-free pass.
  Java/Angular are one-liners (parent dir of the marker), so **nested projects fall out for free**
  (qits: root/`domain`/`service`/`cli` poms + `service/src/main/webui/angular.json`); `docs` yields
  multiple roots.
- `owningProject(path, projects)` picks the **deepest** root that prefixes a path (most-specific
  wins), so a file under a nested project belongs to that project.
- The **Quarkus-vs-Maven** label is the only content peek: `labelPeekMarker`/`refineLabel` upgrade
  "Java / Maven" → "Java / Quarkus" when the `pom.xml` mentions quarkus. It is lazy (only fetched
  while the filter dialog is open) and never blocks detection.

### Framework dynamic filter

- `PathFilter` gained `restrict?: boolean`. A generated glob whitelist normally does *not* set the
  filter list's stance (so an ignorelist `!negation` can't flip the tree to hidden); a `restrict`
  glob whitelist is the opposite — a leading one sets the stance to **default-hidden**, so only its
  matches show. `applyPathFilters` honours it.
- `frameworkToRules(descriptor, roots)` emits restrict whitelist glob rules scoped by root. `docs`
  unions all its roots into a single "Docs" filter.
- The browser holds framework selections in the same `dynamicFilters` list (widened to a
  `'ignorelist' | 'framework'` union). `effectiveFilters = [...framework, ...ignorelist, ...manual]`
  — framework rules lead (to set the restrictive stance), a manual whitelist still wins last.
  Multiple framework filters compose as a union of whitelists.
- The advanced dialog's "Dynamic filters" picker offers one entry per detected java/angular root
  (labelled with the root, e.g. `Java / Quarkus (service)`), one aggregate `Docs` entry, and the
  ignore-file basenames — with distinct icons.

### Framework quick-access footer

A persistent button group pinned below the file tree (outside its scroll area) offers one toggle per
detected framework *kind* — aggregate across all its roots, so qits shows exactly three: `Quarkus`,
`Angular`, `Docs`. Each button is labelled by the framework's short name (`Java / Quarkus` →
`Quarkus`, using the same pom peek). Toggling one restricts the tree to that kind's files; untoggling
restores everything; several toggled compose as a union. It is a separate, lightweight state
(`activeFrameworkKinds`) whose generated restrict-whitelist rules lead `effectiveFilters`, so it
composes with the dialog's per-root filters and ignorelists. (The always-visible footer is why the
pom label peek runs as soon as a Java project is detected, rather than only while the dialog is open.)

Unlike a name query or a manual/dialog rule (a *search*, which expands the tree so deep matches are
visible), a quick-access toggle is for *browsing* — it does **not** trigger expand-all (the tree's
expand-all is driven by `expandTreeForFilter`, which excludes the quick-access rules). Instead it is
**framework-aware**: toggling a kind on opens each of its roots down to a descriptor-defined landing
depth (`autoExpandDir` — java → `<root>/src/main`, angular → `<root>/src`, docs → the docs dir), so
the user lands inside the source tree with the deeper packages still collapsed. Only newly-activated
kinds expand (a later manual collapse sticks); toggling off never re-expands.

### Test↔code tabs

- `resolveLinkedGroup(path, projects, allPaths)` returns the opened file plus its detected
  counterpart(s), each tagged `code`/`test`: it resolves the owning project, runs the descriptor's
  source→test (or test→source) rules, and keeps only candidates that exist. A java test's owner is
  the **deepest existing source**: `TheFileSpecialCaseTest`/`…IT` walks the CamelCase prefixes
  longest-first (`TheFileSpecialCase` → `TheFile` → `The`) and binds to `TheFileSpecialCase.java`
  when it exists, otherwise `TheFile.java` — and `TheFile.java` correspondingly does *not* claim a
  test a more-specific source owns.
- The browser renders a segmented **file-tab strip** above the viewer whenever the group has ≥2
  entries; each tab re-points `selectedPath`. Because the content query is path-keyed, references are
  path-filtered, and the view mode is renderer-keyed, each tab keeps its own content, reference
  chips, and Preview/Code mode for free. No counterpart → no strip.
- **Detection is one shared primitive.** `linkedTestsOf` (source→tests) and `linkedSourcesOf`
  (test→source) are the two exported functions; `resolveLinkedGroup` is just their combination. The
  viewer tabs and the tree's test-hiding (below) both build on them, so the two can never disagree.

### Hiding redundant tests from the tree

A test that is reachable as a tab from a visible source is redundant in the tree, so `treeVisiblePaths`
drops it: for each visible source it runs the **same `linkedTestsOf`** the tabs use and hides the
matched tests. An *orphan* test (a `@QuarkusTest` endpoint test, smoke/export/validation test — no
matching source) has no source to hide behind and stays visible. Hiding is skipped while
name-searching, so a test is always findable by typing its name.

## Testing

- `detect-frameworks.spec.ts` — nested java+angular detection, deepest-root ownership, docs
  detected only with a `*.md` (and multiple docs dirs), no false positive on a lone `package.json`,
  `frameworkToRules` scoping, test resolution both directions incl. multiple `*Test` matches, and the
  Quarkus `refineLabel` upgrade.
- `filter-file-paths.spec.ts` — a `restrict` glob whitelist flips the default to hidden, unlike a
  plain generated whitelist.
- `worktree-file-browser.component.spec.ts` — per-root + aggregate-Docs offers, the Quarkus label
  peek, the Java filter hiding webui TS, java+angular composing, the Docs union, the quick-access
  footer (one aggregate toggle per kind, restrict/restore/union), and test-tab groups (symmetric
  java, angular, no-counterpart) preserving per-path reference chips.
- Verified end-to-end in the running app (headless browser) against the qits worktree: the picker
  offered `Docs`, four `Java / Quarkus (root|cli|domain|service)` (Maven upgraded to Quarkus via the
  pom peek), and `TypeScript / Angular (service/src/main/webui)`; selecting the Angular filter cut
  637 → 320 files all under `webui`; adding Java (domain) composed to 491 with no stray root files;
  opening `AgentLaunchService.java` showed **Code**/**Test** tabs that swap content on click. The
  quick-access footer showed `Quarkus`/`Angular`/`Docs`; toggling `Quarkus` restricted the tree to
  the Java stack across all modules, and adding `Docs` composed the two.

## Known limitations / future work

- Per-root filters mean a multi-module Maven build offers one entry per module; a future
  per-descriptor union (one "Java" filter for all modules) is a small addition.
- A test counterpart inside an unopened lazy directory won't be found until it is opened — a
  non-issue in practice, since tests are not gitignored.
