# Lazy directory exploration in the worktree file tree

## Introduction

The worktree file browser
([2026-07-02_worktree-file-browser.md](2026-07-02_worktree-file-browser.md)) fetched the entire
file list up front and, to keep that payload small, hid gitignored directories entirely
(`git ls-files … --exclude-standard`) — so `node_modules/`, `dist/` and build output never reached
the UI. This replaces "hide it entirely" with **lazy directory exploration**: a gitignored
directory is returned as a *stub* — a collapsed folder with an immediate-child count — whose
contents are fetched only when the user opens it. The default view is unchanged (the expensive dirs
are collapsed stubs instead of missing), but the user can now click into them.

This **folds in the deferred backend Part 3** of the ordered-rules/ignorelists feature
([2026-07-03_worktree-filter-ordered-rules-and-ignorelists.md](2026-07-03_worktree-filter-ordered-rules-and-ignorelists.md)):
that plan wanted to expose ignored files and re-hide via rules, and parked the resulting
payload-size problem. Lazy loading resolves it a better way — ignored dirs are *present as openable
stubs*, not silently dropped, **without** the payload cost. The two compose: **lazy loading owns
bulk directory size; the rule pipeline owns fine-grained per-file hide/show.**

## What was built

### Backend — a lazily-resolvable, level-addressable `/files`

`GET .../{worktreeId}/files` now returns `{ paths: string[], lazyDirs: LazyDirDto[] }` and takes an
optional `?path=<dir>` (`WorktreeController` + `WorktreeFilesService`, `Listing`/`LazyDir` records):

- **root** (`no path`): eager files from `git ls-files --cached --others --exclude-standard`
  (unchanged) **plus** the directories the active strategy marked lazy, each a
  `LazyDirDto(path, childCount, href)`. `childCount` is *immediate* children (one cheap
  `Files.list`, never a descendant walk); `href` is the self-referential `/files?path=…` link.
- **`?path=<dir>`**: that directory listed one level deep straight from the filesystem (git offers
  nothing inside an ignored dir) — immediate files → `paths`, immediate subdirs → `lazyDirs` again,
  so nesting resolves recursively through the one endpoint. Symlinks are **not** followed.
- **Pluggable strategy** (`LazyDirectoryStrategy`, selected by
  `qits.repositories.file-tree.laziness`, default `gitignore`): the default
  `GitignoreLazyDirectoryStrategy` uses `git ls-files --others --ignored --exclude-standard
  --directory --no-empty-directory` — `--directory` collapses a wholly-ignored tree to one stub
  without recursing. Future heuristics (commit-frequency, size, …) slot in behind the interface
  without touching transport or UI. Individually-ignored *files* stay hidden, as today.
- **Path safety**: `?path=` is user-supplied, so the traversal guard `readFile` already used was
  extracted into a shared `resolveWithinWorktree(root, path)` (lexical `..`/absolute reject, then
  symlink-resolve + re-check containment), reused by both the file read and the new directory
  listing; the listing also rejects non-directories and `.git`.

OpenAPI (`docs/openapi.yml` + the webui copy) and the typed client were regenerated.

### Frontend — render stubs, fetch on open

`worktree-file-browser.component.ts`:

- `filesQuery` now carries the `{ paths, lazyDirs }` root level. `openedLazyPaths` tracks expanded
  lazy dirs; each is fetched reactively via `injectQueries`, keyed
  `['worktree-files', repoId, worktreeId, dir]` — a per-dir cache entry, so re-expanding is instant.
- `allEagerPaths` (root + every loaded lazy level) feeds the whole filter pipeline, so the existing
  fuzzy/rule filters and dynamic ignorelists just work over loaded content.
- Tree assembly injects a **lazy stub** node per unopened lazy dir (`markLazyStubs` + a
  `__lazy_stub__` sentinel leaf so `build-file-tree` materialises the folder and it gets a chevron);
  the label shows the count (`node_modules (312)`), and a `Loading…` placeholder shows while its
  fetch is in flight. A loaded lazy dir becomes an ordinary directory. `TreeNode` gained a `lazy?`
  flag; **compaction treats a lazy stub as a boundary** (never folds it into a `a / b / c` chain).
- Expansion (chevron *or* row click, both of which only update `expandedKeys`) triggers the load via
  an effect watching `expandedKeys`; `expandAll` (used by filtering) **skips lazy stubs**, so
  filtering never auto-opens — and thus never auto-fetches — a collapsed directory.
- **Filter honesty**: filters run over loaded nodes only, so a hint —
  *“N collapsed directories not searched — open to include.”* — appears when a filter is active and
  unopened lazy dirs exist (no silent caps).

## Testing

- `GitignoreLazyDirectoryStrategyTest` — the ignored-dir boundary set, `--directory` collapsing a
  wholly-ignored tree to one stub, and that ignored files / empty dirs are excluded.
- `WorktreeControllerTest` — root `/files` returns a gitignored `node_modules` in `lazyDirs` (right
  `childCount` + `href`) and *not* its contents; `?path=node_modules` lists one level with the
  nested subdir still lazy; `?path=../` / symlinked-dir escape / non-directory / `.git` → 400.
- `worktree-file-browser.component.spec.ts` — stub renders with a count label; expanding fetches and
  splices real children; `Loading…` placeholder while pending; a nested subdir stays lazy after its
  parent opens; filtering neither auto-opens a lazy dir nor omits the unsearched hint.
- Verified end-to-end in the running app (headless browser): a gitignored `node_modules/` shows as
  `node_modules (N)`, opening it fetches and reveals its contents, and a nested ignored subdir opens
  again on demand.

## Known limitations / future work

- Search can't see inside unopened lazy dirs (surfaced by the hint). Options for later: keep a lazy
  dir visible when its *own name* matches, or a server-side search that walks lazy dirs on demand.
- `childCount` is immediate children only. Tree virtual-scroll is still deferred (with the default
  gitignore boundary the rendered tree stays small, so it isn't forced).
- Only the `gitignore` strategy ships; the interface is ready for size/age/commit-frequency ones.
