# File trees: compact single-child directory chains ("a / b / c")

## Introduction

The file trees used to render every directory level as its own expandable node, so a deeply
nested repo (e.g. Java's `src/main/java/eu/wohlben/...`) cost one click and one indent level per
segment even when there was nothing to decide along the way. This feature introduces **path
compaction**: whenever a tree node's subtree is a pure chain — each node having exactly **one**
child (directory *or* file) — the chain is rendered as a single node whose label joins the
segments with ` / ` (the pattern known from VS Code's "compact folders" and GitHub's file view).

Compaction is not a filtering feature per se, but it is tightly coupled to filtering: **filters
increase the chance of single-child chains** (hiding siblings leaves lonely survivors), so the
compaction is *derived state* — recomputed immediately when filters change, splitting a
compacted `a / b / c` back into the normal structure the moment a filter change makes a second
child under `a` or `b` visible again.

Related/dependent plans:

- Operates on the tree built by `shared/utils/build-file-tree.ts`
  ([2026-07-02_workspace-file-browser.md](2026-07-02_workspace-file-browser.md)).
- Interacts with the filter pipeline, including the planned ordered white/blacklist rules and
  dynamic ignorelist filters
  ([workspace-filter-ignorelists.md](2026-07-03_workspace-filter-ordered-rules-and-ignorelists.md)) — every one
  of those features changes the visible path set, and each change re-derives the compaction.
- Applied to both consumers of `buildFileTree`: the workspace file browser and the commit-diff
  changed-files tree ([workspace-history](../../qits-workspaces/features/2026-06-30_workspace-history.md) area).

## Behaviour

- A directory node with exactly one child collapses into that child, recursively:
  `src` → `main` → `java` (each single-child) with children `{a.java, b.java}` renders as one
  branch node labelled `src / main / java`.
- A chain ending in a **single file** compacts too: `docs` → `adr` → `001.md` (each level
  single-child) renders as one *leaf* row `docs / adr / 001.md` that opens the file directly.
  (VS Code compacts only dir→dir chains — the file-inclusive variant saves the most clicks under
  aggressive filters.)
- Compaction stops at any node with ≥ 2 children; normal rendering resumes below.
- The joined label uses a spaced ` / ` separator so it reads as a path but stays visually
  distinct from a plain directory name.
- Compaction is **always on** in both trees — no user toggle, no individually clickable label
  segments (both considered and rejected; see Decisions below).

### Reactivity with filters — the crucial requirement

The visible tree is a pure function: `filteredPaths` (a `computed()` over file list + manual
filters + top name query) → `buildFileTree` → `compactFileTree`. Compaction is one more pure
step over the same data, so *detecting* that a hidden sibling became visible is not an event to
handle — it falls out of recomputation:

- Filter change hides `src/main/resources/**` → `main` now has one child → `src / main / java`
  appears compacted.
- Filter change reveals it again → `main` has two children → the chain **resolves back** into
  `src` → `main` → `java`/`resources` in the same change-detection pass. No stale compacted
  nodes, no manual invalidation.

### Expansion state across chain form/split

`z-tree` tracks expanded nodes by key in `ZardTreeService`; a compacted node and its resolved
form must not strand that state.

- The compacted node is keyed by its **deepest** directory's full path (`src/main/java`), so
  expanding it and later resolving the chain leaves `src/main/java` expanded — its key survives.
- The workspace browser additionally **mirrors** a compacted node's open/closed state onto the
  absorbed ancestor dirs (`src`, `src/main`), via an `effect()` fed by the chain list that
  `compactFileTree` collects. When a filter change splits the chain, the newly separate
  ancestors are then already open — the right UX, since the user was already "inside" the chain.
  Collapse mirrors the same way, keeping the states consistent.
- A chain ending in a lone **file** counts as *open*: its file is visible, which in an
  uncompacted tree implies every ancestor is expanded. Without this, filtering down to a single
  file and then clearing the filter would bury that file under collapsed dirs (pre-compaction,
  the filter's expand-all left them open) — caught during in-browser verification.
- The commit-diff tree renders with `zExpandAll`, so no expansion syncing is needed there.

## Implementation

A pure post-processing pass, kept out of `buildFileTree`'s construction loop:

```ts
// shared/utils/compact-file-tree.ts
export function compactFileTree<T>(
  nodes: TreeNode<T>[],
  options?: { separator?: string; chains?: CompactedChain[] },
): TreeNode<T>[]
// CompactedChain = { key, absorbedKeys, leaf } — surviving node's key, the absorbed ancestor
// dirs' keys (outermost first), and whether the chain ends in a file
```

- Walks the forest; for each directory node, follows the chain while `children.length === 1`,
  concatenating labels; emits one node with the accumulated label and the deepest node's `key`,
  `data`, `leaf` and `icon`. Non-mutating.
- `chains`, if provided, collects one `CompactedChain` per compaction — this feeds the workspace
  browser's expansion-sync effect.
- Called explicitly by the consumers' `computed()`s rather than folded into `buildFileTree`,
  keeping the builder single-purpose:
  - `pattern/workspace/workspace-file-browser.component.ts` — a `compaction` computed returns
    `{ nodes, chains }`; an `effect()` syncs absorbed-ancestor expansion via the tree's service.
  - `pattern/repository/commit-diff.component.ts` — `treeNodes` wraps `buildFileTree` in
    `compactFileTree` (changed files are sparse, so chains are long).
- The tree's `zExpandAll` (active while filtering) walks the compacted forest, so it expands the
  compacted keys automatically.

### Details

- **Icons**: a compacted dir chain keeps the folder icon; a chain ending in a file keeps the
  file icon (it *is* the file row).
- **Sorting** happens before compaction and is unaffected — a compacted node sorts by its
  original first segment, which matches user expectation.
- **Root-level chains** compact too (a repo where everything lives under one top folder).
- **Selection/highlight**: a compacted leaf carries the same `data`/`key` as the original leaf,
  so the browsers' path-based selection logic is unchanged.
- **Accessibility**: the joined label is announced as one string; the separator is ` / ` (with
  spaces) so screen readers don't merge segments into one pseudo-word.
- **Long labels**: compacted labels are wider than plain names, so both trees render at natural
  width (`w-max min-w-full`) inside their scrollable pane instead of truncating, and the
  tree/viewer split is user-draggable (`z-resizable`, ZardUI) — full names are always reachable.

## Decisions (formerly open questions)

- **No individually clickable label segments** (VS Code lets you click a middle segment to
  expand from there): rejected — adds template complexity to `z-tree`'s label rendering for a
  need that hasn't materialised.
- **Always on**, no user toggle: with no filters and a normal repo it only fires where it
  genuinely helps, and the behaviour is familiar from VS Code/GitHub.
- **The commit-diff tree gets compaction too** — changed files are sparse, so its chains are the
  longest.

## Testing

- `shared/utils/compact-file-tree.spec.ts` (pure util): dir-chain compaction, chain ending in a
  file becomes a leaf, stop at ≥ 2 children, chains below an uncompacted branch, deepest-key
  preservation, custom separator, icons carried over, chain-map collection, input not mutated.
- `pattern/workspace/workspace-file-browser.component.spec.ts`: compacted labels in the rendered
  tree; a filter hiding all siblings forms a chain and relaxing it resolves the chain back (the
  "immediate re-resolution" regression test); expansion of a compacted node survives the split
  (absorbed ancestors are open after the chain resolves); a path filtered down to one file stays
  visible after the filter clears (leaf chains count as open).
