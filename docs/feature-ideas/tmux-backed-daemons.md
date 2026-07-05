# tmux-backed daemons: survive a qits restart, keep readable logs

## Introduction

Reshapes how a [daemon](../features/2026-07-04_daemons.md) *runs* so its lifetime and its logs are
**decoupled from the qits JVM**. Today a running daemon **is** a
[command-registry](../features/2026-06-30_command-registry.md) `CommandSession`: a host-side
`docker exec -it` PTY client (pty4j) whose stdout is streamed live into observers + persistence, with
all supervisor state in memory. That makes it fragile across a qits restart:

- The in-memory `DaemonSupervisor.instances` map is lost, and boot reconciliation blanket-marks the
  persisted `RUNNING` command `INTERRUPTED` (`CommandLifecycleService.reconcileRunningAsInterrupted`),
  so the UI shows **STOPPED**.
- The in-container process is **orphaned but keeps running** (observed: `mvnw`/forked JVM alive long
  after the qits restart, still holding `:8080`), so a fresh start collides on the port (mitigated by
  the launch-time reap in
  [resolved/daemon-stop-orphans-forked-quarkus-jvm](../issues/resolved/2026-07-05_daemon-stop-orphans-forked-quarkus-jvm.md),
  which only *kills* the survivor — it doesn't make the daemon survivable).
- The PTY client dies with qits, so its output is no longer captured — **no logs** for the survivor.

Depends on / touches: [daemons](../features/2026-07-04_daemons.md),
[command registry](../features/2026-06-30_command-registry.md),
[workspace containers](../features/2026-07-04_workspace-containers.md),
[daemon web-view](../features/2026-07-05_daemon-webview-picker.md) (proxy target unchanged — it is
HTTP through the published port, independent of how the process is launched).

## The shape of the fix

Run each daemon as a **detached `tmux` session inside its container**, mirror its pane to a **logfile**
qits tails, and **reconcile from the container on boot** instead of trusting lost in-memory state.
Actions and chats keep the existing PTY `CommandSession` — only daemons change.

Per daemon instance (the container is per-worktree, so `daemonId` is unique within it):

- **Session** on a dedicated tmux socket `-L qits-<daemonId>` (a fresh server per daemon: it inherits
  the `docker exec -e` env at first start with no shared-server staleness, and isolates daemons from
  each other). The pane runs the startScript on a real PTY, tagged `QITS_DAEMON_ID=<id>` (inherited by
  forks — reused by the existing straggler reap).
- **`pipe-pane -o 'cat >> <log>'`** mirrors all pane output to `<rundir>/<daemonId>.log`. qits streams
  it with the existing `tail -F` container source (`ContainerTailSource`), feeding the **same** sinks
  the PTY session did: ready-pattern detection, the LOG_LEVEL/PATTERN observers, and per-line
  persistence into `command_log_line` (so finding anchors are unchanged). This is why a mere tmux
  scrollback is not enough — it is capped and snapshot-only; observers/ready/persistence need a
  continuous, durable line stream.
- **pidfile** `<rundir>/<daemonId>.pid` = the pane leader pid, for the group-kill on stop and as the
  reap marker's companion. `<rundir>` is a writable, tree-external dir in the container
  (`~/.qits/daemons/` — never `/workspace`, which is the git tree).
- **Liveness** = `tmux -L qits-<id> has-session` (authoritative), polled by the supervisor to detect a
  crash (there is no PTY exit callback anymore) and drive the restart policy.
- **Stop** = `tmux -L qits-<id> kill-session` + the existing pidfile group-kill + port reap.

### Boot reconciliation

On startup, for each repo's worktree containers and each daemon definition: if its tmux session is
alive, **re-adopt** it as a running instance (resume the logfile `tail -F`; do not mark the command
INTERRUPTED), otherwise settle STOPPED. This is the piece that makes "restart qits → daemon still
shows running, with logs" true.

## Testability: tmux stays behind the runtime seam

`FakeContainerRuntime` runs commands on the host, so requiring tmux there would force tmux onto every
test host/CI. Instead the daemon-session lifecycle becomes a small set of `ContainerRuntime` methods
(`startDaemon`/`daemonAlive`/`stopDaemon`/`daemonLogPath`): `DockerExecutor` implements them with
tmux; `FakeContainerRuntime` emulates the same contract with plain `setsid` + output redirection +
pidfile (no tmux). Real tmux behavior is covered by the extended real-docker IT.

## Image

Add `tmux` to `docker/workspace/Dockerfile` (Debian bookworm ships tmux 3.3a — `-L` sockets,
`pipe-pane`, and `has-session` all supported; env is set via the launched shell rather than
`new-session -e` to stay version-safe).

## Increments

**Increment 1 (built):** the durable, restart-surviving core. Daemons run in a detached tmux session
(`ContainerRuntime.startDaemon`/`daemonAlive`/`signalDaemon`/`killDaemon`/`daemonLogPath`, docker via
tmux, the test fake via `setsid`); qits streams output by pointing an ordinary registry command at
`tail -F` of the pipe-pane logfile, so persistence/observers/ready-pattern/terminal-attach are reused
unchanged. Liveness is polled (`qits.daemons.liveness-poll-ms`); stop signals the session's process
group then force-kills after the grace. `adoptIfRunning` (lazily, on the first `effectiveDaemons`
sighting) re-adopts a session still alive from before a restart. **The live terminal in this increment
is the `tail -F` follower — a read-only live log view (typing is ignored, since a tail has no
meaningful stdin).**

**Increment 2 (follow-up): the interactive terminal.** Because `tmux attach` emits a full-screen TUI
render (cursor moves, redraws), not a line stream, the observers/ready/persistence must stay on the
logfile tail. So increment 2 *splits* the two paths: a background tail keeps feeding the durable
pipeline (no terminal), and the browser terminal opens an on-demand `docker exec -it tmux -L qits-<id>
attach` PTY (rendered by xterm.js) for real input/resize — letting you drive e.g. Quarkus dev's
`[r]`/`[e]` keys. It reconciles the attach client with the persisted log for scrollback.

## Notes

- **screen vs tmux** — tmux chosen (richer scripting: `-L` sockets, `pipe-pane`, `has-session`).
- **Auto-restart while unviewed** — adoption is lazy (triggered by a UI/API sighting of the worktree).
  A daemon that crashes after a qits restart *and before anyone looks* won't auto-restart until first
  viewed. A `@Observes StartupEvent` eager reconcile across all repos would close this; deferred to
  keep boot cheap and avoid enumerating every repo's containers on every start.
