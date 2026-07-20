# Refresh-resilient prompt building: the prompt draft is workspace state on the backend

## Introduction

The workspace detail route is already refresh-resilient everywhere *except* the one place the
user invests manual effort: prompt composition. A running chat session survives a reload (the
process is server-owned in `CommandRegistry`; the socket replays the transcript on attach), the
active tab survives (URL slug), the Files-tab position survives (`?path=`/`?lines=`), and even
the tab *order* survives (`zReorderKey` → `localStorage`). But hit F5 with a half-built prompt
and everything composed toward the next launch is gone: the draft prompt text, the picked DOM
elements, the collected code references, any attached images, and the sketch canvas.

This idea makes the composed prompt a **backend-persisted attribute of the workspace**: one
draft record per workspace, autosaved as the user composes, rehydrated on load. Backend (not
browser) storage is deliberate — the draft follows the user **across devices and browsers**
(start picking elements at the desk, finish the prompt from the laptop), it cascades away with
the workspace like every other workspace-scoped row, and it needs no client-side quota/TTL
housekeeping. A running session's durability is server-side already; this gives the
*pre-launch* composition the same home.

> **2026-07-20 — promoted from convenience to necessity.**
> [mcp-task-prompt-delivery](../../qits-coding-agents/feature-ideas/mcp-task-prompt-delivery.md)
> makes the persisted draft **what the agent fetches**: the `taskPrompt` MCP tool serves the
> workspace's current prompt (markdown + attached images) to the session, replacing prompt
> *push* — the only viable image path for the interactive PTY (Agents tab). Two consequences
> for this design: the parts the server must serve become **server-readable** (the *split* below
> — a serialized-prompt field and structured attachment rows beside the still-opaque composition
> blob), and this feature moves ahead of the sketch/attachment UX in implementation order
> instead of trailing it.

Related/dependent plans:

- **Persists the store built up by**
  [files-tab-selection-as-prompt-context](../features/2026-07-11_files-tab-selection-as-prompt-context.md)
  and [daemon-webview-picker](../features/2026-07-05_daemon-webview-picker.md) — the
  root-scoped `PromptContextStore` (snippets + references, soon images) is exactly the state
  that evaporates today.
- **Serves the agent, not just the browser** —
  [mcp-task-prompt-delivery](../../qits-coding-agents/feature-ideas/mcp-task-prompt-delivery.md)
  reads this record: its `taskPrompt` tool returns `serializedPrompt` as the text block and the
  attachment rows as image blocks. That dependency is what forces the server-readable split and
  makes this idea a prerequisite rather than polish.
- **Answers the open question of**
  [sketch-tab-and-image-prompt-attachments](sketch-tab-and-image-prompt-attachments.md)
  ("does the sketch survive reload?") — the canvas autosave lands here, not there. (Formerly
  "the sketch feature stays shippable without this one" — no longer: under MCP delivery the
  attachment rows persisted here are the delivery path itself.)
- **Covers the draft owned by** [speak-to-prompt](../features/2026-07-02_speak-to-prompt.md)
  — the editable prompt textarea is component-local state today and becomes part of the
  persisted draft.
- **Cross-device freshness rides**
  [workspace-sse-live-updates](../../qits-workspaces/features/2026-07-07_workspace-sse-live-updates.md) — a new
  SSE event invalidates the draft query on other open clients (qits webui never polls).
- **Storage precedent**: `Workspace.preamble` is already a `@Lob` document on the workspace
  ([capture-ingest-workspace](../../qits-feature-intake/features/2026-07-14_capture-ingest-workspace.md)); the draft
  is a sibling document, in its own row so autosave churn never touches the workspace row.
- **Deliberately does NOT touch** what already survives:
  [persistent-chat-sessions](../../qits-coding-agents/features/2026-07-04_persistent-chat-sessions.md) /
  [chat-persistence-on-transcript](../../qits-coding-agents/features/2026-07-10_chat-persistence-on-transcript.md)
  own the running-session story;
  [tab-url deep links](../features/2026-07-10_workspace-tab-url-and-picked-file-deep-link.md)
  own tab + file position. (The
  [draggable-tabs](../features/2026-07-09_draggable-workspace-detail-tabs.md) `localStorage`
  precedent is deliberately *not* followed here: tab order is per-device ergonomics, a prompt
  draft is work product.)

## What is lost on refresh today (inventory)

| State | Where it lives | Survives F5? | Survives device switch? |
|---|---|---|---|
| Running chat conversation | Server (`CommandRegistry` + transcript replay) | ✅ | ✅ |
| Active tab, Files-tab file + lines | URL segment + query params | ✅ | via link |
| Tab order | `localStorage` (`zReorderKey`) | ✅ | ❌ (per-device, fine) |
| Picked DOM elements | `PromptContextStore.snippets` (in-memory) | ❌ | ❌ |
| Code references | `PromptContextStore.references` (in-memory) | ❌ | ❌ |
| Attached images (planned) | `PromptContextStore.images` (in-memory) | ❌ | ❌ |
| Draft prompt text / transcript | `speak-to-prompt` component signals | ❌ | ❌ |
| Sketch canvas (planned) | canvas element state | ❌ | ❌ |
| Chat-input draft (live session) | `command-chat` component signal | ❌ | ❌ |

The fix targets every ❌ row in the last five lines — and, because storage is backend, the
fourth column comes along for free.

## Design

### Backend: a semi-opaque draft — opaque composition blob + server-readable prompt & attachments

The record splits along one line: **what only the composing UI reads stays opaque; what the
server must serve to the agent (via `taskPrompt`) is structured.**

New entity `WorkspacePromptDraft` (own table, 1:1 with workspace, Flyway migration):

- `workspaceId` (PK, FK → workspace, cascade-deleted with it — `WorkspaceService.doDiscard`
  deletes the row beside the other workspace teardown),
- `content` — a `@Lob` JSON document, **opaque to the server** (composition state only),
- `serializedPrompt` — a `@Lob` text column: the **launch-ready markdown** produced by the
  client's existing prompt serializer, written on every autosave beside the blob. This is what
  `taskPrompt` returns as its text block — the server never *builds* the prompt, it only
  *serves* the client-serialized product.
- `updatedAt`.

New sibling entity `WorkspacePromptAttachment` (own table, n:1 workspace, cascade-deleted):
`id`, `workspaceId`, `mimeType`, `label` ("Sketch 1"), `source` (`sketch`/`paste`), `bytes`
(`@Lob`), `createdAt`. Attached images live **here as rows, not as base64 inside the blob** —
the server builds `taskPrompt`'s `ImageContent` blocks from them, enforces the per-image cap
and magic-byte sniff at upload time (the guardrails the sketch idea's dispatch section
specified), and the opaque blob stays small. The blob references attachments by id only.

The opaque content is the client's serialized composition state, schema-versioned by the client:

```jsonc
{
  "v": 1,
  "promptText": "…",               // the editable textarea content
  "snippets": [ … ],                // PickedSnippet[]
  "references": [ … ],              // CodeReference[]
  "attachments": ["att_9f3c", …],   // WorkspacePromptAttachment ids (bytes live in rows)
  "sketchCanvas": "data:image/png;…", // last canvas autosave → restored into the Sketch tab
  "chatDraft": "…"                  // unsent chat-input text
}
```

**Opaque where possible, on purpose**: the server never interprets picks/references/canvas — it
validates only well-formed JSON and a size cap. The slice shapes are frontend-owned and still
evolving; an opaque document means no backend DTO churn per slice, no OpenAPI model explosion,
and an old backend happily stores a newer client's draft. The trade-off — the server can't
render or migrate the *composition* — is acceptable because everything the server must
understand (`serializedPrompt`, attachments) is structured beside it. Guardrails:
`qits.workspace.prompt-draft-max-bytes` (default 2 MiB — the blob no longer carries image
payloads; over → 413), JSON parse validation (→ 400), and per-attachment
`qits.workspace.prompt-attachment-max-bytes` (default 2 MiB) + PNG/JPEG magic-byte sniff on
upload.

### API (`repository` area, beside the other workspace sub-resources)

- `GET  /api/repositories/{repoId}/workspaces/{workspaceId}/prompt-draft` → `{content,
  serializedPrompt, updatedAt}`, or 404 when none exists.
- `PUT  …/prompt-draft` → idempotent upsert of `{content, serializedPrompt}`, returns
  `{updatedAt}`.
- `DELETE …/prompt-draft` → 204; this is what `clear()` calls — and it deletes the workspace's
  attachment rows with it.
- `POST …/prompt-draft/attachments` (`{mimeType, label, source, dataBase64}`) → `{id}`;
  `DELETE …/prompt-draft/attachments/{id}` → 204. Plain JSON at sketch sizes, cap + sniff on
  ingest.

Same row/existence validation as the sibling workspace endpoints (repo row + active workspace
row); no container involvement — the draft is pure host-side data, so it works on a `STOPPED`
workspace without materializing anything.

### Frontend: the store gains a workspace dimension and a sync loop

**Keying.** Today `PromptContextStore` is one root-scoped bag — picks collected while viewing
workspace A render on workspace B's Chat tab. Persistence would freeze that wart into a bug
("why does this old sketch from another workspace keep reappearing?"), and a per-workspace
backend row forces the decision anyway: the store becomes workspace-scoped internally
(`Map<workspaceId, slices>` behind unchanged workspace-scoped views), `clear()` clears the
current workspace's bucket only. This is the one deliberate behavior change: cross-workspace
carry-over of picks stops; if "reuse this pick over there" is ever wanted, an explicit
"copy to…" affordance beats implicit global state.

**Hydrate.** A TanStack query per workspace (`['workspaces', id, 'prompt-draft']`) fetches
once on detail-page load and patches the bucket; unknown/newer `v` fields pass through
untouched (serialize back out what was read), a parse failure treats the draft as absent.

**Autosave.** An `effect` on the bucket serializes and `PUT`s, debounced (~1.5 s) and
coalesced (never more than one in-flight save; a dirty flag re-saves after landing) so
keystrokes and pick-bursts don't hammer the endpoint. The draft prompt textarea moves from
`speak-to-prompt` component state into the bucket (`promptText`); the speech transcript and
intermediate refinement stay unpersisted — they are one-shot inputs whose *product* is the
editable text. The Sketch tab autosaves `canvas.toDataURL()` into `sketchCanvas` on
stroke-end and redraws it on mount — the working canvas persists separately from the attachment
rows (already-attached exports), so refresh restores both the attachments and the
drawing-in-progress. Attaching an image `POST`s the attachment row first and only then records
its id in the bucket, so the blob never references bytes the server doesn't hold.

**Cross-device freshness — SSE, never polling.** The workspace detail page already holds one
SSE subscription (`WorkspaceLiveService`, the freshness push that keeps child queries from
polling); the draft **piggybacks on that existing stream** — no second `EventSource`, no new
endpoint. The PUT/DELETE handlers emit a `prompt-draft-changed(workspaceId)` event type on
that channel; connected clients invalidate the draft query, so a draft edited on another
device updates the open view live. Apply the refetched draft only when the local
bucket is **pristine** (no unsaved local edits) — a device with in-flight typing keeps its
version and wins on its next autosave (last-write-wins, see open question). The saving client
ignores the echo of its own event (compare returned `updatedAt`).

### Restore transparency

A restored non-empty draft renders a subtle one-line hint above the prompt panel — "Restored
draft from 2 h ago" with a Discard action (→ `clear()`, which `DELETE`s). Cheap insurance
against week-old context silently riding into a launch; the hint disappears on first edit.

## Open questions

- **Concurrent editing**: two devices composing the same workspace draft simultaneously is
  last-write-wins per autosave — fine for the sequential switch-devices flow this targets,
  lossy for true simultaneous edits. If that ever matters, add optimistic concurrency
  (`PUT` carries the base `updatedAt`, 409 → refetch) before reaching for anything fancier;
  the pristine-only SSE apply already prevents silent mid-typing clobbers.
- **Per-user drafts?** The row is per-workspace, not per-(workspace, user) — matching qits'
  one-operator-per-workspace reality. If multi-user contention on one workspace becomes real,
  keying by user is a migration, not a redesign; noting it here so the decision is conscious.
- **Stale code references**: restored `path:lines` may drift after commits land. Restore them
  anyway — references are never revalidated within a live session today either, and the rows
  link back into the Files tab where the drift is visible. Revisit only if it misleads.
- **Launch = clear?** The autosave mirrors whatever launch does to the store today. If launch
  leaves context in place (for a follow-up run), persistence keeps that too — decide the
  desired post-launch semantics once, here, since the backend row makes the answer stick
  across sessions and devices.

## Non-goals

- **No client-side persistence layer** — no IndexedDB/localStorage mirror, no offline edit
  queue. A refresh needs the backend anyway (everything else on the page does); the draft
  simply rides the same availability.
- **No server-side interpretation of the *composition*** — the backend never renders picks,
  dedupes snippets, or validates references; prompt **serialization stays a frontend concern**
  (the server serves `serializedPrompt`, it does not build it). The structured parts
  (`serializedPrompt`, attachment rows) are served verbatim to the agent via `taskPrompt`, not
  interpreted.
- **No history/versioning** — one draft per workspace, mutated in place. Not an undo system.
- **No persistence of running-chat state** — already server-owned.

## Testing sketch

- Backend: controller test — GET 404 when absent; PUT→GET roundtrips `content` +
  `serializedPrompt` byte-identical with monotonic `updatedAt`; upsert overwrites; DELETE → 404
  on next GET and empties the attachment rows; oversize → 413; malformed JSON → 400; unknown
  repo/workspace → 404; workspace discard deletes draft + attachments (regression: no orphans).
  Attachment ingest: cap → 413, wrong magic bytes → 400, sniffed type wins over claimed mime.
  Migration applies on H2.
- SSE: PUT emits `prompt-draft-changed` on the workspace events stream; DELETE too.
- Store spec: buckets are workspace-scoped (A's picks invisible under B); hydrate patches the
  bucket and round-trips unknown fields; autosave debounces + coalesces (one in-flight save,
  dirty re-save); `clear()` issues DELETE; pristine-only SSE apply (local edits never
  clobbered by a refetch).
- `speak-to-prompt` spec: textarea round-trips through `promptText`; restore hint shows for a
  non-empty restored draft, Discard clears, first edit dismisses.
- Sketch component spec: stroke-end autosaves `sketchCanvas`; mount redraws it.
- Manual (`/verify`, seed-webapp): pick an element, select lines, type a draft, draw a sketch
  → hard-refresh → all four restored; open the same workspace in a second browser → same
  draft appears; Discard in one browser empties the other via SSE.
