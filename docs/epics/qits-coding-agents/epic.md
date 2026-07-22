# Epic: qits-coding-agents — the coding agent and its chat

## Introduction

The **coding-agent domain**: running a coding agent (today Claude Code) as a first-class
concept — a `CodingAgent` harness, the bidirectional **stream-json chat** protocol, durable
sessions, qits-owned session lineage (resume/fork), execution inside the workspace container,
and per-workspace LSP plugins. This epic owns the agent's *backend/domain*; the Chat and Agents
*tabs* that surface it are frontend, in
[qits-workspace-detail](../qits-workspace-detail/epic.md).

**Builds on [qits-workspaces](../qits-workspaces/epic.md)**:
the agent — the single biggest executor of arbitrary commands in qits — runs inside the
per-workspace container, so its sandboxing lands only once workspace containers exist.
Retroactive umbrella epic; future agent work lands here.

Related epics / cross-cutting concerns:

- **Runs on the command substrate** — a `CHAT` command is a `CommandSession` in
  [qits-workspace-commands](../qits-workspace-commands/epic.md); persistent/re-attachable chat
  reconnect rides that substrate.
- **Replaced the action-based launch** — the harness lifted agent launches out of the generic
  action model ([qits-feature-flows](../qits-feature-flows/epic.md)); MCP-scoped launches are no
  longer fake "global actions".
- **Consumes** [qits-observability](../qits-observability/epic.md): the agent reads telemetry
  through the MCP tools it carries.
- **Surfaced by** [qits-workspace-detail](../qits-workspace-detail/epic.md): the Chat tab
  (incl. chat-markdown-rendering) and the embedded Agents-tab session are the frontend of what
  this epic runs.

## Parts (implemented)

### The harness & chat protocol

- **[coding-agent-harness](features/2026-07-01_coding-agent-harness.md)** (07-01) — the
  foundation: a `CodingAgent` builder that all Claude launches go through (replacing the
  bolted-on `ActionVariant` model and hand-written launch scripts).
- **[stream-json-chat](features/2026-07-01_stream-json-chat.md)** (07-01) — native Claude chat
  over the `--input-format stream-json --output-format stream-json` bidirectional protocol.
- **[persistent-chat-sessions](features/2026-07-04_persistent-chat-sessions.md)** (07-04) —
  reconnect restores the **entire** transcript, not just the in-memory scrollback ring.

### Container execution, lineage & persistence

- **[container-agent-sessions](features/2026-07-04_container-agent-sessions.md)** (07-04) — the
  agent runs inside the workspace container (`docker exec`), completing the sandbox payoff.
- **[agent-session-lineage](features/2026-07-10_agent-session-lineage.md)** (07-10) — pinned
  session IDs, transcript extraction, resume/fork, the interactive launch — the session becomes
  a first-class, qits-owned entity.
- **[chat-persistence-on-transcript](features/2026-07-10_chat-persistence-on-transcript.md)**
  (07-10) — one durable record per agent session on the transcript channel (de-duplicating the
  double-persist the lineage change exposed).
- **[kimi-code-harness](features/2026-07-20_kimi-code-harness.md)** (07-20) — a second, peer
  coding-agent harness for the interactive TUI + autonomous `-p` shapes: `AgentType.KIMI` behind
  the global `qits.agent.type` switch, with unpinned hook-reported session identity, per-launch
  `mcp.json` delivery via a mktemp `KIMI_CODE_HOME` symlink farm, device-code login on the shared
  volume, and `wire.jsonl` transcript import. Native chat landed separately in
  [kimi-code-acp-chat](features/2026-07-22_kimi-code-acp-chat.md).
- **[kimi-code-acp-chat](features/2026-07-22_kimi-code-acp-chat.md)** (07-22) — the native in-UI
  chat for kimi over **ACP** (`kimi acp`, JSON-RPC over stdio): a pluggable `ChatProtocol` seam in
  the command domain, an in-JVM ACP client normalizing `session/update` notifications into the
  existing chat envelope (shared with the `wire.jsonl` importer via one normalizer + uuid-minting
  rule), scoped `mcpServers` carried protocol-native on `session/new`, auto-approved permissions,
  and the session id learned from `session/new` — completing full chat parity for both harnesses.

### Agent capability

- **[agent-lsp-plugins](features/2026-07-07_agent-lsp-plugins.md)** (07-07) — install Claude
  Code LSP plugins (jdtls, typescript-lsp) per workspace to sharpen the agent's code navigation
  (surfaced via the workspace-detail Plugins/Agents tab).

## Parts (ideas)

- **[mcp-task-prompt-delivery](feature-ideas/mcp-task-prompt-delivery.md)** — invert prompt
  delivery: the composed prompt (text + image attachments) becomes DB-canonical and the agent
  *fetches* it via a new workspace-scoped `taskPrompt` MCP tool on the `repository` server; the
  pushed prompt shrinks to a one-sentence bootstrap turn. Launch-shape-universal (the only viable
  image path for the interactive PTY — spike-proven 2026-07-20). Depends on the workspace-detail
  [refresh-resilient-prompt-building](../qits-workspace-detail/feature-ideas/refresh-resilient-prompt-building.md)
  persistence, which it promotes to a necessity.

## Done when

Rolling: current when its `feature-ideas/` is empty and every coding-agent feature since this
epic's creation has landed here.

## Status

| Part | Status |
|---|---|
| [coding-agent-harness](features/2026-07-01_coding-agent-harness.md) | implemented |
| [stream-json-chat](features/2026-07-01_stream-json-chat.md) | implemented |
| [persistent-chat-sessions](features/2026-07-04_persistent-chat-sessions.md) | implemented |
| [container-agent-sessions](features/2026-07-04_container-agent-sessions.md) | implemented |
| [agent-session-lineage](features/2026-07-10_agent-session-lineage.md) | implemented |
| [chat-persistence-on-transcript](features/2026-07-10_chat-persistence-on-transcript.md) | implemented |
| [agent-lsp-plugins](features/2026-07-07_agent-lsp-plugins.md) | implemented |
| [kimi-code-harness](features/2026-07-20_kimi-code-harness.md) | implemented |
| [kimi-code-acp-chat](features/2026-07-22_kimi-code-acp-chat.md) | implemented |
| [mcp-task-prompt-delivery](feature-ideas/mcp-task-prompt-delivery.md) | idea |
