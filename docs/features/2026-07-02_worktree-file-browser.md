# Worktree file browser: tree + syntax-highlighted code viewer

## Introduction

Opening a worktree had no way to look at its files. The worktree **detail** route
(`/repositories/:repoId/worktrees/:worktreeId`) is now a file browser: a folder tree on the
left, a read-only code viewer on the right with per-language syntax highlighting. Selecting a
line range in the viewer collects it as a `path:line` **reference** (shown as a removable chip
and painted back as a persistent highlight) — the foundation for feeding selected code into a
coding-agent prompt later.

Related plans:
- Sits next to the [speak-to-prompt](2026-07-02_speak-to-prompt.md) WIP route
  (`.../worktrees/:worktreeId/wip`), which is left unchanged and linked from the detail page's
  header. The reference cache is intended to eventually feed that same agent-launch path.
- Reuses the `buildFileTree` util introduced for the commit-diff view
  ([worktree-history](2026-06-30_worktree-history.md) area), generalized here rather than
  duplicated.

Scope of this iteration is **browse + select only**: submitting references into a prompt and
LSP integration (go-to-definition, find-callers, function-level selection) are deferred, but the
code surface was chosen to extend cleanly to both.

## What was built

### Backend — worktree file API

Two read endpoints on **`WorktreeController`** (`@Path("/repositories/{repoId}/worktrees")`),
backed by a new **`WorktreeFilesService`** (`domain/.../repository/control/`) that builds its
DTOs directly from git/filesystem output (no MapStruct mapper):

- `GET .../{worktreeId}/files` → `{ paths: string[] }`. Runs `git ls-files --cached --others
  --exclude-standard` in the worktree, so the list is tracked files **plus new untracked ones**
  while honouring `.gitignore` — `.git`, `node_modules` and build output stay out. Sorted,
  de-duplicated.
- `GET .../{worktreeId}/files/content?path=` → `WorktreeFileContentDto(path, content, binary)`.
  Reads from the **working tree** (not from git), so an agent's uncommitted edits are visible.

**Path safety** (cloned repos are untrusted, and git checks out symlinks):
- `worktreeId` is already a strict slug, safe as a path segment.
- `path` is user-supplied, so the read canonicalizes the worktree root with `toRealPath()`,
  rejects `..`/absolute escapes lexically, then **resolves symlinks and re-checks containment**
  — a symlink committed inside the worktree can't redirect the read outside it.
- Files containing NUL bytes, or larger than 2 MB, are flagged `binary` (no content) rather than
  streamed.

The OpenAPI spec (`docs/openapi.yml` + the webui copy) and the generated typed client were
regenerated to expose these.

### Frontend

Follows the strict pages → pattern → ui layering.

- **Route + page** (`pages/repositories/worktree-detail/worktree-detail.page.ts`): a thin shell
  wrapping `<app-page-layout>`; shows the worktree (branch, parent) and a "Speak a prompt" link
  to the `.../wip` route. Loads the worktree via the same `['worktrees', repoId]` query key *and
  shape* as the branch list, so they share one cache entry.
- **Smart component** (`pattern/worktree/worktree-file-browser.component.ts`): fetches the file
  list and file content (TanStack Query), builds the `z-tree` data (folders-first, file/folder
  icons, collapsed by default), and owns the **reference cache** — a signal of
  `{ path, startLine, endLine }` rendered as removable `z-badge` chips, de-duplicated. Passes the
  current file's references down as viewer highlights and the dark-mode state down as an input.
- **Presentational viewer** (`ui/components/code-viewer/code-viewer.component.ts`): a read-only
  **CodeMirror 6** `EditorView` (line numbers, `defaultHighlightStyle`, grammar chosen from the
  filename via `@codemirror/language-data`, `oneDark` when dark). A selection emits a 1-based line
  range (`selectRange`); collected ranges are painted with a `.cm-refHighlight` line `Decoration`.
  Binary/empty files render a placeholder instead of an editor. Theme is passed in as an input so
  the component stays service-free.
- **Shared util** (`shared/utils/build-file-tree.ts`): generalized to be generic over the item
  type with `{ expanded, icons }` options; the commit-diff view keeps its previous behaviour via
  the defaults.

New dependencies: `@codemirror/{state,view,language,language-data,theme-one-dark}`.

### Filtering the tree

Two layers narrow the tree, both driven by a pure util
(`shared/utils/filter-file-paths.ts`) reused by the tree and the dialog:

- **Top filter input** — fuzzy match on the **filename**; the tree auto-expands to reveal matches
  (bound via the tree's `[zExpandAll]` — `z-tree` ignores `node.expanded`, so expansion is driven
  through its service instead).
- **Advanced filter dialog** (icon left of the input, opened via `ZardDialogService` with an inline
  `<ng-template>`) — a list of criteria: **exact** (full path ==), **fuzzy** (subsequence over the
  full path), **includes** (path substring), **excludes** (inverted). The tree is the **union** of
  the include criteria (or all files if none) **minus** excludes; the dialog shows that "visible
  files (N)" set live, then the top input does a final filename pass. The filter list is a public,
  programmatically-settable API on the component (`setFilters`/`addFilter`/`updateFilter`/… — meant
  to be populated in code later; the dialog just views/edits it).
- **Smart-case** everywhere: an all-lowercase query matches case-insensitively; any uppercase letter
  makes it case-sensitive.
- **Wildcards in fuzzy**: a fuzzy query using `*` (any run) or `?` (one char) is treated as an
  anchored glob instead of a subsequence — e.g. `.*ignore` finds `.gitignore`/`.dockerignore`,
  `*.ts` matches `main.ts` but not `main.tsx`. Applies to both the top input and the dialog's fuzzy
  kind.

### App sidebar collapse fix

Fixed as part of this work: the left navigation's collapse toggle (the `<` at the bottom) did
nothing. The ZardUI `z-sidebar` drives its width/chevron from the `zCollapsed` **input** but the
layout never fed the emitted state back. `MainLayoutComponent` now two-way binds
`[(zCollapsed)]` to a local signal, so clicking the toggle actually collapses (240 ↔ 64 px) and
the wordmark hides on the rail. No edit to the CLI-managed ZardUI component.

## Known limitations

- Line-range references only; function/symbol-level selection needs an LSP (deferred).
- The reference cache is not yet wired to anything — it collects, it doesn't submit.
- The whole file tree is rendered into the DOM (collapsed nodes included); fine for these repos,
  but a very large worktree would want the tree's virtual-scroll mode.
- No file editing — the viewer is read-only.
- Files over 2 MB or with NUL bytes are shown as a binary placeholder.

## Testing

- `WorktreeControllerTest` — `/files` includes a new untracked file; `/files/content` returns
  text; binary (NUL byte) → `binary=true`, no content; `../` traversal → 400; **symlink escape →
  400** (regression for the path-traversal fix); missing file → 404.
- `build-file-tree.spec.ts` — the new `expanded`/`icons` options and the generic `{ path }`
  payload, alongside the existing nesting/sorting cases.
- `filter-file-paths.spec.ts` — fuzzy subsequence, smart-case, glob wildcards (`.*ignore`, `*.ts`,
  `?`); `applyPathFilters` union/exact/excludes and the only-excludes case; the full pipeline's
  final filename pass.
- `worktree-file-browser.component.spec.ts` — reference add/de-dupe, remove, and that
  `currentHighlights` reflects only the open file; the filter API (`add`/`update`/`remove`) and that
  `filteredPaths`/`dialogVisiblePaths` reflect includes/excludes and the top name query.
- `code-viewer.component.spec.ts` — binary and empty-content placeholders mount no editor.
- Verified end-to-end in the running app (headless browser): file tree renders, clicking a file
  shows highlighted content, selecting lines produces a chip + highlight, removing the chip clears
  it, and the sidebar toggle collapses/expands.
