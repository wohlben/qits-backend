# Chat persistence on the transcript channel: one durable record per agent session

## Introduction

Since [agent-session-lineage](2026-07-10_agent-session-lineage.md) landed, a `CHAT` command's
conversation was persisted **twice**: the intercepted stream-json stdout lines that
`ChatSession.emitLine` wrote to `command_log_line` on `LogChannel.OUTPUT` (from
[stream-json-chat](2026-07-01_stream-json-chat.md) /
[persistent-chat-sessions](2026-07-04_persistent-chat-sessions.md)), and the imported session
JSONL on `LogChannel.TRANSCRIPT`. The transcript copy is the richer one — it is the harness's own
persistence (survives a qits crash mid-run, includes what interception missed, and carries
subagent sidechains the stdout stream never shows). This feature converges on it: **the
`TRANSCRIPT` channel is the single durable record for chats**, and stdout interception is demoted
to what it already was at heart — the live transport (ring + WebSocket broadcast).

Related/dependent plans:

- **Builds on [agent-session-lineage](2026-07-10_agent-session-lineage.md)** — the pinned session
  IDs, `AgentTranscriptService`, and the `TRANSCRIPT` channel. The lineage feature shipped
  *without* a live transcript import (post-exit sweep only); the live tail built here closes that
  gap for chats.
- **Amends [stream-json-chat](2026-07-01_stream-json-chat.md) /
  [persistent-chat-sessions](2026-07-04_persistent-chat-sessions.md)** — the replay/persistence
  contract changed; both docs' persistence sections point here.
- **Frontend folding stays shared** — `linesToItems()` in `pattern/command/chat-stream.ts`
  already learned transcript-line tolerance in the lineage feature; this feature makes that the
  primary shape it folds (and fixes the array-content user-turn gap, below).

## What was built

- **Chat stdout is no longer persisted wholesale.** `ChatSession.emitLine` keeps the ring buffer
  (256 KB) and the WebSocket broadcast — live viewers notice nothing — but writes `OUTPUT` rows
  only for **failure `result` events** (`is_error` / `subtype: "error"`, the `ErrorResultLines`
  predicate shared with replay). Verified against the real CLI (2.1.204): the failure `result` is
  the one shape the UI renders that the harness transcript does not contain, so retiring its
  persistence would lose error bubbles from replay. Everything else is durably covered by the
  transcript import.
- **A live transcript tail** (`AgentTranscriptTailService`, `domain.agent.control`): while a chat
  runs, the main-session JSONL is polled off the shared claude volume
  (`qits.agent.transcript-tail-poll-ms`, default 500 ms — the daemon-file-tail house style;
  backend file polling, *not* a webui poll) and each new complete line is appended to the
  `TRANSCRIPT` channel, sequences continuing from `TRANSCRIPT_SEQ_BASE`. Lines are imported raw —
  no ANSI stripping and **no length cap** (one line is one JSON event; the column is a CLOB) —
  with a partial line buffered across polls. The tail resolves the file exactly like the sweep
  (hook-reported path → harness convention → filename lookup) and imports **from byte 0**, so a
  resumed session's prior history is part of the durable head. Main session only; sidechains and
  stats remain exit-sweep territory.
- **Mid-run re-attach replays the transcript head + ring tail, stitched by `uuid`.** Verified
  against the real CLI: every stdout stream-json event carries a top-level `uuid` that **matches
  its transcript line's `uuid`**. `ChatSession.attach` reads the imported `TRANSCRIPT` rows,
  scans the ring for the first line whose `uuid` the transcript contains, and serves the
  transcript strictly before that line plus the ring from it onward — every event exactly once,
  under the session lock. Persisted error results below the seam's (live) sequence merge into the
  head by timestamp. With no shared uuid (tail lag, or an echo-only ring) both sides are served in
  full, skipping synthetic user echoes whose text a served transcript user turn already covers.
  With no transcript rows at all, it is the old ring-only replay (plus any evicted error rows).
- **The exit sweep settles before it reconciles.** The chat exit chain is: stop-and-drain the
  tail (no tail write can race the sweep), then `AgentTranscriptService.onChatExit`, which waits
  for the JSONL to reach the tail's imported-line high-water mark (4 × 250 ms, bounded — the
  chain runs on the chat reader thread inside `terminate()`'s 2 s latch window) before running
  the usual idempotent delete-and-reimport sweep. Sweeping before the harness's async flush
  caught up would replace the tail's good rows with fewer.
- **Finished replay serves the durable conversation with fallbacks.** `GET
  /api/commands/{id}/log?channel=TRANSCRIPT` for a `CHAT` command returns the transcript rows
  merged with the command's **error-result** `OUTPUT` rows (by timestamp;
  `CommandLogService.chatLog`). The error filter — not "all OUTPUT rows" — is what keeps
  **lineage-era** chats correct: they persisted their *full* stream on `OUTPUT` alongside a full
  transcript, and merging wholesale would double-render the conversation. A chat with **no**
  transcript rows (pre-lineage) falls back to its full `OUTPUT` stream. Scoped to `CHAT`: a
  terminal agent's transcript view never falls back to raw PTY bytes. No data migration — old
  rows stay as they are.
- **User-turn echo stays.** `ChatSession.sendUser`'s synthetic user-line echo remains for the
  live stream (ring + broadcast only, no longer persisted); the transcript carries the real user
  turns for the durable record, so nothing is double-persisted.
- **Frontend**: `command-chat-log.component` pins `LogChannel.Transcript` (the server owns the
  fallback), which also means sidechain groups now render inside finished-chat replay via the
  existing `foldSidechains`. `linesToItems()` folds real user turns whose `message.content` is an
  **array of text blocks** (both shapes occur in real transcripts; without this, such turns
  rendered zero user bubbles) and drops `isMeta` user lines (caveat preambles, injected context).
- **`queued_command` attachments are user turns** (found in end-to-end verification): a user
  message sent while the agent is mid-turn persists in the transcript as
  `{"type":"attachment","attachment":{"type":"queued_command","prompt":[…]}}`, never as a `user`
  line. `linesToItems()` folds these into user bubbles, and `ChatSession`'s no-seam echo guard
  counts their prompt text as covered.
- `CommandLogReader.linesBefore` (the old sequence-bounded any-channel head read) is gone,
  replaced by `transcriptLines` + `outputLinesBefore` (channel-aware).

## Accepted losses / caveats

- `session_closed` is a socket-side synthetic and was never persisted; unchanged.
- A mid-run re-attach drops pre-seam stdout-only lines (init/"session ready", thinking-budget,
  rate-limit notices) — observed in verification as the missing "session ready" line after a
  reload; the fold drops most of these anyway and the transcript has no counterpart.
- An error result may still sit in the async write batch at the moment of a re-attach (≤500 ms
  window) — the same best-effort class as the old `linesBefore` head.
- A qits crash mid-chat leaves the tail's `TRANSCRIPT` rows behind with no reconciling sweep —
  that *is* the durability win (the stdout copy died with qits before). A startup reconciliation
  sweep for `INTERRUPTED` agent commands is a possible backlog one-liner.
- The lineage doc's "if live transcript freshness is ever wanted, the follow-up is a socket, not
  polling" note referred to UI-facing freshness; the tail here is a backend file poll (the
  `FileTailSource`/daemon idiom), invisible to the browser.

## Testing

- `ChatSessionTest`: ordinary lines write no `OUTPUT` rows; failure results persist whole
  (>64 KB CLOB regression retained); attach seam cases — shared-uuid stitch, ring eviction,
  empty transcript, no-seam echo guard (string and array user shapes), pre-seam error merge.
- `AgentTranscriptTailServiceTest` (temp-dir config dir, polls driven synchronously): late file
  appearance, incremental append with continuous sequences, partial-line framing, resumed-file
  import from byte 0, >64 KB single-row import, stop-and-drain high-water, truncation re-seed.
- `AgentTranscriptServiceTest`: settle-then-sweep (late flush lands mid-settle), exhausted
  retries sweep anyway, `TRANSCRIPT` replay fallback to `OUTPUT`, lineage-era merge filters to
  error results, `TERMINAL` never falls back.
- `CommandServiceTest`: chat launch persists only error results end-to-end; large error results
  round-trip untruncated.
- Frontend: array-content user turns, `isMeta` drop, stitched mixed-stream fixture,
  `command-chat-log` pins the `Transcript` channel.
