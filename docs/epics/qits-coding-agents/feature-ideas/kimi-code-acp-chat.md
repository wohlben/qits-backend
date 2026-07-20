# Kimi Code native chat over ACP

## Introduction

The [kimi-code-harness](kimi-code-harness.md) feature adds Kimi Code as a second coding-agent
harness for its interactive TUI and autonomous `-p` launch shapes, but deliberately leaves out the
**native in-UI chat**: unlike Claude Code, the kimi CLI has **no stdin stream-json chat mode**. Its
bidirectional programmatic protocol is **ACP (Agent Client Protocol)** — JSON-RPC over stdio,
driven via `kimi acp`. This feature completes full parity by adding that chat transport, normalized
into the same event envelope the frontend already renders, so the Chat tab works identically for
both harnesses.

Agent selection stays a **global config property** (`qits.agent.type=claude|kimi`, default
`claude`) established by the harness feature; this feature only adds the `chat()` render + the ACP
driver behind it.

Related / dependent plans:

- **Depends on [kimi-code-harness](kimi-code-harness.md)** (hard prerequisite): the `AgentType.KIMI`
  harness, the `CodingAgentFactory` switch arm, the unpinned session-identity model, the
  `wire.jsonl` transcript import, and the shared-volume auth all come from there. This feature adds
  only the chat leg.
- Extends [stream-json-chat](../features/2026-07-01_stream-json-chat.md) with a second chat
  transport: kimi's bidirectional protocol is ACP, not stream-json.
- Reuses the transcript import of [chat-persistence-on-transcript](../features/2026-07-10_chat-persistence-on-transcript.md)
  (`AgentTranscriptService` / `AgentTranscriptTailService`) against kimi's `wire.jsonl` layout — the
  re-attach uuid-minting contract below is the seam that ties the ACP live stream to that import.
- Builds on [persistent-chat-sessions](../features/2026-07-04_persistent-chat-sessions.md): the
  `ChatSession` registry/ring/re-attach model is preserved; only the transport and envelope source
  change.

## Kimi ACP capability map (verified)

Kimi's ACP adapter is unusually complete (verified against the
[kimi acp reference](https://www.kimi.com/code/docs/en/kimi-code-cli/reference/kimi-acp.html)):

- **`kimi acp`** speaks JSON-RPC over stdio: `initialize`, `session/new`, `session/prompt`,
  `session/update` notifications, `session/cancel`, and first-class `session/request_permission`
  (which Claude's raw CLI notably lacks — the future in-UI approval path).
- `loadSession: true` — resume **with** history replay via `session/load`; `session/resume`
  resumes **without** replay; `session/list` enumerates sessions.
- Image prompt blocks: `promptCapabilities.image: true` — the PTY's image-attachment gap simply
  doesn't exist on this transport.
- MCP over the protocol: `mcpCapabilities.http`/`.sse = true` — the adapter forwards
  client-supplied `mcpServers` on `session/new` **and** `session/load`.

## Proposed design

### 1. `chat()` → `exec kimi acp`

`KimiCodeAgent.chat()` (the one method the harness feature left unimplemented) renders
`exec kimi acp`. The launch is a long-lived managed process over plain pipes, exactly as Claude's
stream-json chat is — but the bytes on those pipes are JSON-RPC, not stream-json, so an in-JVM ACP
client sits between the pipe and the `ChatSession` ring (see §2).

Until this feature lands, a kimi `chat()` render throws and `AgentLaunchService.launchChat` rejects
kimi with a clear 400 (the harness feature ships that guard).

### 2. Chat over ACP

`ChatSession`'s model (registry-tracked, ringed, re-attachable, exit-latched NDJSON session) stays;
the transport and envelope get a kimi sibling: an **ACP client** driving `kimi acp` over plain
pipes — `initialize` → `session/new` (or `session/load`/`session/resume` for a resumed chat),
`session/prompt` per user turn, `session/cancel` for per-turn stop, and `session/update`
notifications out. The adapter **normalizes ACP updates into the event envelope the frontend
already renders**, so `chat-stream.ts` and the whole replay/stitch machinery stay untouched — the
same choice as the synthetic user echo today: one unified stream, one renderer. Permission handling
matches today's posture (auto-approved, yolo-equivalent); `session/request_permission` is the named
path to future in-UI approval — a capability Claude's raw CLI does not offer.

**The normalization contract has one sharp edge: the re-attach seam.** `ChatSession.attach`
stitches the durable transcript head to the live ring at the first ring line whose `uuid` the
transcript already contains — Claude stdout events and transcript lines share uuids natively, so
every event replays exactly once. ACP updates and `wire.jsonl` lines have no such shared id, so
the normalizer must **mint a stable uuid per normalized event** (derived deterministically from
ACP tool-call ids / notification sequence) and the transcript importer must mint the *same* uuids
for the same events — otherwise every kimi re-attach degrades to the lossy no-shared-uuid path
(best-effort de-dup, possible double-render).

> The transcript importer whose minted uuids must match lives in
> [kimi-code-harness](kimi-code-harness.md) §"Transcript import" (the `wire.jsonl` reader). This
> feature owns the *other half* of that contract — the live ACP normalizer — and the two must mint
> identical uuids for the same events. Ship the shared minting rule as one utility consumed by both.

### 3. MCP over ACP

The scoped MCP configuration is **per launch, not per workspace** (the same constraint the harness
feature's file-based delivery works around). Chat, however, has a protocol-native, per-session
channel that the file-based modes lack: kimi's ACP adapter forwards client-supplied `mcpServers` on
`session/new` **and** `session/load` (verified in the
[kimi acp reference](https://www.kimi.com/code/docs/en/kimi-code-cli/reference/kimi-acp.html):
`mcpCapabilities.http`/`.sse = true`).

**Chat is protocol-native, no file.** The ACP client passes the scoped servers — same URLs from
`serversFor`, same read-only narrowing — as `session/new` params. Per-session by construction, zero
on-disk state, nothing to race, and resumed chats re-supply their scope on `session/load`. The
allowlist rides the same `enabledTools` field in the `session/new` params (per-server, bare tool
names — the same prefix-stripping the harness feature's renderer already applies to the file-based
`mcp.json`).

Because chat needs no `mcp.json`, the kimi chat launch does **not** use the harness feature's
per-launch `KIMI_CODE_HOME` mktemp symlink farm — it points at the real volume home directly (the
ACP session carries the MCP scope, and credentials/sessions/hook config are already on the volume).

## Not built (candidate follow-ups)

- **In-UI tool-permission approval** — via ACP `session/request_permission`; valuable for *both*
  harnesses, deliberately out here (today's posture is auto-approve everywhere).
- Token/cost display, partial-message streaming — same status as for Claude.

## Open verifications (spikes before/during implementation)

- ~~Does kimi's ACP server support `session/load`?~~ **Confirmed** by the
  [kimi acp reference](https://www.kimi.com/code/docs/en/kimi-code-cli/reference/kimi-acp.html):
  `loadSession: true` (with history replay), `session/resume` (without), `mcpServers` accepted on
  both `session/new` and `session/load`, image prompt blocks, `session/request_permission`.
- Does the `SessionStart` hook fire for ACP launches, not only the TUI? (Determines whether an ACP
  chat can rely on the hook for identity or must read the session id from the `session/new` result.)
- How do ACP-supplied `mcpServers` interact with file-configured ones (union, or one shadows the
  other) — relevant only if the volume home ever carries a stray user-level `mcp.json` next to an
  ACP chat.

## Testing / verification

- ACP adapter tests against a fake ACP peer (recorded JSON-RPC exchanges): `session/new` carries
  the scoped `mcpServers` (and `session/load` re-supplies them on resume), prompt in, normalized
  events out, re-attach replay, exit handling.
- Re-attach contract tests: the live ACP normalizer and the `wire.jsonl` importer mint identical
  uuids for the same events, so `ChatSession.attach` stitches losslessly (no double-render).
- Extended (real-docker) IT: kimi chat in a workspace container, session id reported, transcript
  imported.
- Frontend: unchanged — covered by the normalization contract tests.
