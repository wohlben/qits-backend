# Implementation plan: sketch/image prompt attachments via MCP prompt delivery

Ordering for the three plans that together let a user attach a drawing (or any image) to the
coding agent, delivered to every launch shape — including the must-have interactive PTY session —
by having the agent **fetch** its prompt over MCP rather than being pushed it.

The chain is a hard dependency line: the persisted prompt draft *is* what the agent fetches, and
the sketch is one source of the attachments that ride that draft.

- [refresh-resilient-prompt-building](epics/qits-workspace-detail/feature-ideas/refresh-resilient-prompt-building.md)
- [mcp-task-prompt-delivery](epics/qits-coding-agents/feature-ideas/mcp-task-prompt-delivery.md)
- [sketch-tab-and-image-prompt-attachments](epics/qits-workspace-detail/feature-ideas/sketch-tab-and-image-prompt-attachments.md)

The mechanism the whole chain rests on — an MCP tool result carrying mixed text + image content,
rendered to the model in both `-p` and the interactive TUI — is proven (throwaway spike run
2026-07-20, documented in the feature-ideas above; no committed test kept — the committed IT lands
against the real Java `taskPrompt` tool in step 4). There is no research risk left to retire before
step 1.

## Steps

### 1. `refresh-resilient-prompt-building` — draft persistence backend

`WorkspacePromptDraft` entity + Flyway migration + `GET/PUT/DELETE …/prompt-draft`, carrying the
opaque composition blob **and** the server-readable `serializedPrompt` column. This is the
foundation everything else reads, and it already delivers standalone user value (refresh survival
for prompt text, picks, and references). No dependency on anything below.

### 2. `refresh-resilient-prompt-building` — attachment rows backend

`WorkspacePromptAttachment` entity + `POST/DELETE …/prompt-draft/attachments`, with the per-image
cap and PNG/JPEG magic-byte sniff on ingest (the guardrails that moved here from the sketch doc's
old dispatch section). Backend only, no UI yet — but this is what the MCP tool turns into image
blocks.

### 3. `refresh-resilient-prompt-building` — frontend store + sync

Workspace-scoped `PromptContextStore`, hydrate-on-load, debounced/coalesced autosave, SSE
invalidation, `promptText` moved into the bucket. This completes and ships the whole
refresh-resilience feature — worth landing as its own increment because it de-risks the store
rework (the one deliberate behavior change: cross-workspace pick carry-over stops) before any
agent wiring depends on it.

### 4. `mcp-task-prompt-delivery` — the `taskPrompt` tool

Tool bean on the existing `repository` MCP server + `TaskPromptToolFilter` (mirroring
`TelemetryToolFilter`) + entry in `READ_ONLY_REPOSITORY_TOOLS`. Returns `serializedPrompt` as a
text block plus the attachment rows as `ImageContent` blocks. Unit-testable with
`quarkus-mcp-server-test`, no frontend needed — reads what steps 1–2 persist.

### 5. `mcp-task-prompt-delivery` — bootstrap-turn rewiring ✅ shipped 2026-07-20

The push→fetch switch in `AgentLaunchService`, per launch shape (interactive, chat, autonomous).
Delivery is gated on a real persisted draft via a `deliverTaskPrompt` launch flag; autonomous
(conflict resolution) was rewired to persist its prompt as the resolution workspace's draft + attach
the `repository` MCP server. Added a monotonic `prompt_version` + `last_run_*` run-tracking on the
draft (migration V38) so the Agents tab picks up an un-run draft exactly once, and a synchronous
`flushNow()` before launch closes the same-tab autosave race. Acceptance gate: the extended
`TaskPromptDeliveryIT` against the real `taskPrompt` tool (print + tmux-PTY nonce read-back). See the
"Implementation notes (as shipped)" in the feature doc.

### 6. `sketch-tab-and-image-prompt-attachments` — store slice + paste handler ✅ shipped 2026-07-20

`images` slice (backed by the attachment rows from step 2), Chat-tab attachment rows, and the
clipboard-paste handler. **Paste before the canvas** — it's the cheapest way to get a real image
through the full pipeline and prove delivery end-to-end with any screenshot.

Implementation notes (as shipped):

- **New read path**: a `GET …/prompt-draft/attachments` endpoint returning each row's metadata **plus
  `dataBase64`** (`WorkspacePromptAttachmentDataDto`; the byte-free `WorkspacePromptAttachmentDto`
  stays the agent-facing shape). Forced by a config reality — image bytes can't live in the draft
  blob (its 2 MiB cap < one encoded image at the 2 MiB attachment cap) — so thumbnails are restored
  from the rows, not the blob. OpenAPI + the Angular client regenerated.
- **`images` slice** on `PromptContextStore`, deliberately **orthogonal to the draft autosave**: not
  serialized into `content`, not in `isEmpty`; patched directly (no `dirty`/`revision` churn). Managed
  by `PromptDraftSyncService` via POST-on-attach / DELETE-on-remove + a `['workspace-prompt-attachments']`
  GET-list query that hydrates on load and SSE-refetch. `clearAttachments()` (paired with `clear()`)
  deletes the rows, covering the attachments-only case the draft-DELETE cascade would miss.
- **Compose UX**: thumbnail Remove rows + a clipboard-`(paste)` handler (`shared/utils/image-attach.ts`
  — downscale long-edge ≤ 1568 px, white-backfill, PNG-encode, strip prefix) on `speak-to-prompt`
  (pre-launch) **and** `command-chat` (mid-session, gated on workspace context passed from
  `workspace-chat`). Mid-session delivery is a **`taskPrompt` re-fetch nudge** appended to the outgoing
  turn — no transport change, since `taskPrompt` reads the live rows (product decision: cover
  mid-session too, not just launch).
- **SSE**: attachment add/remove fire the existing `PROMPT_DRAFT` hint; the frontend invalidates both
  the draft and attachments queries on that topic.
- Tests: backend GET-list roundtrip; store slice (add/remove/setImages/label numbering/clear/switch,
  no dirty bump); sync-service attach/hydrate/clearAttachments; `speak-to-prompt` + `command-chat` rows
  + nudge; `image-attach` downscale math. Full suite green (backend + 506 frontend specs, lint clean).

Post-review hardening (high-effort `/code-review`, all findings resolved):

- **Data-loss fix**: `isPromptContextEmpty` now counts images, so clearing the prompt text with an
  image attached PUTs (keeps the draft) instead of DELETE-cascading the attachment rows away. Same
  fix un-hides the launch section for an images-only draft.
- **Paste errors surfaced**: `onPaste` (both surfaces) catches a failed attach (oversize 413/encode)
  and shows a message instead of swallowing it.
- **Collision-free labels**: `nextImageLabel` numbers past the highest existing suffix, not the count.
- **Attachment SSE split**: a dedicated `PROMPT_ATTACHMENTS` hint topic (not `PROMPT_DRAFT`), so a
  prompt-text autosave no longer refetches image bytes or flickers a mid-POST thumbnail.
- **Security**: `runAction` added to `ReadOnlyRepositoryToolFilter`'s mutating set (regression test in
  `RepositoryMcpToolsTest`) — an unattended read-only run can no longer execute action scripts.
- **Cleanups**: deleted the dead byte-free DTO + mapper; extracted the shared `prompt-draft` fetch
  (`prompt-draft-query.ts`) used by the sync service and the Agents tab.
- Two PLAUSIBLE step-5 delivery-model gaps (no-seed on undeliverable prompt; autonomous task loss on
  unreachable MCP) got a diagnostic WARN and an issue doc
  (`docs/issues/2026-07-20_fetch-model-prompt-delivery-robustness.md`); a full fix is deferred there.

### 7. `sketch-tab-and-image-prompt-attachments` — the Sketch tab itself ✅ shipped 2026-07-20

The atrament canvas + toolbar + "Attach to prompt". Deliberately last: by now the pipeline is
proven, so this is pure compose-side UX.

Implementation notes (as shipped):

- **`atrament` dependency** (the doc's pick — vanilla-JS canvas lib, no shipped types, so a minimal
  `shared/types/atrament.d.ts` module declaration rides along).
- **`WorkspaceSketchComponent`** (`pattern/workspace/workspace-sketch.component.ts`), standalone
  OnPush, wraps atrament the way `web-terminal.component.ts` wraps xterm: grab the host `<canvas>`
  via `viewChild`, init once in a one-shot `effect` guard, tear down in `ngOnDestroy`. Toolbar
  (pen/eraser, three colours, three widths, undo, clear) is ours (`z-button` + Tailwind).
  **Undo** is a `toDataURL` snapshot stack pushed on atrament's `strokeend` event (atrament has no
  built-in undo). The canvas is white-backfilled, and "Attach to prompt" exports via
  `canvas.toBlob` → the existing `blobToAttachment` (white background + downscale) →
  `PromptDraftSyncService.attachImage(dataBase64, mime, 'sketch')` — the *same* path a pasted
  screenshot takes, so no store/sync/backend change was needed (step 6 already wired the `'sketch'`
  source). A defensive guard skips atrament init when the canvas has no 2D context (jsdom/tests).
- **Tab wiring** (`workspace-detail.page.ts`): added `WorkspaceSketchComponent` to `imports`,
  `['Sketch','sketch']` to `TAB_SLUG_BY_LABEL` (URL-pinned/shareable; the route matcher already
  accepts any non-`wip` slug), and a `<z-tab label="Sketch">` after Files. The panel stays mounted
  while hidden, so a half-finished drawing survives tab switches.
- Tests: `workspace-sketch.component.spec.ts` (atrament mocked via `vi.hoisted`; jsdom canvas
  stubbed) covers the toolbar state machine, undo/clear snapshot stack, the `'sketch'` attach call +
  confirmation flash, surfaced attach errors, and teardown. `workspace-detail.page.spec.ts` tab-row
  assertions updated. Full suite green (backend untouched; frontend 520 specs, lint clean).

Post-review hardening (high-effort `/code-review`):

- **Undo baseline fix**: `pushSnapshot`'s cap evicted the blank baseline (`history[0]`) after 30
  strokes, so undo could no longer reach a clean canvas — it now evicts the oldest *stroke* (index 1)
  and keeps the baseline pinned (regression test added).
- **Repaint race**: `undo()` advanced `history` synchronously but repainted via async `Image.onload`;
  a `repaintSeq` generation stamp now makes a superseded repaint bail, so the last-requested snapshot
  always wins (rapid double-undo can't leave the canvas out of sync with `history`).
- **Single-encode export**: attach previously round-tripped `canvas.toBlob` → `blobToAttachment`
  (decode + white-fill + re-encode); it now composites the canvas onto a white-backed export canvas
  once (`exportSketch`, reusing the shared `scaledDimensions`/`stripDataUrlPrefix`), keeping the same
  white-backfill + downscale result without the extra decode.

The whole three-plan chain (steps 1–7) is now complete: a user can attach a drawing (or any image)
to the coding agent, delivered to every launch shape via the `taskPrompt` MCP fetch.
