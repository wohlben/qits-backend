# Chat persistence on the transcript channel: one durable record per agent session

## Introduction

Since [agent-session-lineage](../features/2026-07-10_agent-session-lineage.md) landed, a `CHAT` command's conversation is
persisted **twice**: the intercepted stream-json stdout lines that `ChatSession.emitLine` writes
to `command_log_line` on `LogChannel.OUTPUT` (today's mechanism, from
[stream-json-chat](../features/2026-07-01_stream-json-chat.md) /
[persistent-chat-sessions](../features/2026-07-04_persistent-chat-sessions.md)), and the imported
session JSONL on `LogChannel.TRANSCRIPT`. The transcript copy is the richer one — it is the
harness's own persistence (survives a qits crash mid-run, includes what interception missed, and
carries subagent sidechains the stdout stream never shows). This idea converges on it: **the
`TRANSCRIPT` channel becomes the single durable record for agent commands**, and stdout
interception is demoted to what it already is at heart — the live transport.

Related/dependent plans:

- **Hard dependency on [agent-session-lineage](../features/2026-07-10_agent-session-lineage.md)**
  — needs the pinned session IDs, `AgentTranscriptService`, and the `TRANSCRIPT` channel (all
  landed). NOTE: the lineage feature shipped *without* the live file-watch tail (post-exit sweep
  only), so making `TRANSCRIPT` the single durable record for a **running** chat's replay-on-
  reattach needs that tail (or an equivalent live import) built here first. Do not pick this up
  until the transcript import has proven itself in real use.
- **Amends [stream-json-chat](../features/2026-07-01_stream-json-chat.md) /
  [persistent-chat-sessions](../features/2026-07-04_persistent-chat-sessions.md)** — the
  replay/persistence contract changes; both docs' persistence sections get pointers.
- **Frontend folding stays shared** — `linesToItems()` in `pattern/command/chat-stream.ts`
  already learns transcript-line tolerance in the lineage feature; this idea makes that the
  primary shape it folds.

## What we'll do

- **Stop persisting chat stdout.** `ChatSession.emitLine` keeps the ring buffer (256 KB) and the
  WebSocket broadcast — live viewers notice nothing — but no longer writes `OUTPUT` rows for
  `CHAT` commands. The durable record is the transcript import (live tail during the run,
  idempotent sweep on exit), which the lineage feature already runs for every agent command.
- **Replay reads `TRANSCRIPT`.** The finished-chat replay (`/api/commands/{id}/log`) and the
  socket attach's persisted-head serve transcript lines for agent commands. For live re-attach
  mid-run, the head comes from the already-imported transcript rows and the tail from the ring —
  the same lossless-attach contract as today, different backing channel.
- **Fallback for historic commands.** Commands from before the cut-over have only `OUTPUT` rows;
  the replay path serves `TRANSCRIPT` when present, else falls back to `OUTPUT`. No data
  migration — old rows stay as they are.
- **User-turn echo stays.** `ChatSession.sendUser`'s synthetic user-line echo remains for the
  live stream; the transcript contains the real user turns for the durable record, so nothing is
  double-persisted.

## Open questions

- **Transcript lag at exit.** The harness flushes its JSONL asynchronously; the exit sweep must
  tolerate a short settle (retry-with-backoff before declaring the transcript shorter than the
  ring suggests).
- **Non-transcript stdout.** Rate-limit notices and hook events appear on stdout but not (all) in
  the transcript. Today's UI drops them at fold time anyway; confirm nothing the UI *keeps* is
  transcript-absent before deleting the `OUTPUT` write.

## Testing sketch

- **`ChatSessionTest` additions**: `CHAT` commands write no `OUTPUT` rows; ring + broadcast
  behavior unchanged; re-attach mid-run replays transcript head + ring tail without loss or
  duplication.
- **Replay**: finished agent command serves `TRANSCRIPT`; a pre-cut-over fixture command with
  only `OUTPUT` rows still replays (fallback); mixed case prefers `TRANSCRIPT`.
- **Frontend**: `command-chat.component` renders a resumed/finished chat identically from
  transcript-shaped lines (fixture comparison against the current stdout-shaped fixture).
