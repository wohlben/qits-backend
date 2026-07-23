# Daemon-supervised dev daemons (autonomous supervision handover)

## Introduction

Part 4 of the **provisioning-inversion** track of [qits-workspace-daemon](../epic.md) (see the
[overview](daemon-self-provisioning-and-file-only-config.md)). The **autonomous reframing of the
epic's [Part 5 — daemon-supervision-handover](daemon-supervision-handover.md)**: instead of qits
*instructing* the daemon to start each dev-server daemon after the handshake, the daemon **starts the
declared dev daemons itself, as the tail of its own startup sequence** (clone → config → bootstrap →
**daemons**), from the [in-container config](in-container-config-discovery.md).

Today the in-container half of daemon supervision is host-driven: `DaemonLifecycleCoupler`
(`domain/.../daemon/control/DaemonLifecycleCoupler.java`) observes `WorkspaceReadyForDaemons` and
calls `DaemonSupervisor.launch` (`domain/.../daemon/control/DaemonSupervisor.java`), which starts a
**tmux** session per daemon (`containers.startDaemon`), tails a mirror log (`tail -F`), polls
liveness, and reaps escaped forks by scanning `/proc/*/environ` for the `QITS_DAEMON_ID` marker.
Because the daemon is **PID 1**, it can supervise child processes natively — no tmux, no `/proc`
scan, no mirror-log tail.

### Autonomous control model (option 1)

Daemon start is the last step of the daemon's startup sequence, self-run from the in-container config
once bootstrap succeeds. `DaemonSupervisor` shrinks to a **thin host-side coordinator** (state
machine, backoff, status events, web-view proxy config) that receives daemon lifecycle events over
the socket and issues only *subsequent* operations (manual restart/stop) — it stops shelling docker.

### Related / dependent plans

- **Supersedes / merges [Part 5 — daemon-supervision-handover](daemon-supervision-handover.md)** —
  same re-homing (launch, liveness, log mirroring, straggler reaping, group-kill move into the
  PID-1 daemon), arrived at from the *provisioning* side (autonomous tail-of-startup) rather than the
  *supervision* side (qits instructs). Part 5's `StartDaemon`/`SignalDaemon`/`DaemonEvent` message
  shapes and its `qits.daemons.*` knob preservation carry over.
- **Hard dependency** — [daemon-run-bootstrap-chain](daemon-run-bootstrap-chain.md) (a successful
  chain gates daemon start) and [in-container-config-discovery](in-container-config-discovery.md)
  (the daemon definitions are read from the checkout).
- **Re-homes [qits-workspace-daemons](../../qits-workspace-daemons/epic.md)** — the definitions, the
  auto-start/auto-stop lifecycle coupling
  ([auto-start](../../qits-workspace-daemons/features/2026-07-09_daemon-autostart-on-workspace-start.md)),
  and the web-view proxy origin resolution are unchanged; only the runtime host moves into the
  container's PID 1.
- **Feeds [qits-observability](../../qits-observability/epic.md)** — the daemon streams dev-daemon
  logs home over the socket as a thin client; the host log-mirror follower disappears.

## What moves

- **Launch** — the daemon starts each auto-start dev daemon as a supervised **child of PID 1** (no
  tmux `-L qits-<id>` session, no `pipe-pane` mirror). `restartPolicy`/`maxRestarts`/`stopSignal`/
  `readyPattern` semantics are honoured in-container.
- **Log streaming** — the daemon streams child stdout/stderr directly over the socket (reusing the
  `CommandChunk` shape tagged by daemon id); the host `tail -F <daemonLogPath>` follower and the file
  tails collapse.
- **Liveness** — the daemon **pushes** exit/liveness events (`DaemonEvent`) instead of the host
  polling `daemonAlive`/`daemonExitCode`.
- **Kill / reaping** — the daemon, as PID 1, group-kills and reaps escaped forks (e.g. Quarkus dev's
  forked JVM) natively; the `/proc/*/environ` `QITS_DAEMON_ID` scan disappears.
- **Adoption after a qits restart** — the client survives a qits restart and **re-reports its running
  daemons on reconnect** (replacing tmux `adoptIfRunning`).
- **`DaemonSupervisor` becomes host-side coordination only** — the state machine, exponential
  backoff, status/SSE events, `TechnicalProcess` segment settling, and the web-view proxy origin
  (`ContainerRuntime.resolveTarget` → `ProxyOrigin`, consumed by `DaemonProxyRoute`) stay host-side,
  fed by socket events. It **falls back to tmux** when the socket is absent (degradation contract)
  until that path is retired.

## New wire messages (carried from Part 5)

- **`StartDaemon { id, script, env }`**, **`SignalDaemon { id, signal }`** *(qits → daemon, for
  manual/subsequent ops)*; **`DaemonEvent { id, state, exitCode }`** and daemon log chunks *(daemon →
  qits)*. Auto-start needs no `StartDaemon` — the daemon self-starts the auto-start set from the
  in-container config; `StartDaemon` covers manual/non-auto-start starts.

## Degradation contract

Socket absent (stale image) ⇒ `DaemonSupervisor` falls back to the current tmux `startDaemon` path,
driven by the (still-present until Part 3 fully lands) host event chain. *Socket down ⇒ today's
behaviour.*

## Non-goals

- Removing the DB `RepositoryDaemon` rows / repo-scope — [Part 5](config-as-single-source-of-truth.md)
  (this part re-homes the *supervisor*; that part removes the *store* and the repo-level auto-start
  coupler query).
- MCP / tokens — [Part 6 of the epic](mcp-termination-and-token-provisioning.md).

## Testing

- **Fake-client supervision** — start / ready / crash / exit events, log streaming, group-kill of a
  forked child (the fake runs real host processes, so escaped-fork reaping stays end-to-end
  testable).
- **Extended real-docker IT** — a `quarkus:dev` daemon under the workspace-daemon, asserting the
  forked JVM is reaped on stop **without** the `/proc` scan, and the web-view proxy still resolves.
- **Adoption** — a qits restart re-adopts a running daemon from the client's reconnect report.
