# Stopping a Quarkus dev daemon can orphan its forked JVM, which holds the port

## Resolution (2026-07-05)

Fixed in `DaemonSupervisor` by reaping stragglers before **every** (re)launch, so a start can never
collide with a leftover from a previous run (`reapStragglers`, called at the top of `launch`). Every
daemon process is stamped `QITS_DAEMON_ID=<daemonId>` (an env overlay, inherited by forks), so a
child that escaped the launched process group — the forked Quarkus dev JVM — is found via
`/proc/<pid>/environ` and killed regardless of its process group (self-contained: bash + coreutils +
`/proc`, no `ss`/`lsof`/`fuser`, none of which are in the workspace image). The per-daemon UUID keeps
the scan off anything else; the scanning shell carries no marker, so it can't self-kill. Regression
test `DaemonSupervisorTest#relaunchReapsAStragglerThatEscapedTheProcessGroup` — a `setsid` child
survives a stop, then is killed on relaunch.

> A first cut also had a **by-port** selector (kill whatever `/proc/net/tcp` says listens on
> `httpPort`) for a holder the marker can't reach. It was **removed**: it is unsafe under the test
> fake, which runs the scan on the host, where it can SIGKILL an unrelated host process bound to that
> port (it killed surefire's fork↔maven channel and crashed the JVM). It is also now redundant — the
> [tmux-backed daemon model](../../features/2026-07-05_tmux-backed-daemons.md) makes daemons survive a qits
> restart, and a session qits lost track of is **re-adopted** (`adoptIfRunning`) rather than
> collided-with, so the only markerless holders left are foreign processes qits should not be killing.

Verified live (before the tmux migration): the greeting dev-server daemon, previously wedged in
`STARTING` by a markerless forked JVM still holding `:8080`, reaped that holder on start and reached
`READY` (OTEL logs/metrics still export, zero failures, web-view proxy 200).

## Introduction

Observed while verifying the OTEL fix for the `seed-webapp` "Quarkus dev server"
[daemon](../features/2026-07-04_daemons.md). Concerns daemon
[stop / process-group termination](../features/2026-07-04_daemons.md) (`DaemonSupervisor.stop` →
`CommandRegistry.signal`, `kill -s <SIG> -- -<pid>`) interacting with Quarkus dev mode, which forks a
**second** JVM (the actual app, bound to the HTTP port) as a child of `mvnw`. Runs inside a
[workspace container](../features/2026-07-04_workspace-containers.md).

## Observed repro

Rapidly stop → (≈3s) → start the greeting Quarkus dev-server daemon a few times. Symptoms:

- The next boot fails with, from the app itself:
  ```
  ERROR [io.quarkus.runtime.Application] (Quarkus Main Thread) Port 8080 seems to be in use by
  another process. Quarkus may already be running or the port is used by another application.
  ```
  The daemon then sits in `STARTING` forever (Quarkus dev mode catches the bind failure and waits
  rather than exiting, so the `Listening on` ready-pattern never matches).
- Inspecting the container shows **orphaned** processes from an earlier run still alive — the `mvnw`
  launcher *and* its forked `.../bin/java … -jar target/quarkus-angular-dev.jar` child — even though
  the daemon reported `stopped (exit 143)` for that run. One orphan still carried a
  `-Dquarkus.test.continuous-testing=disabled` flag from a startScript variant used ~15 min earlier,
  proving it had survived multiple intervening stops. Manually `pkill -9`-ing them frees the port and
  the next start reaches `READY` cleanly.

## Suspected cause

`stop()` signals the PTY leader's process group. Quarkus dev mode's forked application JVM appears to
escape that group (or the 5s stop-grace / 3s restart gap is shorter than its shutdown), so the
group-kill reaps `mvnw` (recorded as exit 143) but leaves the child JVM holding `:8080`. The
supervisor tracks the `mvnw` pid, not the forked JVM, so it believes the stop succeeded. A subsequent
start then collides on the port. Rapid restarts make it worse (the old child hasn't released the port
when the new one binds). A single, unhurried stop→start did **not** reproduce it in this session, so
the trigger is at least partly the fast restart cadence.

## Suggested fix direction

- Confirm whether the forked dev JVM is in the leader's process group inside the container; if not,
  make the daemon launch put the whole `mvnw quarkus:dev` tree in one group/session (or have Quarkus
  dev fork in-group) so `kill -- -<pgid>` reaps the child too.
- Alternatively, on restart wait for the port / child to actually release before re-launching, and on
  stop verify no child still binds `httpPort` before declaring STOPPED.
- A targeted regression: stop a daemon whose script forks a child that binds a port, then assert the
  port is free (the existing `FakeContainerRuntime` runs real host processes, so a forking script is
  reproducible without docker).

## Impact

Low for normal use (single start/stop works), but it makes rapid iteration on a dev-server daemon
flaky and can silently wedge a worktree's port. Separate from the OTEL and classifier fixes.
