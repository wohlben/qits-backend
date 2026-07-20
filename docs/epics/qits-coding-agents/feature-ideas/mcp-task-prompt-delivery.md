# MCP task-prompt delivery: the agent fetches its prompt (text + images) from qits

## Introduction

Today the prompt is *pushed* at the agent, and every launch shape pushes differently: chat writes a
stream-json user message, the interactive PTY gets an argv prompt plus injected keystrokes,
autonomous runs get argv. That asymmetry broke the image-attachment idea (see the feasibility update
in the sketch doc below): the PTY has no image-carrying input format, so a pushed prompt can never
carry a picture there. This idea inverts the direction — **the prompt becomes something the agent
*fetches* from qits over MCP**:

- The composed prompt (the refined markdown built on the workspace detail route) is canonical in
  qits' DB — the persisted prompt draft.
- A new workspace-scoped MCP tool, **`taskPrompt`**, returns it as a **mixed content array**: the
  serialized markdown as a text block, followed by every attached image as a labeled MCP
  `ImageContent` block. One call, whole prompt, pictures included — MCP tool results are content
  arrays of the same shape as chat messages, so the text-beside-image adjacency the chat transport
  has natively is recovered for every launch shape.
- The pushed prompt shrinks to a **bootstrap turn**: *"Fetch the current task prompt with the
  `taskPrompt` tool and implement it."* One short sentence — trivially deliverable as argv at
  launch and as an injected keystroke line mid-session, so the fragile part of PTY delivery
  (escaping a medium-large markdown document through a keystroke stream) disappears entirely.

The division of labor is deliberate: the **bootstrap turn carries authority** (user intent — "do
this"), the **tool result carries content** (what "this" is). That is the standard
"fetch-the-ticket-and-implement" MCP workflow, and it makes the mechanism launch-shape-universal:
chat, interactive PTY, and autonomous `-p` all support MCP tools, so one delivery pipeline covers
all three and the "images require the chat launch" degradation UX is never built.

**Feasibility is proven, not assumed** (spike run 2026-07-20, documented here — no committed test
kept): against the real `qits/workspace` image (Claude Code v2.1.204), a throwaway stdio stub MCP
server returning a nonce PNG as an `ImageContent` block was exercised in `-p` mode and in the
**interactive TUI** — in both, the model called the tool from a one-sentence instruction on the
first turn, described the drawing's content, and read back the in-image nonce (impossible unless the
client converts the MCP image result into a native image block). The stub was a language-agnostic
throwaway, deliberately **not** committed: qits serves MCP in Java (`quarkus-mcp-server`), so the
only committed test is the real one that lands with the `taskPrompt` tool (see Testing).
Supporting stack facts: MCP-spec `ImageContent` is a first-class tool-result content type, and
quarkiverse `quarkus-mcp-server` lists `ImageContent` among the `Content` types a `@Tool` method
returns directly — so the real tool emits image blocks with no custom encoding.

Related/dependent plans:

- **Hard dependency — the prompt must live server-side**:
  [refresh-resilient-prompt-building](../../qits-workspace-detail/feature-ideas/refresh-resilient-prompt-building.md)
  persists the composed draft per workspace. This idea **promotes it from convenience to
  necessity** and adds a requirement: the parts the server must *serve* (the serialized prompt
  markdown, the attached images) must be **server-readable** — structured fields/rows beside the
  opaque composition blob, not buried inside it.
- **Primary consumer / motivating feature**:
  [sketch-tab-and-image-prompt-attachments](../../qits-workspace-detail/feature-ideas/sketch-tab-and-image-prompt-attachments.md)
  — the PTY leg of image attachments is exactly this fetch; its feasibility update is the research
  record (including the rejected alternatives: WebDAV volume-plugin mount, `ContainerRuntime.writeFile`).
- **Rides the existing MCP context-server infrastructure** — the `repository` server and its scope
  dimensions ([coding-agent-harness](../features/2026-07-01_coding-agent-harness.md) /
  `AgentLaunchService.serversFor`, which already bakes `?workspaceId=` into every
  workspace-launched session's MCP URL), with the **telemetry tools as the direct precedent**
  ([observability](../../qits-observability/features/2026-07-04_observability.md)): `WorkspaceScope`
  + a fail-closed `ToolFilter` hiding workspace-bound tools from broader sessions.
- **Mid-session nudges ride the injection door** the interactive launch already uses
  ([agent-session-lineage](../features/2026-07-10_agent-session-lineage.md),
  `CommandRegistry.input`).
- **Write-back sibling (future)**: the same pattern reversed — a scoped MCP *write* tool (e.g.
  submit a refined feature-idea into [qits-feature-intake](../../qits-feature-intake/)) gives
  agent→qits structured returns with synchronous validation. Non-MCP container callers (CI action
  scripts) keep using plain HTTP over qits-net, where
  [qits-tokens](../../qits-tokens/epic.md) is the eventual authorization story.

## Design

### The tool: `taskPrompt` on the `repository` server

A new tool bean (e.g. `eu.wohlben.qits.domain.agent.mcp.TaskPromptMcpTools`, `service` module,
`@McpServer("repository")` like its siblings):

- **`taskPrompt`** (no arguments) — returns the workspace's current prompt as a `ToolResponse`
  whose content is `[TextContent(serialized markdown, prefixed with a version/updated-at line),
  TextContent("Sketch 1 (att_…):"), ImageContent(png), …]`. No arguments by design: the session's
  workspace scope *is* the key — the workspace id comes from `WorkspaceScope` (the MCP connection
  URL), never from a tool argument, so a session cannot read another workspace's prompt. Attachment
  ids appear in the prompt markdown as prose labels ("as shown in Sketch 2 (`att_…`)") and as the
  text block preceding each image, so the model can cross-reference; a per-id fetch tool is a
  deferred nice-to-have (re-fetching after context compaction), not part of the core.
- **`TaskPromptToolFilter`** mirrors `TelemetryToolFilter`: the tool is visible only to sessions
  narrowed all the way to a workspace, fails closed.
- **Allowlist**: `taskPrompt` joins `AgentLaunchService.READ_ONLY_REPOSITORY_TOOLS` so every scoped
  session may call it without a permission prompt (it is read-only). The TUI caveat from the spike:
  tools must be pre-allowed at launch or the interactive session interposes a visible permission
  dialog.
- **Empty case**: no draft → a text-only response saying so ("no task prompt is currently
  composed for this workspace") — never an error; the agent may legitimately be launched before
  composition.

### What it reads

The persisted prompt draft (refresh-resilient-prompt-building), with the consequence spelled out
there: the draft record splits into

- the **opaque composition blob** (picks, canvas autosave, chat-input draft — client-owned, server
  never interprets it),
- the **serialized prompt markdown** (produced by the client's existing launch-time serializer,
  autosaved beside the blob) — what `taskPrompt`'s text block returns,
- **structured attachment rows** (image bytes + mime + label per row, referenced from the blob by
  id) — what the image blocks are built from. Structured rows also keep multi-MB base64 out of the
  JSON blob and let the server enforce the per-image cap and magic-byte sniff at upload time.

### Bootstrap turns, per launch shape

| Shape | Bootstrap delivery |
|---|---|
| Interactive PTY (Agents tab) | argv prompt at launch; `CommandRegistry.input` keystroke injection mid-session |
| Chat (stream-json) | `ChatSession.sendUser` text turn |
| Autonomous (`claude -p`) | argv prompt |

Mid-session prompt refinement is an explicit user action ("hand to agent" / "update the agent"),
not an autosave side effect: composing autosaves continuously, but only the button injects the
nudge ("the task prompt was updated — fetch it again with `taskPrompt`"). The tool always serves
the *current* draft; the version line in the response tells the model (and the transcript) which
state it saw.

### Failure honesty

Delivery now depends on the model making the call — first-turn reliable for a direct instruction
(spike), and *verifiable*: qits knows a prompt is pending and whether `taskPrompt` was called in
the session; if not, the UI can show a warning chip instead of silently proceeding. A pushed
prompt could fail silently in more ways than this.

## Open questions

- **Live draft vs snapshot-on-send**: serving the live draft admits a benign race (user keeps
  typing between "hand to agent" and the model's fetch — the model sees the newer text). Lean:
  live draft + version line; introduce a sent-snapshot row only if the race bites in practice.
- **Does chat keep inline image blocks?** The chat transport can carry them natively (proven by the
  2026-07-20 spike). With `taskPrompt` universal, inline blocks become an optimization (one fewer
  round-trip), not a second required pipeline. Lean: ship fetch-only first; add inline only if chat
  latency grates.
- **Mixed-content codification**: the spike returned a lone image block; a mixed
  `[text, image, …]` result is how Playwright-MCP screenshot tools respond and is spec-plain, but
  the extended IT should prove it with the nonce as well (both nonce-in-text and nonce-in-image
  read back from one result).
- **Transcript UX**: the TUI transcript shows the bootstrap plus a collapsed tool result rather
  than the prompt prose. Acceptable (the prose lives in the adjacent tab); revisit only if users
  ask "what did the agent actually get" — the version line + draft history would answer it.

## Non-goals

- **No new MCP server** — one tool on the existing `repository` server, behind the existing scope
  dimensions. The discovery catalogue (`ContextServerRegistry`) description gains a sentence.
- **No prompt *push* removal for existing flows until this lands** — chat's current text push
  keeps working; the bootstrap rewrite happens per launch shape as the consumer features adopt it.
- **No write-back tools here** — same pattern, separate idea (feature-intake refinement submit).
- **No serving to non-MCP callers** — scripts use HTTP over qits-net (see qits-tokens).

## Testing sketch

- Tool unit tests (quarkus-mcp-server-test): scoped session gets markdown + labeled image blocks
  in order; version line present; empty-draft text response; oversized/absent attachment rows
  degrade to a text note per missing image rather than failing the whole call.
- Filter test: tool hidden without workspace narrowing (mirrors `TelemetryToolFilter` tests),
  fail-closed on scope-read errors.
- Scope fencing: session scoped to workspace A never sees B's prompt (scope from URL, not
  arguments — assert there *is* no argument).
- `AgentLaunchService` test: `taskPrompt` present in the read-only allowlist of every scope shape.
- Extended IT against the **real Java `taskPrompt` tool** (the docker-driven nonce approach the
  2026-07-20 spike used, now aimed at the real tool over the `repository` server's scoped HTTP
  endpoint): mixed text+image result — model reads back a text nonce *and* the in-image nonce from
  one real `taskPrompt` call; interactive-TUI variant via a pty (tmux) proving the PTY leg
  end-to-end. This is the only committed test of the mechanism — the spike left none behind.
