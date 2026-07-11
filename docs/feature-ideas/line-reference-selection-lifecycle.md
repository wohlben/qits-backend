# Line-reference selection lifecycle: emit on finalize, merge overlapping ranges

## Introduction

Selecting lines in the file browser's code viewer collects `path:start-end` reference chips —
the right behaviour, with the wrong lifecycle. The viewer emits a range for **every
intermediate selection state** (each line the pointer crosses mid-drag, each shift+arrow
keypress), and the collector appends every distinct one, so a single drag across ten lines
sprays up to ten chips (`foo.ts:10`, `foo.ts:10-11`, `foo.ts:10-12`, …). This idea fixes the
lifecycle in two halves: **emit only once the selection gesture is finalized**, and **merge a
new range into any existing same-file references it overlaps** instead of adding a sibling
chip.

Related/dependent plans:

- Changes the reference-selection seam of the
  [workspace-file-browser](../features/2026-07-02_workspace-file-browser.md)
  (`ui/components/code-viewer/code-viewer.component.ts` emit side,
  `pattern/workspace/workspace-file-browser.component.ts` collect side).
- [workspace-smart-file-display](../features/2026-07-03_workspace-smart-file-display.md)
  routes `selectRange` through `ui/components/file-viewer/file-viewer.component.ts` as a plain
  pass-through — unaffected, but it is the middle hop.
- [files-tab-selection-as-prompt-context](../features/2026-07-11_files-tab-selection-as-prompt-context.md)
  re-homed the references into the root `PromptContextStore`
  (`shared/state/prompt-context.store.ts`), where they feed the Chat tab and the agent prompt —
  so the `mergeReference` half of this idea now lands in the store's `addReference` (which
  currently only dedupes exact triples), and the chat/agent flow inherits the cleaned-up
  lifecycle for free.

## Current behaviour (what's wrong)

- `CodeViewerComponent.onUpdate` (`ui/components/code-viewer/code-viewer.component.ts:222`)
  fires on every CodeMirror `ViewUpdate` with `selectionSet` — that is once per pointer move
  while dragging and once per shift+arrow keypress — and emits `selectRange` for every
  non-empty intermediate selection.
- `PromptContextStore.addReference` (`shared/state/prompt-context.store.ts`, reached via
  `WorkspaceFileBrowserComponent.addReference`) dedupes on **exact**
  `(path, startLine, endLine)` equality only, so each intermediate range becomes its own chip,
  and each chip immediately repaints via the `highlights` input — visible churn mid-drag.
- Selecting a superset later (e.g. `10-20` after `12-15`) keeps both chips even though one
  contains the other.

## Decree

### 1. Emit once per finalized selection

`selectRange` fires exactly once per completed selection gesture, with the final range:

- On every `selectionSet` update with a non-empty main selection, the viewer only **records**
  the pending range (no emit). A collapsing selection (plain click) clears the pending range.
- **Pointer selections** flush on drag end: a `mouseup` handler via CodeMirror's
  `EditorView.domEventHandlers` (registered on `window`/document too, since drags can end
  outside the editor).
- **Keyboard selections** (shift+arrows, shift+click chains) flush after a short quiet period
  (~400 ms debounce after the last `selectionSet`), so holding shift+↓ emits one range, not
  one per keypress. The pointer `mouseup` flush cancels the debounce and vice versa — one
  flush per gesture, whichever seam sees it first.
- The existing `queueMicrotask` deferral (never dispatch mid-update) stays on the flush path.

### 2. Merge overlapping references

`addReference` merges instead of appending when the new range overlaps existing same-file
references:

- Two ranges of the same `path` merge when they overlap **or touch** (`a.endLine + 1 >=
  b.startLine`), producing `min(startLine)–max(endLine)`.
- Merging is transitive: a new range bridging two existing chips collapses all three into one.
- A new range fully inside an existing reference is a no-op (subsumed by the merge rule).
- Pure function (`mergeReference(refs, ref): CodeReference[]`) so it's unit-testable without
  the component; the highlight painting (`currentHighlights`) follows automatically since it
  derives from `references`.

## Non-goals

- No change to how references render (chips, `trackRef`) or to highlight painting.
- No cross-file merging; ranges only merge within the same `path`.
- Rendered-view modes, anchors (`openAtLine`) and `scrollToLine` are untouched.

## Open questions

- Should re-selecting exactly an existing reference toggle it off (select-to-remove), or is
  the chip's ✕ button enough? (Lean: ✕ is enough; keep selection additive.)
- Merge on *touching* ranges (`5-10` + `11-12` → `5-12`) as decreed, or only on true overlap?
  Touching-merge reads better in chips but loses the user's intent of two distinct spots.
- Debounce length for keyboard selections — 400 ms is a guess; verify it doesn't feel laggy
  for a deliberate shift+click range.

## Test notes

- `code-viewer` spec: simulate a multi-step selection (several `selectionSet` dispatches) and
  assert a single emit after mouseup / debounce; assert a plain cursor click emits nothing.
- `mergeReference` unit tests: disjoint append, overlap merge, touching merge (per the open
  question's resolution), containment no-op, transitive bridge across two chips.
