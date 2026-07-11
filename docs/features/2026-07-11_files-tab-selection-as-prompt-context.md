# Files-tab selection as prompt context: code references on the Chat tab like picked elements

## Introduction

The Files tab collects line-range selections as `CodeReference` chips (`path:start-end`),
but they used to be browser-local: nothing outside `workspace-file-browser.component.ts` saw
them, and they never reached the prompt. Meanwhile the WebView's picked elements flow through
the root-scoped `PromptContextStore` and surface on the Chat tab as removable "picked
elements" rows that get serialized into the agent's initial context. This feature closed the
gap: **`CodeReference` collection was promoted into `PromptContextStore`**, so Files-tab
selections render on the Chat tab exactly like picked elements — same rows, same
remove/clear lifecycle, same serialization into the prompt.

Related/dependent plans:

- [workspace-file-browser](2026-07-02_workspace-file-browser.md) — owns the `CodeReference`
  chips and the `selectRange` → `addReference` seam this feature re-homed.
- [daemon-webview-picker](2026-07-05_daemon-webview-picker.md) +
  [picked-element-component-attribution](2026-07-10_picked-element-component-attribution.md)
  — the picked-elements flow (store → Chat-tab rows → prompt) this feature mirrors.
- [speak-to-prompt](2026-07-02_speak-to-prompt.md) — the Chat-tab panel that renders the rows
  and launches the agent with the formatted context.
- [workspace-chat-dialog](2026-07-04_workspace-chat-dialog.md) — the running-session dialog
  whose "Picked:" insert-buttons gained reference siblings.
- [workspace-tab-url-and-picked-file-deep-link](2026-07-10_workspace-tab-url-and-picked-file-deep-link.md)
  — owns the `?path=` deep link the reference rows link back through, extended here with the
  `?lines=` anchor.
- [line-reference-selection-lifecycle](2026-07-11_line-reference-selection-lifecycle.md)
  — fixes *when* ranges are emitted and *how* overlaps merge. Independent, but its
  `mergeReference` half lands in the store's `addReference`, and the chat/agent flow
  inherits the cleaned-up lifecycle for free.

## Design

### 1. References live in `PromptContextStore`

A second slice beside `snippets` (`shared/state/prompt-context.store.ts`):

- `CodeReference` (`{ path, startLine, endLine }`) moved from
  `workspace-file-browser.component.ts` to the store file; the browser imports it back.
- State is `{ snippets: PickedSnippet[], references: CodeReference[] }` with methods
  `addReference(ref)` (initially dedupe on exact `(path, startLine, endLine)`; overlap-merge
  arrived with the lifecycle feature), `removeReference(ref)` (by value triple, not object
  identity),
  and `clear()` emptying **both** slices — one "Clear" affordance, one context.
- The file browser's local `references` signal is gone; `references` is an alias of the store
  slice, so chips render from `promptContext.references()` and `removeReference` delegates to
  the store. Highlights keep deriving from the same source, so painting is unchanged. Chips
  now survive tab switches and navigation the same way picks do (root store).

### 2. Chat-tab rows, same family as picked elements

In `pattern/speech/speak-to-prompt.component.ts`, beneath the "Picked elements" rows, a
"Selected code (attached to the prompt)" group renders (own gate on
`references().length > 0`, so it shows even with zero picks) with one row per reference:

- Row: monospace `path:start[-end]` label (single-line ranges collapse to `path:line`), a
  **Remove** button → `promptContext.removeReference`, and the label rendered as a
  `routerLink` to `…/workspaces/:id/files` with
  `[queryParams]="{ path: ref.path, lines: 'start-end' }"` — the picked-file deep link
  extended with the range. The `lines` param is always the two-number `start-end` form (even
  single-line, e.g. `7-7`) so the parser has one format.
- The workspace-detail page's `?path=` effect passes a valid `?lines=start-end` through
  `openAtLine(path, start, end)` (exact path — reference paths come from the browser's own
  tree, so they are exact by construction; this also yields the anchor highlight + scroll),
  and falls back to `openClosestMatch(path)` when `lines` is absent, malformed, or reversed.
  The one-shot guard keys on `path + lines`, so two references into the same file at
  different ranges both navigate.
- The chat dialog (`pattern/command/command-chat.component.ts`) has matching insert-buttons
  in its "Picked:" row (gate widened to snippets **or** references), so a running session can
  pull a reference into the draft; `insertReference` appends the one-line
  `codeReferenceLabel` form, mirroring `insertSnippet`.

### 3. Prompt serialization

`shared/state/snippet-format.ts` gained `codeReferenceLabel(ref)` (`path:start[-end]`) and
`formatReferencesForPrompt(refs)`: a short `Selected code:` block of `- <path>:<start>[-<end>]`
lines. No file content is embedded — the agent runs inside the workspace container and reads
the files itself; paths + line ranges are precise, cheap, and never stale. `speak-to-prompt`'s
`launch()` appends the block after the snippets block; the dialog insert-button sends the
one-line form.

## Touch points

- `service/src/main/webui/src/app/shared/state/prompt-context.store.ts` — `references` slice,
  `addReference`/`removeReference`, widened `clear()`; `CodeReference` lives here.
- `service/src/main/webui/src/app/shared/state/snippet-format.ts` — `codeReferenceLabel`,
  `formatReferencesForPrompt`.
- `service/src/main/webui/src/app/pattern/workspace/workspace-file-browser.component.ts` —
  local signal replaced by the store slice; chips + highlights unchanged otherwise.
- `service/src/main/webui/src/app/pattern/speech/speak-to-prompt.component.ts` — "Selected
  code" rows + launch-time serialization.
- `service/src/main/webui/src/app/pattern/command/command-chat.component.ts` — reference
  insert-buttons.
- `service/src/main/webui/src/app/pages/repositories/workspace-detail/workspace-detail.page.ts`
  — `?lines=` handling on the existing `?path=` effect.

## Resolved questions

- **No "attach whole file" affordance** — line selection covers it; a rangeless variant would
  complicate dedupe/merge.
- **No file content in the prompt** — the agent reads the workspace; revisit if a
  non-workspace consumer appears.
- **The WebView toolbar's `{{ count() }} picked` stays snippets-only** — it labels the
  picker; the Chat tab is the one place that shows everything.
- **`clear()` clears both slices** — right for "start a fresh prompt". Consequence: the
  WebView toolbar's Clear button also drops code references collected in the Files tab.
  Accepted; if that ever grates, give the toolbar a snippets-only clear.

## Non-goals

- No new pick gesture: the *selected file* (`selectedPath`) is browsing state, not context —
  merely clicking through the tree must not spray rows onto the Chat tab. Line selection
  stays the sole attach gesture.
- No change to *when* ranges are emitted or how overlaps merge — that is
  [line-reference-selection-lifecycle](2026-07-11_line-reference-selection-lifecycle.md)'s
  job; this feature only relocated where they accumulate.
- No backend changes: references travel inside the existing `initialContext` / chat text.

## Tests

- Store spec: `addReference` dedupes exact duplicates; `removeReference` removes by value;
  `clear()` empties both slices; `count()` stays snippets-only;
  `formatReferencesForPrompt` output incl. single-line label collapse.
- `speak-to-prompt` spec: reference rows render with the `{ path, lines }` deep link; Remove
  updates the store; `launch()` sends `prompt + snippets block + references block` (and the
  references block alone when nothing is picked).
- `workspace-file-browser` spec: chips read/write the shared store; removing store-side
  removes the chip.
- `command-chat` spec: insert-button appends the one-line form; the "Picked:" row shows with
  references only.
- `workspace-detail` spec: `?lines=10-20` → `openAtLine`; malformed/reversed `lines` falls
  back to `openClosestMatch`; the guard treats same-path/different-lines as distinct targets.
- Manual: `seed-webapp` → greeting workspace → Files tab, select a few lines in
  `GreetingResource.java` → Chat tab shows the reference row → the row's link jumps back to
  the file at the lines, highlighted → launching a session includes the "Selected code:"
  block in the first user turn.
