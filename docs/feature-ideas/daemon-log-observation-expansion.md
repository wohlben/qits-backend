# Daemon log observation expanded: sources, durable events, correlation

## Introduction

The [daemons feature](../features/2026-07-04_daemons.md) observes exactly one stream: the
process's merged PTY output, fanned out to observer sinks by the registry session. That covers
dev servers that log to stdout — and misses everything else: daemons that write through a file
appender (logback/log4j), servers with split logs (`access.log` + `error.log`), and tools that
keep stdout quiet while the interesting failures land in a file. This idea expands daemon log
observation along three axes that reinforce each other:

1. **Log sources** — where observed lines come from: the process output (today's behavior,
   stays the default) *or tailed files* in the worktree.
2. **Durable classified events** — observer findings and state transitions survive the JVM
   (today: a 500-entry in-memory ring).
3. **Correlation** — events anchor to their exact place in their source, per-line severity is
   stored where lines are persisted, and one worktree timeline lines up events across daemons
   and sources.

Related/dependent plans:

- Builds directly on the [daemons feature](../features/2026-07-04_daemons.md): the observer
  pipeline (`LineFramingSink` framing → PATTERN/LOG_LEVEL observers → `LogClassifier` →
  `DaemonEventDto`) is reused unchanged — sources only add new producers in front of it. No
  outbound API calls; `LogClassifier` stays the local-classification seam.
- Raw process output persistence rides the
  [command audit logs](../features/2026-06-30_command-audit-logs.md) (`command_log_line`);
  correlation for that source is expressed as command id + `seq` references, not copied text.
- The worktree daemons panel (events feed) and the agent spool
  ([stream-json chat](../features/2026-07-01_stream-json-chat.md) injection) become readers of
  the durable store instead of the in-memory ring.

## New base concept: log source

A **log source** is where a daemon's observable lines come from. Every daemon has the implicit
`PROCESS_OUTPUT` source (the PTY stream, exactly today's pipeline); a definition may declare
additional `FILE` sources:

- `LogSource` embeddable on the daemon definition (same element-collection split as observers):
  `kind` (`PROCESS_OUTPUT` is implicit and not stored; stored rows are `FILE`), `path`
  (worktree-relative, slug-safe validated against traversal — same rule as the file browser),
  optional `label` for display.
- **Runtime**: when an instance starts, the supervisor starts one `FileTailSource` per FILE
  source next to the observer sinks; they stop when the instance settles (STOPPED/CRASHED).
  Tail semantics are `tail -F`: start at end-of-file (history is not replayed as events), poll
  for growth, reopen on rotation/truncation (size shrink or recreated file). A missing file is
  not an error — it's watched until it appears (the daemon usually creates it).
- **Fan-in**: a tail feeds the daemon's observers through the same line-framing layer as the
  PTY stream, so PATTERN and LOG_LEVEL behave identically regardless of source. Findings and
  the events they produce gain a `source` field (`output` or the file path) so the feed, the
  agent message prefix, and correlation all say where the evidence came from.
- **Observer targeting**: v1 keeps it simple — every observer watches every source of its
  daemon. A per-observer source selector is an easy later refinement if split logs make
  severity rules diverge (e.g. PATTERN on `error.log` only).
- The ready pattern keeps matching on `PROCESS_OUTPUT` only — readiness is a property of the
  process starting up, and matching it against a pre-existing file tail would be nonsense.

Deliberately not in v1 (but the shape allows it): sources not owned by a daemon at all —
observing a log file with no supervised process behind it. The tail/observer machinery is
daemon-agnostic on purpose; standalone sources mainly need an owner for lifecycle and scoping,
which is its own design question.

## Durable classified events

- A `daemon_event` table (new entity in `domain.daemon`) written by `DaemonEventService.publish`
  alongside the in-memory ring — repo/worktree snapshot columns, daemon id + name, kind,
  severity, status, summary, excerpt, `command_id` FK, **source**, the anchor below, timestamp.
  The ring stays as the hot cache; the feed endpoint reads DB with the ring as its head (same
  layering as the chat transcript restore).
- JVM restart keeps the history: last night's crash, what the classifier saw, and what was sent
  to the agent remain inspectable.

## Correlation

- **Anchors are source-qualified.** Observers know the batch they classified; the event carries
  where it sits in its source:
  - `PROCESS_OUTPUT` → the `command_log_line` seq range (`log_seq_from`/`log_seq_to`) — the
    lines are already persisted there.
  - `FILE` → the path plus the tail's line-offset range since the last rotation (plus a
    rotation epoch/timestamp so a rolled file doesn't mislead). The file itself is the durable
    store — tailed lines are **not** copied into the database; the excerpt on the event is the
    display copy.
- **Per-line severity where lines are persisted**: nullable `severity` column on
  `command_log_line`, stamped at capture time for DAEMON commands by running
  `LogLevelClassifier` per line in the async batch persister (local, cheap, off the hot path).
  Enables `?severity=ERROR` filters on the log endpoint without re-parsing.
- **Retrieval**: `GET /api/daemon-events?repoId=&worktreeId=&severity=&since=&source=`
  (durable, paginated, newest first) replaces the in-memory worktree endpoint; the command log
  endpoint gains `?severity=`.
- **UI**: the events feed gets "open in source" — the command log view scrolled to the anchored
  seq for output events; a simple file-at-line viewer (the worktree file browser already
  renders files) for file events. The worktree panel can show one merged severity timeline
  across its daemons and their sources.

## Explicitly out of scope

- Model-backed classification (unchanged: no outbound API calls from log observation).
- Copying tailed file content into the database, and any log retention/cleanup policy.
- Structured-log parsing (JSON logs with native level fields) — a natural `LogClassifier`
  refinement once file sources exist, but the token-based classifier already covers the common
  rendered formats.
- Standalone (daemon-less) sources, glob paths, and per-observer source selectors — noted
  above as follow-ups the shape supports.

## Testing sketch

- File tail: daemon whose script writes to `app.log` only — LOG_LEVEL observer fires on an
  ERROR line in the file; event carries `source=app.log` and the line-offset anchor; rotation
  (truncate + rewrite) keeps tailing without duplicate events; a source file that appears late
  is picked up.
- Event persistence round-trip: a supervisor transition lands as a `daemon_event` row; restart
  (reconciliation) keeps it; the feed endpoint serves it with the ring gone.
- Line classification: a DAEMON command's persisted lines carry severity where the classifier
  fires and null elsewhere; `?severity=ERROR` returns exactly those.
- Anchoring: an output finding's event references the seq range of the batch that produced it;
  the excerpt equals the anchored lines' content.
