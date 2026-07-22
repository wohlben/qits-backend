# Daemon supervision handover to `clientd`

## Introduction

Part 5 of [qits-workspace-client](../epic.md). **Out of scope until
[Part 1](clientd-binary-and-control-socket.md) lands** (and best after
[Part 2](command-execution-over-socket.md), whose spawn/signal seam daemons build on). Moves the
in-container half of [daemon](../../qits-workspace-daemons/epic.md) supervision — process launch,
liveness, log mirroring, straggler reaping, and group-kill — from the host into `clientd`, which
is PID 1 and can therefore supervise child processes natively. `DaemonSupervisor` stays on the
host as a **thin coordinator** (state machine, backoff, status events, web-view config); it stops
shelling docker and instead instructs `clientd`.

Related/dependent plans:

- **Hard dependency** — [Part 1](clientd-binary-and-control-socket.md); **soft dependency** —
  [Part 2](command-execution-over-socket.md) (daemons are spawned processes).
- **Re-homes** [qits-workspace-daemons](../../qits-workspace-daemons/epic.md) — the definitions,
  the auto-start/auto-stop coupling to the workspace lifecycle
  ([daemon auto-start](../../qits-workspace-daemons/features/2026-07-09_daemon-autostart-on-workspace-start.md)),
  and the web-view proxy are unchanged; only the runtime host moves.
- **Feeds** [qits-observability](../../qits-observability/epic.md) — `clientd` streams daemon
  logs home over the socket as a thin client (the log-mirror follower disappears).

## The current surface (what moves — all in `DaemonSupervisor.java`)

- **Launch** — `containers.startDaemon(container, id, script, env)` (`:493`) starts a **tmux**
  session (`-L qits-<id>` socket, `pipe-pane` mirror log under `/tmp/qits-daemons`,
  `DockerExecutor.java:317`). Under `clientd`, the daemon is a supervised child of PID 1 — **no
  tmux**.
- **Log streaming** — a "follower" registry command tails the mirror log
  (`tail -F <daemonLogPath>`, `followScript` at `:496`, `commandService.followDaemon` `:498`) and
  `ContainerTailSource`/`startFileTails` (`:650`) tail file-sources. Both collapse into `clientd`
  streaming child output directly over the socket.
- **Liveness** — no host exit callback today, so `checkLiveness()` (`:591`) polls
  `daemonAlive`/`daemonExitCode`. `clientd` owns the child, so it **pushes** exit/liveness events.
- **Kill** — `signalDaemon`/`killDaemon` (pane pgid, `:229`/`:244`) and `reapStragglers()`
  (`:723`, scans `/proc/*/environ` for the `QITS_DAEMON_ID` marker to kill escaped forks, e.g.
  Quarkus dev's forked JVM). `clientd`, as PID 1, is the reaper — escaped forks are its
  children; the `/proc` scan disappears.
- **Adoption after qits restart** — `adoptIfRunning()` (`:379`) re-attaches to tmux. Under
  `clientd` the client survives a qits restart and re-reports its running daemons on reconnect.
- **Interactive attach** — `DaemonTerminalSocket` (`service/.../daemon/api/DaemonTerminalSocket.java:75`)
  uses `attachDaemonCommand`; becomes a socket-attached stream to the `clientd`-owned process.

## Scope

- Add daemon messages: `StartDaemon { id, script, env }`, `SignalDaemon { id, signal }`,
  `DaemonEvent { id, state, exitCode }`, daemon log chunks (reusing `CommandChunk` tagged by
  daemon id).
- `clientd` supervises daemon children (start, track the process group, stream logs, push
  liveness/exit, reap escaped forks as PID 1). `DaemonSupervisor` becomes host-side coordination
  only, calling the socket; **falls back to tmux** when the socket is absent (degradation
  contract) until the tmux path is retired.
- Preserve `qits.daemons.*` knobs (grace, backoff, poll — poll becomes push), web-view proxy
  origin resolution, and the lifecycle coupling.

## Out of scope

- Command execution (Part 2, prerequisite), file access (Part 3), git (Part 4), MCP (Part 6).

## Testing

- Fake-client supervision: start/stop/crash/exit events, log streaming, group-kill of a forked
  child (the fake runs real host processes, so escaped-fork reaping stays testable end-to-end).
- Extended real-docker IT: a `quarkus:dev` daemon under `clientd`, asserting the forked JVM is
  reaped on stop without the `/proc` scan.
