# Daemons: managed long-running processes with model-in-the-loop log observation

## Introduction

Actions run to completion — `executeScript` starts, exits, and the exit code is the result. A
**daemon** is the missing sibling: a process that is *supposed to keep running* (dev server,
compile watcher, test runner in watch mode). Its result is not an exit code but a **status over
time**: is it up, is it ready, is it printing errors? This idea adds daemons as a first-class
concept — definition, supervised runtime, and **observers** that watch the log stream (regex or a
cheap model) and turn what they see into events. The headline event sink: **notifying the coding
agent working in the same worktree**, by injecting a message into its stream-json session ("the
dev server just crashed, here's the stacktrace").

Related/dependent plans:

- Builds directly on the [command registry](../features/2026-06-30_command-registry.md): a running
  daemon **is** a registry command (new `CommandKind`), reusing the PTY session, ring-buffer
  replay, re-attach, and terminate machinery. Daemons add supervision (restart, health) *around*
  a `CommandSession`, not a second process subsystem.
- Mirrors the [actions](../features/2026-05-01_actions.md) definition model
  (`AbstractActionDefinition`: script + environment, global/repository scope) — a daemon
  definition is deliberately shaped like an action definition so the UI and seeding patterns
  carry over.
- The agent-notification sink targets sessions launched by the
  [coding-agent harness](../features/2026-07-01_coding-agent-harness.md) and speaks the
  [stream-json chat](../features/2026-07-01_stream-json-chat.md) protocol — the `ChatSession`
  stdin the registry already owns is exactly the injection point.
- Complements the [worktree chat dialog](worktree-chat-dialog.md): daemon events surfacing inside
  the chat is the payoff of both ideas combined.
- [Observability](observability.md) builds on the daemon launch path: an `otel` toggle injects
  `OTEL_EXPORTER_OTLP_*` into the daemon's environment, and structured telemetry (exception span
  events) upgrades this doc's log-regex/model error detection.

## New base concepts

Three concepts, deliberately orthogonal so each is useful alone:

1. **Daemon definition** — *what* to run and how to know it's alive (scripts, environment,
   readiness, restart policy). Declarative, scoped like actions.
2. **Daemon instance** — *one supervised run* in a worktree: a registry command plus a
   supervisor state machine (`STARTING → READY → DEGRADED/CRASHED/RESTARTING → STOPPED`).
3. **Log observer** — a consumer attached to a command's output stream that emits **events**
   (pattern matched, error classified, readiness detected). Observers are defined per daemon but
   the attachment mechanism is generic — `CommandSession` already fans out to
   `CommandOutputSink`s; an observer is just another sink.

Events flow to **sinks**: the worktree's agent session, the UI, and (later) a fresh headless
triage agent.

## Domain model sketch

Follow the action pattern (`AbstractActionDefinition` → global + repository subclasses):

- `AbstractDaemonDefinition` (`@MappedSuperclass`): `id`, `name`, `description`,
  `startScript` (len 4000, run verbatim in the worktree, stays in the foreground),
  `readyPattern` (nullable regex; first match on the output stream flips `STARTING → READY` —
  e.g. `Listening on.*:8080`), `stopSignal` (default `SIGTERM`, grace period then kill),
  `restartPolicy` enum (`NEVER`, `ON_FAILURE`, `ALWAYS`) + `maxRestarts`/backoff,
  `Map<String,String> environment`, timestamps.
- `DaemonConfiguration` (global) and `RepositoryDaemon` (repo-scoped, `@ManyToOne Repository`),
  cascade-deleted with the repo — same split and same `DaemonResolutionService` shape as
  `ActionResolutionService.effectiveActions` (global ∪ repository).
- `LogObserverConfiguration` (`@ManyToOne` to the daemon definition): `kind` enum
  (`PATTERN`, `MODEL`), for `PATTERN` a regex + severity; for `MODEL` a classifier prompt
  override (optional — a good default lives in code). One daemon, many observers.
- **No new instance entity**: the instance's durable record is the existing `Command` row (new
  `CommandKind.DAEMON`). Supervisor state (`DaemonStatus`, restart count, last event) lives
  in-memory next to the `CommandSession` in the registry — same "the registry is the only
  stateful singleton" rule; a JVM restart reconciles daemons to `INTERRUPTED` like any command.

## Runtime: the supervisor

A `DaemonSupervisor` in `domain.command.control` (or a new `daemon` area) wraps launch:

- `start(repoId, worktreeId, daemonId)` → resolve definition, launch via
  `CommandService`/registry exactly like an interactive action, register an exit listener.
- On exit: consult `restartPolicy` → relaunch (new `Command` row, incremented restart count,
  exponential backoff) or settle in `CRASHED`. Every transition emits a `DaemonEvent`.
- `READY` via `readyPattern` observer; no pattern → `READY` after a grace period.
- `stop()` sends `stopSignal`, waits the grace period, then falls back to the registry's
  `terminate()`. Stopping is explicit — the no-auto-cleanup rule still holds.

Because the instance is a registry command, the existing terminal socket gives log tailing and
re-attach in the UI **for free**.

## Log observation with a cheap model

The `MODEL` observer is the interesting one. Design points (verified against current docs):

- **Model**: Haiku 4.5 (`claude-haiku-4-5-20251001`) — $1/M input introductory pricing, and with
  a **cached system prompt** (≥1,024 tokens, `cache_control: ephemeral`) repeat classification
  calls pay ~$0.10/M for the cached portion. The system prompt (classification rules + output
  contract, padded with framework-specific error examples) is stable per observer, so the cache
  hits on every call while the daemon logs steadily.
- **Batching, not per-line**: the observer buffers output and flushes on a debounce (~2s idle or
  N KB), sending one classification call per batch. Output contract is strict and tiny, e.g.
  `NONE` or `severity|error-type|one-line-summary|first-line-offset`, so output tokens stay
  negligible. A regex pre-filter (`error|exception|warn|failed…`, case-insensitive) gates the
  model call entirely — quiet, healthy logs cost zero.
- The observer emits a `DaemonEvent(kind=ERROR_DETECTED, severity, summary, logExcerpt)` with
  the raw excerpt attached — sinks get both the classification and the evidence.
- Direct Anthropic API call from the backend (first `com.anthropic` dependency in the project) —
  small client in `domain`, key via config/env. Alternative rejected: shelling out to
  `claude -p` per batch is heavyweight (session spin-up per call) and harder to cache-control.

## Notifying a model (the sink you asked about)

The half-remembered arg is **`--input-format stream-json`**: a headless Claude Code session
(`claude -p --input-format stream-json --output-format stream-json`) keeps stdin open and accepts
newline-delimited JSON user messages for the life of the process. Findings from the research:

- There is **no supported way to inject a message into a foreign, already-running interactive
  session** — no named pipe, no control socket. But qits doesn't have that problem: it spawns
  its agent sessions itself and the registry's `ChatSession` **already owns the stdin** of every
  stream-json chat. Injecting is writing one more JSON line:
  `{"type":"user","message":{"role":"user","content":"[daemon:dev-server] crashed (exit 1) …stacktrace…"}}`.
- So the **agent sink** = `DaemonEvent` → find the newest running `CHAT` command for the same
  worktree (the exact resolution rule from the worktree-chat-dialog idea) → write the event as a
  user message onto its stdin, clearly prefixed (`[daemon:<name>]`) so the agent and the human
  reading the transcript can tell it apart from the user. The event also renders in the chat UI
  because it flows through the normal transcript.
- Mid-turn injection: the CLI queues stdin messages while the agent is working and picks them up
  on the next turn — good enough; no interruption semantics needed.
- **Launch every stream-json Claude instance with `--include-hook-events`** (verified against the
  installed CLI: "include all hook lifecycle events in the output stream, only works with
  `--output-format=stream-json`"). This applies to the existing chat launches and any future
  headless triage runs. It gives qits turn-boundary awareness for free — seeing the `Stop` hook
  event on stdout tells the registry the agent is idle, which is the right moment to flush
  spooled daemon events, drive the chat UI's busy/idle indicator, and (later) feed agent-session
  observers the same way daemon logs feed theirs.
- **PTY-interactive agent sessions** (non-chat) can't be safely typed into (racy, corrupts the
  user's input line). Fallback for those: qits launches the agent, so it can pass hook config
  that reads-and-drains a per-worktree event spool file via `UserPromptSubmit`/`PostToolUse`
  `additionalContext`. Second iteration — stream-json chats are the primary target.
- **No agent session running?** The event is spooled per worktree and delivered when a session
  starts (seed context), plus shown in the UI. Optionally (deferred): auto-spawn a headless
  triage run — `claude -p --resume`-able — fed the excerpt.

## UI sketch

- Worktree detail gains a **daemons panel**: per effective daemon a status chip
  (`STARTING/READY/DEGRADED/CRASHED/STOPPED` + restart count), start/stop, and "logs" opening
  the existing command terminal re-attach. Per the everything-visible convention, all effective
  daemons show, including not-running ones.
- Recent daemon events as a small feed (severity-colored), each expandable to the log excerpt.
- Definitions managed like actions (global library + per-repo), same CRUD surface style
  (`/api/daemon-configurations`, `/api/repositories/{id}/daemons`, nested-record controllers).

## Explicitly deferred

- Feature-flow integration (a phase requiring "dev server READY" as a gate) — the event/status
  vocabulary is designed to support it, but no `FeatureFlowPhase` wiring yet.
- Auto-spawned headless triage agent on `ERROR_DETECTED`.
- Hook-based injection into PTY-interactive agent sessions (stream-json chats first).
- Port management (auto-allocating ports per worktree and templating them into
  `environment`) — first iteration: the definition hardcodes ports, and parallel worktrees
  running the same daemon collide; documented limitation.
- Push/desktop notifications for the human; the UI feed covers iteration one.
- Observers on non-daemon commands (the sink mechanism is generic on purpose).

## Open questions

- **Instance uniqueness**: one running instance per (worktree, daemon) enforced, or allow
  duplicates like commands do? Lean: enforce singleton per (worktree, daemon) — "restart"
  beats two dev servers fighting over a port.
- **Where does the Anthropic API key live** — global qits config, or per-observer? Lean: one
  global config property; observers are cheap enough to share a budget. Should there be a
  per-day token cap that flips MODEL observers to PATTERN-only when exceeded?
- Does `DEGRADED` (errors seen but process alive) auto-recover to `READY` after N quiet
  minutes, or only reset on restart?
- Is `domain.daemon` a new BCE area, or does it live inside `command` (it's tightly coupled to
  the registry)? Lean: new `daemon` area, depending on `command` — mirrors how `agent` uses the
  registry without living in it.

## Testing sketch

- Supervisor unit-ish test (`@QuarkusTest`, temp data-dir like `CommandServiceTest`): daemon
  `while true; do echo tick; sleep 1; done` → READY via pattern; kill the PID → `ON_FAILURE`
  relaunches with a new `Command` row and bumped restart count; `NEVER` settles `CRASHED`;
  `stop()` → `STOPPED`, no restart.
- Ready-pattern observer test: scripted output flips `STARTING → READY` exactly once.
- Model observer test with the Anthropic client faked: regex pre-filter gates calls (quiet logs
  → zero calls); an error batch → one call → `ERROR_DETECTED` event carrying the excerpt.
- Agent-sink test: fake `ChatSession` stdin; an event lands as one well-formed stream-json user
  message with the `[daemon:…]` prefix; no running chat → spooled, delivered on chat start.
- Manual: seeded repo, daemon `python3 -m http.server`, watch READY chip, kill it externally,
  watch restart; add a `raise`-ing route, hit it, watch the error event arrive in the open chat.
