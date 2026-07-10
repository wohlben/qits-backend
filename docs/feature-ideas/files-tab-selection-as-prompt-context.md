# Files-tab selection as prompt context: show code references on the Chat tab like picked elements

## Introduction

The Files tab already collects line-range selections as `CodeReference` chips
(`path:start-end`, doc-commented as *"staged to later become part of a Claude prompt"*) — but
they are browser-local: nothing outside `workspace-file-browser.component.ts` sees them, and
they never reach the prompt. Meanwhile the WebView's picked elements flow through the
root-scoped `PromptContextStore` and surface on the Chat tab as removable "picked elements"
rows that get serialized into the agent's initial context. This idea closes the gap: **promote
`CodeReference` collection into `PromptContextStore`**, so Files-tab selections render on the
Chat tab exactly like picked elements — same rows, same remove/clear lifecycle, same
serialization into the prompt.

Related/dependent plans:

- [workspace-file-browser](../features/2026-07-02_workspace-file-browser.md) — owns the
  `CodeReference` chips and the `selectRange` → `addReference` seam this idea re-homes.
- [daemon-webview-picker](../features/2026-07-05_daemon-webview-picker.md) +
  [picked-element-component-attribution](../features/2026-07-10_picked-element-component-attribution.md)
  — the picked-elements flow (store → Chat-tab rows → prompt) this idea mirrors.
- [speak-to-prompt](../features/2026-07-02_speak-to-prompt.md) — the Chat-tab panel that
  renders the rows and launches the agent with the formatted context.
- [workspace-chat-dialog](../features/2026-07-04_workspace-chat-dialog.md) — the running-session
  dialog whose "Picked:" insert-buttons gain reference siblings.
- [workspace-tab-url-and-picked-file-deep-link](../features/2026-07-10_workspace-tab-url-and-picked-file-deep-link.md)
  — owns the `?path=` deep link the reference rows link back through (optionally extended with
  a line anchor here).
- [line-reference-selection-lifecycle](line-reference-selection-lifecycle.md) (idea) — fixes
  *when* ranges are emitted and *how* overlaps merge. Independent, but its `mergeReference`
  half lands in the store's `addReference` once references live there; that doc already
  anticipates this plan ("any future plan that feeds them to the chat/agent inherits the
  cleaned-up lifecycle for free").

## Current behaviour

- `WorkspaceFileBrowserComponent` keeps `references = signal<CodeReference[]>([])`
  (`workspace-file-browser.component.ts:1329`), fed by the code viewer's `selectRange`
  output and rendered as removable `z-badge` chips above the viewer (template ~line 326).
  The chips also paint highlights back into the viewer (`currentHighlights`).
- The Chat tab's speak-to-prompt panel renders only `PromptContextStore.snippets()` —
  Files-tab selections are invisible there, and `launch()` appends only
  `formatSnippetsForPrompt(snippets)` to the initial context.
- The two "attach context for the agent" gestures (pick an element in the WebView, select
  lines in the Files tab) thus have inconsistent lifecycles: one is global, visible on the
  Chat tab, and reaches the prompt; the other silently dies with the component.

## Design

### 1. References move into `PromptContextStore`

Add a second slice beside `snippets`:

- `CodeReference` (`{ path, startLine, endLine }`) moves from
  `workspace-file-browser.component.ts` to `shared/state/prompt-context.store.ts` (or a
  sibling types file); the browser imports it back.
- State becomes `{ snippets: PickedSnippet[], references: CodeReference[] }` with methods
  `addReference(ref)` (dedupe on exact `(path, startLine, endLine)` now; overlap-merge when
  the lifecycle idea lands), `removeReference(ref)`, and `clear()` extended to empty **both**
  slices — one "Clear" affordance, one context.
- The file browser's local `references` signal is deleted; chips render from
  `promptContext.references()` and `removeReference` delegates to the store. Highlights keep
  deriving from the same source, so painting is unchanged. Chips now survive tab switches and
  navigation the same way picks do (root store) — an upgrade, since the browser component
  stays mounted anyway but the store also survives leaving the workspace page.

### 2. Chat-tab rows, same family as picked elements

In `speak-to-prompt.component.ts`, beneath the "Picked elements" rows, render a
"Selected code" group (only when `references().length > 0`) with one row per reference:

- Row: monospace `path:start[-end]`, a **Remove** button → `promptContext.removeReference`,
  and the path rendered as a `routerLink` to `…/workspaces/:id/files` with
  `[queryParams]="{ path: ref.path }"` — the existing picked-file deep link, so clicking a
  row jumps to the file in the Files tab.
- Optional (small, worth it): extend the deep link with the range —
  `{ path, lines: '10-20' }` — and teach the workspace-detail page's `?path=` effect to pass
  it through `openAtLine(...)` instead of `openClosestMatch(...)` when present, so the row
  lands on the exact selection, highlighted.
- The chat dialog (`command-chat.component.ts`) gets matching insert-buttons in its
  "Picked:" row so a running session can pull a reference into the draft, mirroring
  `insertSnippet`.

### 3. Prompt serialization

`shared/state/snippet-format.ts` gains `formatReferencesForPrompt(refs)`: a short
"Selected code:" block of `- <path>:<start>[-<end>]` lines. No file content is embedded —
the agent runs inside the workspace container and reads the files itself; paths + line
ranges are precise, cheap, and never stale. `speak-to-prompt`'s `launch()` appends it after
the snippets block; the dialog insert-button sends the one-line form.

## Touch points

- `service/src/main/webui/src/app/shared/state/prompt-context.store.ts` — `references`
  slice, `addReference`/`removeReference`, widened `clear()`; `CodeReference` type lands
  here.
- `service/src/main/webui/src/app/shared/state/snippet-format.ts` —
  `formatReferencesForPrompt`.
- `service/src/main/webui/src/app/pattern/workspace/workspace-file-browser.component.ts` —
  drop the local signal, read/write the store; chips + highlights unchanged otherwise.
- `service/src/main/webui/src/app/pattern/speech/speak-to-prompt.component.ts` — "Selected
  code" rows + launch-time serialization.
- `service/src/main/webui/src/app/pattern/chat/command-chat.component.ts` — reference
  insert-buttons.
- `service/src/main/webui/src/app/pages/repositories/workspace-detail/workspace-detail.page.ts`
  — optional `?lines=` handling on the existing `?path=` effect.

## Non-goals

- No new pick gesture: the *selected file* (`selectedPath`) is browsing state, not context —
  merely clicking through the tree must not spray rows onto the Chat tab. Line selection
  stays the sole attach gesture.
- No change to *when* ranges are emitted or how overlaps merge — that is
  [line-reference-selection-lifecycle](line-reference-selection-lifecycle.md)'s job; this
  idea only relocates where they accumulate.
- No backend changes: references travel inside the existing `initialContext` / chat text.

## Open questions

- Should an explicit "attach whole file" affordance exist (e.g. a button in the viewer
  toolbar adding `path:1-<lastLine>` or a rangeless reference)? Lean: not yet — line
  selection covers it, and a rangeless variant complicates dedupe/merge.
- Embed the selected lines' text in the prompt instead of just `path:start-end`? Lean no
  (agent reads the workspace), but a self-contained prompt would help future non-workspace
  consumers; revisit if one appears.
- The WebView toolbar's `{{ count() }} picked` — keep it snippets-only, or total context
  items? Lean snippets-only (it labels the picker), with the Chat tab as the one place that
  shows everything.
- `clear()` clearing both slices: right for "start a fresh prompt", but the WebView toolbar's
  Clear button would now also drop code references picked elsewhere. Acceptable, or does the
  toolbar need a snippets-only clear?

## Test notes

- Store spec: `addReference` dedupes exact duplicates; `removeReference` removes only the
  matching ref; `clear()` empties both slices.
- `speak-to-prompt` spec: references render as rows with deep-link query params; remove
  updates the store; `launch()` sends `prompt + snippets block + references block`.
- `workspace-file-browser` spec: chips render from the store; removing a chip removes the
  Chat-tab row (same store).
- Manual: `seed-webapp` → greeting workspace → Files tab, select a few lines in
  `GreetingResource.java` → Chat tab shows the reference row → row's link jumps back to the
  file (at the lines, if `?lines=` is taken) → launching a session includes the
  "Selected code:" block in the first user turn.
