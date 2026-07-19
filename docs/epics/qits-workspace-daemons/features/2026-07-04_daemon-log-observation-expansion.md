# Daemon log observation expanded: sources, durable events, correlation

## Introduction

The [daemons feature](2026-07-04_daemons.md) observed exactly one stream: the process's merged
PTY output. That covered dev servers that log to stdout — and missed daemons that write through a
file appender (logback/log4j), servers with split logs (`access.log` + `error.log`), and tools
that keep stdout quiet while the interesting failures land in a file. This feature expanded
daemon log observation along three axes that reinforce each other:

1. **Log sources** — observed lines come from the process output (still the implicit default)
   *or tailed files* in the workspace.
2. **Durable classified events** — observer findings and state transitions survive the JVM as
   `daemon_event` rows (previously a 500-entry in-memory ring).
3. **Correlation** — events anchor to their exact place in their source, per-line severity is
   stored where lines are persisted, and the feed lines up events across daemons and sources.

Related/dependent plans:

- Builds directly on the [daemons feature](2026-07-04_daemons.md): the observer pipeline
  (PATTERN/LOG_LEVEL observers → `LogClassifier` → `DaemonEventDto`) is reused; sources add new
  line producers in front of it. No outbound API calls; `LogClassifier` stays the
  local-classification seam.
- Raw process output persistence rides the
  [command audit logs](../../qits-workspace-commands/features/2026-06-30_command-audit-logs.md) (`command_log_line`); correlation for
  that source is expressed as `seq` references, not copied text.
- The workspace daemons panel (events feed) reads the durable store; the agent spool
  ([stream-json chat](../../qits-coding-agents/features/2026-07-01_stream-json-chat.md) injection) is unchanged except that
  messages now name the source file.

## What was built

### Log sources (`LogSource`, `FileTailSource`)

- `LogSource` embeddable (`path` workspace-relative + optional `label`) as an element collection
  on the daemon definition (`repository_daemon_source`; `V16__daemon_log_sources.sql` also
  created a `daemon_configuration_source` twin for the since-removed global scope — dropped by
  `V19`), editable in the REST/MCP inputs. Only FILE
  sources are stored — `PROCESS_OUTPUT` is implicit, so the embeddable has no kind column.
  Paths are validated lexically at definition time (no absolute paths, no `..`, not `.git`) and
  re-checked against the resolved workspace root when the tail starts — the same two-layer guard
  as the file browser.
- **Runtime** (`FileTailSource`): one tailer per FILE source, started at instance launch,
  polling (`qits.daemons.file-tail-poll-ms`, default 500 ms) on the supervisor's scheduler.
  `tail -F` semantics: a file that exists at start has its history counted but not replayed;
  growth is framed into lines at the byte level (multi-byte chars split across polls decode
  correctly); rotation is detected by file-key change, size shrink, or deletion-then-recreation
  and reopens from the top under a **new epoch**; a missing file is watched until it appears and
  — matching real `tail -F` — a file that appears *after* the tail started is read from its
  first line. Tails outlive restarts and close when the instance settles (STOPPED/CRASHED),
  with a final drain so lines written just before an exit still classify.
- **Fan-in**: observers now consume `ObservedLine(source, position, sourceEpoch, content)`
  instead of raw PTY chunks. One observer instance per (observer definition, source) — every
  observer watches every source, and a LOG_LEVEL batch is always a contiguous range of a single
  source, which is what makes anchors coherent. The ready pattern keeps matching process output
  only.
- **Process output positions are `command_log_line` sequences.** `CommandService.launchDaemon`
  gained a `CommandLogWriter` tap teed onto the session's log writer: the daemon's
  `ProcessOutputTap` receives every captured line with the exact `seq` the audit log persists
  (OUTPUT channel only, ANSI-stripped, blanks skipped but their seq consumed). Observer anchors
  therefore resolve directly against persisted rows.

### Durable classified events (`daemon_event`, `V17__daemon_event.sql`)

- `DaemonEventService.publish` persists every event synchronously (`DaemonEventPersister`,
  request-context-activated like the log batch persister) before notifying the agent. **The
  in-memory ring was removed rather than layered under the endpoint** — with the row committed
  before publish returns, the DB simply is the feed; a ring-as-head cache would have been dead
  code. Persistence failures are logged and don't block agent notification.
- Snapshot columns throughout; `command_id` is a plain column (not an FK) so deleting a command
  keeps its events inspectable. JVM restarts keep the history.

### Correlation

- **Anchors are source-qualified** on `ObserverFinding`/`DaemonEventDto`/`daemon_event`:
  `source` (`output` or the file path), `anchorFrom`/`anchorTo`, and `sourceEpoch`.
  - `PROCESS_OUTPUT` → the `command_log_line` seq range; the excerpt equals the anchored lines'
    content.
  - `FILE` → 1-based line numbers in the current file since the rotation marked by
    `sourceEpoch`. The file itself is the durable store — tailed lines are **not** copied into
    the database; the excerpt on the event is the display copy.
  - Plain status transitions carry null anchors.
- **Per-line severity** (`V18__command_log_line_severity.sql`): nullable `severity` on
  `command_log_line`, stamped in the async batch persister for DAEMON commands' OUTPUT lines by
  the same local vocabulary the LOG_LEVEL observer uses (`LogLineClassifier` interface in the
  command area, implemented by the daemon area's `LogLevelLineClassifier` via CDI — no
  command→daemon package cycle). `GET /api/commands/{id}/log?severity=ERROR` returns exactly
  the stamped lines without re-parsing.
- **Retrieval**: `GET /api/daemon-events?repoId=&workspaceId=&severity=&since=&source=&page=&pageSize=`
  (durable, paginated, newest first) replaced the in-memory workspace events endpoint.
- **Agent messages name the source**: a finding from a tailed file injects as
  `[daemon:<name>:<path>]` so the agent knows where the evidence came from.
- **UI**: the workspace events feed reads the durable endpoint and shows a source badge
  (`output` / `path:line`); "open in source" jumps to the command log scrolled to the anchored
  seq range (inverse-video highlight, `?seq=&seqTo=` on the command page) for output events, or
  opens the file in the workspace file browser scrolled to the anchored line (highlight painted
  via the code viewer's existing `LineRange` machinery) for file events — including gitignored
  log files the git-aware tree doesn't list, since the content endpoint reads any file in the
  workspace.

## Decisions on the idea's open points

- **Ring as hot cache**: dropped in favor of synchronous persistence (see above) — the simpler
  layering with identical behavior.
- **File anchor coordinates**: 1-based line numbers (real file line numbers — the initial open
  counts skipped history), directly usable by the file viewer.
- **Observer instantiation**: per (observer, source), so throttles and batches are per source.
- **Findings dispatch asynchronously** onto the supervisor scheduler: a producer delivers lines
  under its own monitor (the tail's final drain even under the supervisor monitor), so inline
  dispatch could deadlock.

## Explicitly out of scope (unchanged from the idea)

- Model-backed classification (no outbound API calls from log observation).
- Copying tailed file content into the database, and any log retention/cleanup policy.
- Structured-log parsing (JSON logs with native level fields) — a natural `LogClassifier`
  refinement now that file sources exist.
- Standalone (daemon-less) sources, glob paths, and per-observer source selectors — the shape
  supports them; they need their own lifecycle/scoping design.

## Verification

- `FileTailSourceTest` (pure unit, real temp files): history skipped but counted so positions
  are true line numbers; truncation rewinds under a new epoch without duplicates;
  deletion-then-recreation re-reads from the top; a late-appearing file is read from line 1.
- `ObserverSinkTest`: the process-output tap (channel filter, ANSI strip, seq-preserving
  positions), PATTERN and LOG_LEVEL findings carrying source + anchor range, excerpt equal to
  the anchored lines' content.
- `DaemonSupervisorTest` (real processes in a cloned-fixture workspace): a daemon quiet on
  stdout logging into a late-created `app.log` → LOG_LEVEL finding with `source=app.log`,
  1-based anchor, epoch, and a `[daemon:<name>:app.log]`-prefixed spooled agent message; a
  stdout daemon whose event anchor resolves against `command_log_line` to exactly the excerpt,
  with per-line severity stamped (`?severity=ERROR` returns exactly those lines, routine lines
  stay null).
- `DaemonEventControllerTest`: published events served durably from `/api/daemon-events`,
  newest first, with severity/source/since filters and pagination.
- `RepositoryDaemonControllerTest`: sources round-trip on CRUD, keep-as-is on null update,
  traversal paths rejected (`../`, absolute, `.git/`).
- `workspace-daemons.component.spec.ts`: source badges, the seq-range command-log link, and the
  file-anchor `openFile` output.
- `generate-migration` reports no drift between the entity model and V16–V18.
