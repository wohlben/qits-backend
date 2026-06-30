# Command audit logs — persisted per-line history (Phase 3)

## Introduction

This is **Phase 3 of 3** of the persistent command-execution model. It persists the full MitM
interaction log (every STDIN and OUTPUT line, with a per-line timestamp) and lets a terminated
command be opened to review its complete history.

Related / dependent plans:
- **Phase 1 — [command-registry.md](command-registry.md)** (required): owns the capture tee in
  `CommandRegistry`/`CommandSession` that this phase extends with line-framing + persistence, and the
  `Command` entity these log lines FK to.
- **Phase 2 — [command-restore-navigation.md](command-restore-navigation.md)** (required): provides the
  Commands list whose terminated rows now navigate into this log view.

## Goal

Persist the per-line log for every command and render a read-only, channel-aware, timestamped history
for terminated commands — including visualizing long pauses in output.

## Conventions to mirror

- High-volume rows use a `@GeneratedValue` Long sequence id (like `Worktree`).
- Migrations: `V9__*.sql` next; `Instant` → `timestamp(6) with time zone`. **CLOB is unused so far** —
  the log-content column is the first; the hand-written DDL must match the JPA mapping exactly
  (Hibernate validates the schema at startup).
- Read-only log rendering can reuse `web-terminal.component.ts`'s xterm setup, writing persisted text
  into a non-interactive `Terminal` so ANSI/colour render.

## Backend

- `entity/CommandLogLine.java` — `@Id @GeneratedValue Long id` (sequence);
  `@ManyToOne(optional=false) @JoinColumn(name="command_id") Command command`;
  `@Column(name="seq") long sequence` (monotonic per command — stable ordering when timestamps
  collide); `@Enumerated(STRING) LogChannel channel` (`STDIN, OUTPUT`; `STDERR` reserved/unused);
  `@Column(columnDefinition="text") String content` (raw, may contain ANSI — first CLOB in the repo);
  `@Column(name="at") Instant timestamp` (set explicitly at capture).
- `persistence/CommandLogLineRepository.java` — `find("command.id = ?1 order by seq", id)`.
- **Capture (the MitM):** extend the Phase 1 tee with line-framing. OUTPUT is framed on `\n` (handling
  `\r`); each completed line persisted with its completion timestamp; a trailing partial line flushed
  on terminate. STDIN lines persisted at the `input()` write point. Persist via a `CommandLogService`
  on a **batched/queued writer** (a `mvn test` emits thousands of lines — avoid a DB round-trip per
  line); write-through is the fallback. Reattach replay still uses the in-memory raw ring buffer
  (reconstructs the live xterm screen); the persisted line log is for terminated review.
- `dto/CommandLogLineDto.java` (`seq, channel, content, timestamp`) + mapper.
- `GET /api/commands/{commandId}/log` → `List<CommandLogLineDto>` (add to `openapi.yml`, regen client).
- Migration `V9__command_log_line.sql` — table + sequence + FK to `command(id)` + the `text` column.

## Frontend

- The command page, when the command is **terminated**, renders a read-only log view instead of the
  live socket: feed persisted content into a read-only xterm `Terminal`, distinguishing STDIN vs OUTPUT
  (colour/prefix per channel).
- Visualize **long breaks**: compute the delta between consecutive line timestamps and render a
  separator/gap marker when it exceeds a threshold.
- Phase 2's terminated rows now navigate here.

## Verification

1. Run an action that emits many lines (`mvn test` / a chatty script); terminate or let it exit.
2. `GET /api/commands/{id}/log` returns ordered lines with channels + timestamps; counts match output.
3. Open the terminated command from the Commands list → the read-only log renders with ANSI/colour,
   STDIN vs OUTPUT distinguished, and gap markers where output paused.
4. Restart the app → the persisted log is still retrievable (survives JVM restart, unlike the in-memory
   ring buffer).
