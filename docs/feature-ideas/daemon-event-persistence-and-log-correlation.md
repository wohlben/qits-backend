# Daemon event persistence and classified-log correlation

## Introduction

The [daemons feature](../features/2026-07-04_daemons.md) already persists every daemon output
line — a daemon run is a registry command, so its stream lands in `command_log_line` via the
[command audit logs](../features/2026-06-30_command-audit-logs.md) pipeline and is fetchable per
command (`GET /api/commands/{id}/log`). What it does **not** persist is the *classified* layer
on top: `DaemonEventDto`s (state transitions and observer findings with their severity) live in
an in-memory ring (`DaemonEventService`, capped at 500, gone on JVM restart), and log lines
carry no severity of their own. This idea makes the classified layer durable and queryable, so
logs and events can be **retrieved and correlated** — across restarts, across daemons of a
worktree, and from an event straight to its place in the log.

Related/dependent plans:

- Builds directly on the [daemons feature](../features/2026-07-04_daemons.md): the
  `LogClassifier`/observer pipeline produces the classifications; this idea stores them. The
  interface stays the seam a future model-backed classifier would slot into.
- Rides the [command audit logs](../features/2026-06-30_command-audit-logs.md) tables:
  correlation is expressed as references into `command_log_line` (command id + `seq`), not as
  copied text.
- The worktree daemons panel (events feed) and the agent spool
  ([stream-json chat](../features/2026-07-01_stream-json-chat.md) injection) become readers of
  the durable store instead of the in-memory ring.

## Problem

1. **Events don't survive.** A JVM restart (or 500 newer events) erases the record that a daemon
   crashed last night, what the classifier saw, and what was sent to the agent. The only durable
   trace is the raw log, which has to be re-read and re-interpreted by a human.
2. **No severity on stored lines.** `command_log_line` stores raw text; "show me only the ERROR
   lines of this run" or "how many warnings did the dev server log today" cannot be answered by
   a query — the classification the LOG_LEVEL observer already computed at capture time is
   thrown away after the event fires.
3. **No correlation.** An event says "crashed (exit 1)" with a text excerpt, but nothing links
   it to *where* in the persisted log it happened; the UI cannot jump from an event to the log
   position, and nothing lines up events from two daemons of the same worktree on one timeline.

## Idea

- **Persist events**: a `daemon_event` table (new entity in `domain.daemon`) written by
  `DaemonEventService.publish` alongside the in-memory ring — id, repo/worktree snapshot
  columns, daemon id + name, kind, severity, status, summary, `command_id` FK, timestamp, and
  the log anchor below. The ring stays as the hot cache; the feed endpoint reads DB with the
  ring as its head, same layering as the chat transcript restore.
- **Anchor events to the log**: observers already know the batch they classified; carry the
  first/last `seq` of that batch into the event (`log_seq_from`/`log_seq_to`) instead of only a
  copied excerpt. The excerpt stays for cheap display; the anchor makes "open the log here"
  exact.
- **Severity on log lines**: nullable `severity` column on `command_log_line`, stamped at
  capture time for DAEMON commands by running `LogLevelClassifier` per line in the async batch
  persister (off the hot path, local and cheap). Raw text stays untouched; INFO/DEBUG simply
  stay null.
- **Retrieval**: `GET /api/daemon-events?repoId=&worktreeId=&severity=&since=` (durable,
  paginated, newest first) replacing the worktree-scoped in-memory endpoint; the command log
  endpoint gains `?severity=` to fetch only classified lines of a run.
- **Correlation UI**: the events feed gets "open in log" (command terminal/log view scrolled to
  the anchored seq), and the worktree panel can show one merged severity timeline across its
  daemons.

## Explicitly out of scope

- Any model-backed classification (see the daemons feature: no outbound API calls from log
  observation; `LogClassifier` remains the extension point).
- Log retention/cleanup policies — `command_log_line` already grows unbounded by design
  (no-auto-cleanup rule); this idea adds columns and a table, not lifecycle management.
- Cross-repository analytics; retrieval stays scoped to repo/worktree like everything else.

## Testing sketch

- Event persistence round-trip: a supervisor transition lands as a `daemon_event` row; restart
  (reconciliation) keeps it; the feed endpoint serves it with the ring gone.
- Line classification: a DAEMON command's persisted lines carry severity where the classifier
  fires and null elsewhere; `?severity=ERROR` returns exactly those.
- Anchoring: an observer finding's event references the seq range of the batch that produced
  it; the excerpt equals the anchored lines' content.
