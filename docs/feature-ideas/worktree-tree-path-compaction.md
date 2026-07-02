# Worktree file tree: compact single-child directory chains ("a / b / c")

## Introduction

The worktree file browser's tree always renders every directory level as its own expandable
node, so a deeply nested repo (e.g. Java's `src/main/java/eu/wohlben/...`) costs one click and
one indent level per segment even when there is nothing to decide along the way. This idea
introduces **path compaction**: whenever a tree node's subtree is a pure chain — each node
having exactly **one** child (directory *or* file) — the chain is rendered as a single node
whose label joins the segments with ` / ` (the pattern known from VS Code's "compact folders"
and GitHub's file view).

Compaction is not a filtering feature per se, but it is tightly coupled to filtering: **filters
increase the chance of single-child chains** (hiding siblings leaves lonely survivors), so the
compaction must be *derived state* — recomputed immediately when filters change, splitting a
compacted `a / b / c` back into the normal structure the moment a filter change makes a second
child under `a` or `b` visible again.

Related/dependent plans:

- Operates on the tree built by `shared/utils/build-file-tree.ts` for the worktree file browser
  ([2026-07-02_worktree-file-browser.md](../features/2026-07-02_worktree-file-browser.md)).
- Interacts with the filter pipeline, including the planned ordered white/blacklist rules and
  dynamic ignorelist filters ([worktree-filter-ignorelists.md](worktree-filter-ignorelists.md))
  — every one of those features changes the visible path set, and each change must re-derive
  the compaction.
- `buildFileTree` is shared with the commit-diff view
  ([worktree-history](../features/2026-06-30_worktree-history.md) area); compaction should be
  **opt-in** so that view keeps its current shape unless deliberately enabled.

## Behaviour

- A directory node with exactly one child collapses into that child, recursively:
  `src` → `main` → `java` (each single-child) with children `{a.java, b.java}` renders as one
  branch node labelled `src / main / java`.
- Per the idea's scope, a chain ending in a **single file** compacts too:
  `docs` → `adr` → `001.md` (each level single-child) renders as one *leaf* row
  `docs / adr / 001.md` that opens the file directly. (VS Code compacts only dir→dir chains —
  worth a toggle of taste later, but the file-inclusive variant is the requested behaviour and
  saves the most clicks under aggressive filters.)
- Compaction stops at any node with ≥ 2 children; normal rendering resumes below.
- The joined label uses a spaced ` / ` separator so it reads as a path but stays visually
  distinct from a plain directory name.

### Reactivity with filters — the crucial requirement

The visible tree is already a pure function: `filteredPaths` (a `computed()` over file list +
manual filters + dynamic filters + top name query) → `buildFileTree`. Compaction slots in as
one more pure step over the same data, so *detecting* that a hidden sibling became visible is
not an event to handle — it falls out of recomputation:

- Filter change hides `src/main/resources/**` → `main` now has one child → `src / main / java`
  appears compacted.
- Filter change reveals it again → `main` has two children → the chain **resolves back** into
  `src` → `main` → `java`/`resources` in the same change-detection pass. No stale compacted
  nodes, no manual invalidation.

The only real state to care about is **expansion**: `z-tree` tracks expanded nodes by key in
its service, and a compacted node and its resolved form must not strand that state.

- Key the compacted node by its **deepest** directory's full path (`src/main/java`). Then:
  expanding the compacted node and later resolving the chain leaves `src/main/java` expanded
  (its key survives) — only the newly split ancestors (`src`, `src/main`) need to be force-
  expanded, which is the right UX anyway since the user was already "inside" the chain.
- When a chain *forms* (siblings got filtered away), the compacted node inherits the expansion
  of its deepest dir — again free with deepest-path keying.

## Implementation sketch

A pure post-processing pass, kept out of `buildFileTree`'s construction loop:

```ts
// shared/utils/compact-file-tree.ts
export function compactFileTree<T>(nodes: TreeNode<T>[], separator = ' / '): TreeNode<T>[]
```

- Walk the forest; for each directory node, follow the chain while `children.length === 1`,
  concatenating labels; emit one node with the accumulated label, the deepest node's `key`,
  `data`, `leaf` and `icon`.
- Exposed via a new `BuildFileTreeOptions` flag (`compact?: boolean`) or called explicitly by
  the worktree browser's `computed()` — explicit call preferred: it keeps `buildFileTree`
  single-purpose and lets the commit-diff view stay untouched.
- The worktree browser's existing auto-expand-on-name-query logic (`zExpandAll` set of keys)
  must expand the *compacted* keys; since compacted nodes reuse the deepest dir's key, the
  expand-set computation just needs to run against the compacted forest instead of raw paths.

### Details to get right

- **Icons**: a compacted dir chain keeps the folder icon; a chain ending in a file keeps the
  file icon (it *is* the file row).
- **Sorting** already happens before compaction and is unaffected — a compacted node sorts by
  its full joined label, which matches user expectation (it starts with the original first
  segment).
- **Root-level chains** compact too (a repo where everything lives under one top folder).
- **Selection/highlight**: the file browser tracks the selected file by path; a compacted leaf
  carries the same `data`/`key` as the original leaf, so selection logic is unchanged.
- **Accessibility**: the joined label is announced as one string; fine, but the separator
  should be ` / ` (with spaces) so screen readers don't merge segments into one pseudo-word.

## Open questions

- Should individual segments of a compacted label be **individually clickable** (VS Code lets
  you click a middle segment to expand from there)? Adds template complexity to `z-tree`'s
  label rendering (currently a plain string); suggest shipping without it and only revisiting
  if navigating "into the middle" of long chains turns out to be a real need.
- Is compaction always-on for the worktree browser, or a user toggle next to the filter input?
  Lean always-on: with no filters and a normal repo it only fires where it genuinely helps, and
  the behaviour is familiar from VS Code/GitHub.
- The commit-diff tree could arguably benefit too (changed files are sparse, chains are long) —
  but it currently renders fully expanded, where compaction matters less. Leave it out of scope
  and note it as a possible follow-up.

## Testing sketch

- `compact-file-tree.spec.ts` (pure util): dir-chain compaction, chain-ending-in-file becomes a
  leaf, stop at ≥ 2 children, root-level chain, deepest-key preservation, custom separator,
  icons carried over.
- Component spec (worktree browser): with a fixture path set, apply a filter that hides all
  siblings → assert the compacted label appears; relax the filter → assert the chain is
  resolved back and both children render (the "immediate re-resolution" requirement as a
  regression test); expansion of a compacted node survives the split.
