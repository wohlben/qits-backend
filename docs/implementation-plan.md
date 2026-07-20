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

### 5. `mcp-task-prompt-delivery` — bootstrap-turn rewiring

The push→fetch switch in `AgentLaunchService`, per launch shape. Do the **interactive PTY leg
first** (it's the must-have that motivated all this), then chat and autonomous. The acceptance gate
is the new IT against the real `taskPrompt` tool from step 4. Chat's existing inline push keeps
working until this adopts it, so this is incremental, not a big-bang cutover.

### 6. `sketch-tab-and-image-prompt-attachments` — store slice + paste handler

`images` slice (backed by the attachment rows from step 2), Chat-tab attachment rows, and the
clipboard-paste handler. **Paste before the canvas** — it's the cheapest way to get a real image
through the full pipeline and prove delivery end-to-end with any screenshot.

### 7. `sketch-tab-and-image-prompt-attachments` — the Sketch tab itself

The atrament canvas + toolbar + "Attach to prompt". Deliberately last: by now the pipeline is
proven, so this is pure compose-side UX.
