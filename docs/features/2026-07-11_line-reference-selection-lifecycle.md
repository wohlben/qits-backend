# Line-reference selection lifecycle: emit on finalize, merge overlapping ranges

## Introduction

Selecting lines in the file browser's code viewer collects `path:start-end` reference chips —
the right behaviour, with (previously) the wrong lifecycle. The viewer emitted a range for
**every intermediate selection state** (each line the pointer crossed mid-drag, each
shift+arrow keypress), and the collector appended every distinct one, so a single drag across
ten lines sprayed up to ten chips (`foo.ts:10`, `foo.ts:10-11`, `foo.ts:10-12`, …). This
feature fixed the lifecycle in two halves: **emit only once the selection gesture is
finalized**, and **merge a new range into any existing same-file references it overlaps or
touches** instead of adding a sibling chip.

Related/dependent plans:

- Changes the reference-selection seam of the
  [workspace-file-browser](2026-07-02_workspace-file-browser.md)
  (`ui/components/code-viewer/code-viewer.component.ts` emit side; the collect side delegates
  to the store unchanged).
- [workspace-smart-file-display](2026-07-03_workspace-smart-file-display.md)
  routes `selectRange` through `ui/components/file-viewer/file-viewer.component.ts` as a plain
  pass-through — unaffected, but it is the middle hop.
- [files-tab-selection-as-prompt-context](2026-07-11_files-tab-selection-as-prompt-context.md)
  re-homed the references into the root `PromptContextStore`
  (`shared/state/prompt-context.store.ts`), where they feed the Chat tab and the agent prompt —
  so the merge half of this feature landed in the store's `addReference` (which previously
  only deduped exact triples), and the chat/agent flow inherits the cleaned-up lifecycle for
  free.
- [files-tab-line-picker-mode](2026-07-11_files-tab-line-picker-mode.md) — gates this
  lifecycle behind an explicit pick-mode toggle (web-view picker parity); the gesture
  machinery itself stays as shipped here, and `mergeReference` additionally stitches the
  merged reference's code excerpt.

## Design

### 1. Emit once per finalized selection

`selectRange` fires exactly once per completed selection gesture, with the final range. The
viewer keeps a small gesture state machine (`pendingRange`, `debounceTimer`,
`pointerSelecting`):

- On every `selectionSet` update with a non-empty main selection, the viewer only **records**
  the pending range (no emit). A collapsing selection (plain click) clears the pending range,
  so the click's mouseup — or a still-running debounce — can never emit a stale gesture.
- **Pointer selections** flush on drag end: a `mouseup` listener on the **document**
  (registered once for the component lifetime, removed via `DestroyRef`), since drags can end
  outside the editor and `mouseup` bubbles to the document from inside it too. A per-view
  `EditorView.domEventHandlers({ mousedown })` extension marks the pointer gesture in
  progress, suspending the keyboard debounce so a drag paused mid-gesture with the button held
  doesn't emit early.
- **Keyboard selections** (shift+arrows, shift+click chains) flush after a quiet period
  (`SELECTION_DEBOUNCE_MS = 400` after the last `selectionSet`), so holding shift+↓ emits one
  range, not one per keypress. The pointer `mouseup` flush cancels the debounce and vice versa
  — one flush per gesture, whichever seam sees it first.
- The existing `queueMicrotask` deferral (never dispatch mid-update) stays on the flush path.
- `destroyView()` resets the whole gesture state, so a rebuild (content/path/theme change) or
  destroy mid-gesture never emits a range computed against the old document.

### 2. Merge overlapping references

`PromptContextStore.addReference` merges instead of appending, via the exported pure function
`mergeReference(refs, ref): CodeReference[]` (`shared/state/prompt-context.store.ts`):

- Two ranges of the same `path` merge when they overlap **or touch** (`a.endLine + 1 >=
  b.startLine`), producing `min(startLine)–max(endLine)`. The predicate is a single
  `shouldMerge` helper, so switching to strict-overlap-only stays a one-line change.
- Merging is transitive: a new range bridging two existing chips collapses all three into one.
- A new range fully inside an existing reference is a no-op, and exact duplicates stay one
  entry (both subsumed by the merge rule).
- The merged reference keeps the array position of the first partner it absorbed, so chips
  don't jump; disjoint references append.
- The highlight painting (`currentHighlights` in the file browser) follows automatically since
  it derives from `references`.

## Non-goals

- No change to how references render (chips, `trackRef`) or to highlight painting.
- No cross-file merging; ranges only merge within the same `path`.
- Rendered-view modes, anchors (`openAtLine`) and `scrollToLine` are untouched.

## Resolved questions

- **Re-selecting an existing reference does not toggle it off** — the chip's ✕ button is the
  removal affordance; selection stays additive.
- **Touching ranges merge** (`5-10` + `11-12` → `5-12`) — chips read cleaner; the predicate is
  isolated in `shouldMerge` if distinct-adjacent-spots intent ever needs preserving.
- **Keyboard debounce is 400 ms** (`SELECTION_DEBOUNCE_MS`) — a single module constant to tune
  if it ever feels laggy for a deliberate shift+click range.

## Tests

- `code-viewer.component.spec.ts` — selection-lifecycle suite driving the real CodeMirror
  `updateListener` seam (selection transactions via `EditorView.findFromDOM` + dispatch;
  vitest fake timers restricted to `setTimeout`/`clearTimeout` so the `queueMicrotask` flush
  stays real): several selection updates + mouseup → exactly one emit with the final range
  (and the canceled debounce doesn't double-emit); keyboard growth emits once after the quiet
  period; a plain cursor click emits nothing; selection followed by a collapsing click emits
  nothing; after `fixture.destroy()` a document mouseup emits nothing (listener removed).
- `prompt-context.store.spec.ts` — `mergeReference` unit tests: disjoint append, overlap
  merge, touching merge, containment no-op, transitive bridge, cross-file no-merge, merged-ref
  placement; plus a store-level test that `addReference` merges overlapping adds.
