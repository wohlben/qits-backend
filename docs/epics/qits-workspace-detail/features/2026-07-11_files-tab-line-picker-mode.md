# Files-tab line picker mode: pick lines like the web view picks elements

## Introduction

The Files tab's code viewer used to treat **every** finalized selection as a pick: select a few
lines to copy them and a reference chip landed in the prompt context as a side effect. There was
no way to select text *without* collecting it. The Web view tab already solved this exact
tension with an explicit **picker mode** — a toggle arms the pick gesture, and until it is armed
the framed app behaves normally. This feature establishes the same UX in the Files tab: a
pick-mode toggle gates line selection. **Picker active** → drag/keyboard selection collects line
references exactly as before, and native text selection is disabled (the gesture reads as
*picking lines*, not selecting text). **Picker off** → plain browser text selection for
reading/copying, and nothing is collected. Picks also got richer: the reference captures the
**code excerpt** at pick time, and the Chat tab's "attached to the prompt" rows show it beneath
the `path:lines` label — you see *what* you attached, not just where it lives.

Related/dependent plans:

- [daemon-webview-picker](2026-07-05_daemon-webview-picker.md) — the UX model being mirrored:
  `pickMode` signal, crosshair `z-button` with `aria-pressed` and an active-state label
  (`pattern/daemon/webview/daemon-webview.component.ts`). Its one-shot + ⇧-keeps-picking
  contract is deliberately *not* mirrored (see Design 1).
- [workspace-file-browser](2026-07-02_workspace-file-browser.md) — owns the file content header
  where the toggle landed and the `selectRange` → `addReference` seam now gated.
- [files-tab-selection-as-prompt-context](2026-07-11_files-tab-selection-as-prompt-context.md)
  — the store the picks flow into; its "line selection stays the sole attach gesture" non-goal
  gained the qualifier *while pick mode is armed*, and its "no file content in the prompt"
  resolved question is upheld: the excerpt is a UI preview, never serialized.
- [line-reference-selection-lifecycle](2026-07-11_line-reference-selection-lifecycle.md) — the
  finalize lifecycle stays exactly as shipped; this feature gates whether the gesture machinery
  runs at all, and extends `mergeReference` to stitch excerpts when ranges merge.
- [speak-to-prompt](2026-07-02_speak-to-prompt.md) — the Chat-tab panel whose "Selected code
  (attached to the prompt)" rows gained the excerpt preview.
- [workspace-smart-file-display](2026-07-03_workspace-smart-file-display.md) — the `file-viewer`
  middle hop threads the new `pickMode` input through to the code viewer the same way it passes
  `highlights`.

## Design

### 1. A pick-mode toggle, same family as the web view's

- The file browser (`pattern/workspace/workspace-file-browser.component.ts`) owns the mode and
  renders a toggle button in the file content header, leading the reference-chips row:
  `z-button`, `zType` `default`/`outline` by state, `aria-pressed`, `lucideCrosshair` icon —
  deliberately the same affordance as the web view's "Pick element" button so the mode reads as
  one concept. Label: `Pick lines` / `Picking — select line ranges`.
- The mode is **sticky**: it stays armed across picks until toggled off, so several ranges can
  be collected in one arming. This deliberately diverges from the web view's one-shot +
  ⇧-keeps-picking contract — collecting multiple ranges is the common flow for code, and there
  is no framed app that needs its normal behaviour back after each pick.
- The mode is a `linkedSignal` keyed on the open path (`computation: () => false`), so switching
  files disarms it — ephemeral viewer state, like the web view's.
- The toggle renders only while the code view is active (`codeViewActive`: file loaded,
  non-binary, non-null content, `viewerMode() === 'source'` — the same rule as the viewer's
  `effectiveMode`, computed from pieces the browser already owns).

### 2. `pickMode` gates the selection lifecycle in the viewer

- `CodeViewerComponent` gained a `pickMode` input (threaded through `file-viewer` like
  `highlights`). When **off**, the gesture machinery is inert: `selectionSet` updates record
  nothing, no debounce runs, mouseup flushes nothing — `selectRange` never fires. Toggling the
  mode off mid-gesture clears any pending range (a dedicated effect calls `clearPending()`), so
  a later mouseup can't emit it.
- When **on**, the shipped finalize/merge lifecycle applies unchanged (mouseup flush, 400 ms
  keyboard debounce, store-side merge).
- The browser's `addReference` also guards on `pickMode` — defense in depth for the race where
  the user disarms between the viewer's `queueMicrotask`-deferred emit and the handler running.

### 3. Native text selection disabled while picking

- Pick mode applies `user-select: none` to the editor content (CodeMirror theme, swapped via a
  dedicated `pickCompartment` so toggling doesn't rebuild the view). CodeMirror's own mouse
  selection keeps working — it computes positions itself and dispatches selection transactions —
  so the gesture still drives `selectionSet` updates; only the browser's native copyable
  selection is suppressed.
- Selection feedback while picking comes from CodeMirror's `drawSelection` extension (enabled
  only in pick mode, same compartment), so the picked range stays visible without native
  selection painting.
- With pick mode off, selection is fully native again: select, copy, no side effects.

### 4. The pick captures the code excerpt, shown on the Chat tab

- `CodeReference` gained an optional `excerpt` — the selected lines' text, captured at pick
  time. The file browser slices it from the open file's already-loaded content when stamping the
  path in `addReference` (the viewer's `selectRange` payload stays a plain `LineRange`).
  Optional, because the reference's identity stays the `(path, startLine, endLine)` triple and
  producers without content access may omit it.
- **Merging stitches excerpts.** `mergeReference` reconstructs the merged excerpt from its
  partners' excerpts: each carries its lines keyed by `startLine`, and the merge rule
  (overlap-or-touch, transitive) guarantees the union is contiguous, so the merged excerpt is
  the line-map read out from `min(startLine)` to `max(endLine)`. Where a stale and a fresh pick
  disagree on an overlapping line (the file changed between picks), the incoming pick's lines
  win. When a merge partner carries no excerpt, the merged reference carries none either — a
  fabricated gap would misrepresent the range. Stays a pure function, unit-testable as before.
- The Chat tab's "Selected code (attached to the prompt)" rows render the excerpt beneath the
  `path:start[-end]` label — a plain `<pre>` monospace block, capped height (`max-h-40`) with
  its own scroll so a huge range doesn't swallow the panel.
- **Display-only.** `formatReferencesForPrompt` still serializes paths + line ranges, nothing
  else — the agent reads the workspace files itself (fresh, cheap), per the resolved question
  in files-tab-selection-as-prompt-context. The excerpt exists so the *human* can audit what
  they attached; staleness after workspace edits is therefore cosmetic.

## Non-goals

- No change to the shipped emit lifecycle, chip rendering, or highlight painting; the merge
  rule itself (overlap-or-touch, min/max) is untouched — it only learned to carry excerpts.
- No excerpt in the prompt or the chat dialog's insert-buttons — both keep the one-line
  `path:start[-end]` form; the excerpt is Chat-tab preview only.
- No picking in rendered views (markdown/frontmatter): the toggle only applies to the code
  view; rendered modes never collected references and still don't.
- No pick-mode state in the URL, and no persistence across files or navigation — the mode is
  ephemeral viewer state, like the web view's.
- No changes to the Web view picker itself.

## Resolved questions

- **Arming the picker does not force the code view** — the toggle only renders while the code
  view is active (`codeViewActive`), so there is no hidden mode switching; a file open in
  rendered mode simply offers no picker.
- **No Escape to disarm** — the web view picker has no Escape handling either; if it gains one,
  add it here in the same change for parity.
- **Excerpt renders as a plain `<pre>` block** — upgrade to the fit-mode code viewer (syntax
  highlighting) only if it gains a line-number offset input so the gutter shows `startLine`…
  rather than `1`….
- **The excerpt is stored fully** (no cap) — the merge stitching needs the real lines; the
  capped-height scroll handles display of pathological picks.

## Tests

- `code-viewer.component.spec.ts` — with `pickMode` off, selection dispatches + mouseup +
  elapsed debounce emit nothing; with it on, the existing lifecycle tests pass unchanged (the
  mount helper arms the mode); toggling off mid-gesture clears the pending range (no late emit)
  and re-arming restores the lifecycle; toggling swaps extensions in place — same `EditorView`
  instance, `.cm-selectionLayer` present only while armed.
- `file-viewer.component.spec.ts` — `pickMode` reaches the child code viewer; default off.
- `workspace-file-browser.component.spec.ts` — the toggle renders only when the code view is
  active (not for rendered markdown, not for binary), with `aria-pressed` tracking the signal;
  the mode stays armed after a pick (sticky) and only the toggle or a file switch disarms it;
  a disarmed `addReference` collects nothing; `addReference` slices the excerpt from the open
  file's loaded content.
- `prompt-context.store.spec.ts` — merged excerpts stitch correctly for the overlap, touching,
  containment, and bridge cases; an overlapping stale line is overwritten by the incoming
  pick's text; disjoint refs keep their own excerpts; a partner without an excerpt drops the
  merged excerpt; an empty-string excerpt (picked blank line) survives;
  `formatReferencesForPrompt` never serializes the excerpt.
- `speak-to-prompt.component.spec.ts` — reference rows render the excerpt block (and none
  without one); `launch()` output still contains only `path:start[-end]` lines (no excerpt
  leaks into the prompt).
- Manual (`seed-webapp` → greeting workspace → Files tab): with the picker off, drag-select and
  copy text — no chip appears; arm the picker, drag twice — two picks land (merged per the
  lifecycle rules) with the mode still armed, and text is not natively selectable during the
  drags; toggle off — selection is native again and collects nothing; the Chat tab rows show
  each reference's code beneath its `path:lines` label.
