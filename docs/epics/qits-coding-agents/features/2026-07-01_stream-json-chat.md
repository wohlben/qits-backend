# Native Claude chat via the stream-json protocol

## Introduction

Claude Code exposes a bidirectional programmatic protocol —
`claude --print --input-format stream-json --output-format stream-json --verbose` — where user turns
are fed as newline-delimited JSON on stdin and structured events (`system`/init, `assistant` messages
with content blocks, `tool_use`/`tool_result`, `result`) come back as JSON on stdout. qits uses it to
render a Claude conversation **natively in the UI** (chat bubbles, structured tool activity) instead
of a raw terminal. The MCP-scoped **"Configure … with Claude"** buttons now open this chat; the
interactive PTY path stays for terminal-native work.

Related plans:
- Builds on the [coding-agent-harness](2026-07-01_coding-agent-harness.md): the launch is rendered by
  the same `CodingAgent` builder (`chat()` mode → the stream-json flags).
- Extends the [command-registry](../../qits-workspace-commands/features/2026-06-30_command-registry.md): a chat is a registry-tracked,
  re-attachable `Command` — like a terminal, but driven over plain pipes and rendered as a conversation.

## What was built

**A chat is a first-class `Command`.** A `CommandKind {TERMINAL, CHAT}` discriminator
(`command/entity/CommandKind.java`, column added by `V13__command_kind.sql`) on `Command`/`CommandDto`
routes the command view; a chat is listed in Commands, re-attachable across navigation, terminable,
and its conversation is persisted for replay.

**Non-PTY session, mirroring the terminal's model.** `command/control/ChatSession` spawns Claude on
**plain pipes** (`ProcessBuilder("bash","-lc", …)` — not a PTY, which echoes input and corrupts the
line-delimited JSON). It is a separate `final` class that mirrors `CommandSession`'s model — the same
`CommandOutputSink`/`CommandLogWriter`/`CommandExitListener` contracts, a 256KB scrollback ring (for
re-attach), the sink fan-out, per-line persistence, and an exit latch — but is line-oriented
(`readLine()`) rather than byte-framed, so the working PTY `CommandSession` is **left untouched**.
`CommandRegistry` keeps chats in a second map (`spawnChat`, `chatSend`; attach/detach/terminate/isRunning
consult both maps). Everything the client renders flows through **one unified line stream** — each
event Claude emits plus a synthetic `{"type":"user","text":…}` echo per user turn — ringed, broadcast,
and persisted on `LogChannel.OUTPUT`, so **live and replay render identically**.

> **Persistence contract superseded** by
> [chat-persistence-on-transcript](2026-07-10_chat-persistence-on-transcript.md): the unified
> stream is now ring+broadcast only (failure `result` events excepted); the durable record is the
> imported agent transcript on `LogChannel.TRANSCRIPT`.

**Launch + transport.** `CommandService.launchChat(...)` (kind `CHAT`) →
`AgentLaunchService.launchChat(scope, …)` reuses the scope→MCP-server construction and renders with
`CodingAgentFactory.ofType(CLAUDE).mcpServer(…).skipPermissions().chat()`. `AgentController` (the
buttons' existing `…/agents` endpoint) returns a CHAT command, so the buttons were **unchanged**. A
new `ChatCommandSocket` at `/api/chat/commands/{id}` attaches a sink (ring replay + live) and forwards
`{"type":"user","text":…}` to the process stdin. Cross-origin handshakes are rejected by the global
`SameOriginUpgradeCheck` (CSWSH), which permits loopback origins for the dev-server proxy and rejects
look-alike hostnames without DNS.

**Frontend.** `pattern/command/command-chat.component.ts` (live, robust connect: queue-until-open +
auto-reconnect) and `command-chat-log.component.ts` (replay from the `/log` endpoint) share a
`chat-transcript` and the `linesToItems` parser, which categorizes events — user, assistant text,
**tool calls**, **tool results**, **thinking**, and **errors** — with a filter popover to hide
categories (nothing hidden by default). `command-terminal.page.ts` routes on `command.kind`.

## Permissions

The CLI's stream-json mode has no answerable permission prompt: with
`--dangerously-skip-permissions` tools auto-run, and without it a mutating tool is **auto-denied**
(it surfaces in the result's `permission_denials`, no `control_request` event to answer). Chats
therefore run **auto-approved** so the buttons can actually configure (create actions, workspaces,
etc.). In-UI Approve/Deny would require driving Claude's SDK control protocol (`canUseTool`), which the
raw CLI does not expose — a future enhancement. Because a chat spawns an autonomous session, a
networked deployment must add real authentication on the socket (qits has no auth layer today).

## Not built (candidate follow-ups)

- In-UI tool-permission approval (SDK control protocol).
- Token-level streaming (`--include-partial-messages`), cost/usage display, per-turn stop.
- Surfacing `permission_denials` when a restricted policy is used.

## Verification

`CodingAgentFactoryTest#chatRendersTheStreamJsonProtocol` covers the builder;
`CommandServiceTest#launchChatRecordsAChatCommandAndCapturesItsJsonLines` covers the CHAT command +
JSONL log capture. End-to-end (against `./mvnw -pl service quarkus:dev`): clicking **Configure actions
with Claude** opens a CHAT command with the actions MCP connected, Claude uses `mcp__actions__*` tools
(auto-approved) and streams the reply, the command appears in Commands, re-attaches on navigation, and
replays from its log when finished.
