# Persistent chat sessions: full-transcript restore on reconnect

## Introduction

Reconnecting to a running `CHAT` command currently replays only the in-memory scrollback ring
(256 KB of recent JSONL in `ChatSession`). For long conversations that is a **subset**: the head
of the transcript is gone, and a page reload mid-session silently loses context the user can
still scroll to in a never-disconnected tab. This idea makes reconnect restore the **entire**
conversation — persisted head from the database, ring tail, then live — and hardens persistence
so the stored transcript really is the whole transcript (every stream-json event, un-truncated),
not a lossy approximation.

Related/dependent plans:

- Builds directly on the [stream-json chat](../features/2026-07-01_stream-json-chat.md): the
  unified line stream (Claude stdout events + synthetic user echoes) that is ringed, broadcast,
  and persisted per line is exactly what gets restored here — the invariant "live and replay
  render identically" is preserved and strengthened.
- Persistence rides the [command audit logs](../features/2026-06-30_command-audit-logs.md)
  pipeline (`CommandLogWriter` → batched `command_log_line` inserts, CLOB content); this idea
  removes the chat-side truncation that undermines it.
- The [worktree chat dialog](worktree-chat-dialog.md) idea depends on re-attach being lossless:
  its close/reopen cycle is a reconnect, so it inherits full restore for free once this lands.
- Complements [command restore navigation](../features/2026-06-30_command-restore-navigation.md)
  (finding your way back to a session) — this covers what you *see* once you're back.

## Current state (what already works, what doesn't)

Already true today:

- Every line of the unified stream is persisted to `command_log_line` on `LogChannel.OUTPUT`
  with a monotonic per-command `seq` (`ChatSession.emitLine` → `CommandLogService`, batched
  off the hot path). User turns are included via the synthetic `{"type":"user","text":…}` echo.
- Finished chats replay fully from the DB (`command-chat-log.component.ts` reads
  `/api/commands/{id}/log`).
- The chat process outlives any websocket: close only detaches (`ChatCommandSocket.onClose`).

The gaps this idea closes:

1. **Ring-only replay on re-attach.** `ChatSession.attach` replays only the ring
   (`RING_CAPACITY_BYTES = 256 * 1024`); anything evicted is invisible to a reconnecting
   client even though it sits in the DB.
2. **64 KB line truncation corrupts events.** `ChatSession.MAX_LOG_LINE_CHARS` blindly
   `substring`s persisted lines. A large event (big tool result, long assistant turn) becomes
   invalid JSON in the DB — the finished-chat replay drops or mangles that bubble, so the
   stored transcript is *not* the full transcript. The column is a CLOB; the cap predates the
   chat use-case and buys nothing here.
3. **(Accepted, documented)** The batch writer is best-effort: a hard crash can drop the last
   unflushed batch (≤ 500 ms / 256 lines). Fine for a prototype; noted so nobody mistakes it
   for a bug later.

## Behaviour

- Opening the chat websocket for a **running** command replays the conversation **from the
  first line**, in order, then streams live — indistinguishable from a tab that never
  disconnected. Page reload, browser restart, second device: same result.
- Replay of a **finished** chat (already DB-backed) now renders every event faithfully,
  including previously-truncated large ones.
- No wire-protocol change: the client still receives newline-delimited stream-json lines and
  splits/parses as today (`command-chat.component.ts` needs no changes).

## Design: server-side sequence-aware replay

Restore is assembled **server-side in `attach`**, not by the client merging `/log` + websocket.
Client-side merging was considered and rejected: raw lines carry no identity on the wire, so
deduplicating the seam between an HTTP-fetched head and the ring replay would mean fragile
content matching (and the async batch writer guarantees the two sources overlap or gap
non-deterministically). Server-side, the sequence numbers make the seam exact:

- The ring stores `(seq, line)` pairs instead of bare strings (the seq already exists —
  `logSeq` — it's just not retained today).
- `attach` becomes: read persisted lines for the command with `seq < firstRingSeq` from
  `command_log_line` (ordered by seq), write them to the sink, then replay the ring, then add
  the sink for live lines — all under the existing session lock so no live line interleaves
  mid-replay.
- `ChatSession` stays framework-free: it gets the persisted head via a small reader interface
  (the flip side of `CommandLogWriter`, e.g. `CommandLogReader.linesBefore(commandId, seq)`)
  implemented by `CommandLogService`.
- Seam caveat: lines newer than `firstRingSeq` may not be flushed yet — that's fine, the ring
  covers them. Lines *older* than `firstRingSeq` are flushed long before eviction in practice
  (flush every ≤ 500 ms vs. 256 KB of scrollback); the theoretical stall window is accepted
  prototype risk, same class as gap 3 above.

## Full-fidelity storage

- Drop `MAX_LOG_LINE_CHARS` truncation in `ChatSession` — persist the full line; the CLOB
  column absorbs it. (Leave `CommandSession`'s 16 KB terminal cap alone: raw PTY output is a
  different beast with different pathologies.)
- Keep a guard only against the truly pathological (say, > 8 MB single line): instead of
  corrupting the JSON, *replace* the line with a small synthetic, still-valid event such as
  `{"type":"oversized_event","original_bytes":N}` so replay renders an honest placeholder
  bubble rather than a parse error. The ring/broadcast path stays untouched — only what is
  persisted is substituted.

## Implementation sketch

1. `ChatSession`: ring of `(seq, line)`; remove truncation; oversized-event placeholder.
2. `CommandLogReader` interface in `command.control`, implemented on `CommandLogService`
   (a `findByCommandAndSeqLessThanOrderBySeq` on `CommandLogLineRepository`).
3. `CommandRegistry` threads the reader into `ChatSession` construction (alongside the writer).
4. `attach`: DB head → ring tail → subscribe, atomically.
5. Frontend: nothing.

## Tests

- Unit: `ChatSession` attach after ring eviction replays DB head + ring with no gap/overlap at
  the seam (fake reader/writer capturing seqs); oversized line persists as the placeholder
  event while the live broadcast keeps the original.
- Regression: a >64 KB event round-trips through persistence and parses as valid JSON in the
  `/log` replay (this is the bug fix for gap 2).
- Existing `running-chat.spec.ts` behaviour unchanged (wire protocol identical).

## Out of scope

- Resuming the *Claude process* itself after backend restart (the transcript survives; the
  live process does not — restore then shows a finished conversation, which is correct).
- WAL-grade durability for the last unflushed batch (gap 3 stays best-effort).
- Any pagination/lazy-loading of very long transcripts in the UI.
