# Command execution over the `workspace-daemon` socket (replace `docker exec`)

## Introduction

Part 2 of [qits-workspace-daemon](../epic.md). **Out of scope until
[Part 1](workspace-daemon-binary-and-control-socket.md) lands.** The first — and largest — real call site
to move off `docker exec`: the command-execution substrate. Instead of qits spawning a host-side
`docker exec -i` client per command, the [command registry](../../qits-workspace-commands/epic.md)
sends a `RunCommand` over the control socket and `workspace-daemon` runs the process **in-container**,
streaming output back over the socket.

Related/dependent plans:

- **Hard dependency** — [Part 1](workspace-daemon-binary-and-control-socket.md) (the binary, socket, and
  `RunCommand`/`CommandChunk`/`CommandExit` envelope this part consumes).
- **Re-homes** [qits-workspace-commands](../../qits-workspace-commands/epic.md) — the re-attach
  model, the global Commands nav, and the persisted per-line interaction log are all unchanged;
  only the process transport moves. Consumers built on the substrate (daemon follower, agent
  chat) come along for free once their spawn goes through the socket.

## The current surface (what moves)

- **Seam A — `CommandRegistry.dockerExec()` (`CommandRegistry.java:211`)** — builds the
  `containers.execArgv(container, tty, "/workspace", env)` prefix (`ContainerRuntime.execArgv`
  `:96` / `DockerExecutor.java:166`), then wraps the script in
  `bash -lc "echo $$ > /tmp/qits-cmd-<id>.pid; <script>"` (`:225`). Two process shapes feed it:
  `startSession()` (`:142`, a **pty4j** `docker exec -it` client for terminals/actions/interactive
  agent/daemon-follower) and `spawnChat()` (`:84`, a plain-pipe `docker exec -i` client for the
  stream-json coding agent).
- **Seam B — `CommandService.prepare()` (`CommandService.java:515`)** — resolves the container,
  injects otel env (`OtelEnvironment.forLaunch` `:35`), and feeds the registry. Unchanged in
  intent; it hands `workspace-daemon` the argv+env instead of a docker-exec argv.
- **Group kill — `CommandSession.killGroup()` (`CommandSession.java:226`)** — reads the pid file
  via `docker exec cat`, validates the pgid, and `kill -s <sig> -- -<pgid>`. Under `workspace-daemon` the
  process group is tracked **in-process by the client** (it spawned it), so kill becomes a
  `SignalCommand { correlationId, signal }` message — no pid file, no `/proc` read.

## Scope

- Add `SignalCommand` to the envelope; extend `workspace-daemon` to spawn processes (pty and pipe shapes —
  it allocates the pty in-container, so `pty4j`'s job moves into `workspace-daemon`), track their process
  groups, stream stdout/stderr as `CommandChunk`, and report `CommandExit`.
- Route `dockerExec()` through the socket when a live client is registered for the workspace;
  **fall back to `docker exec`** when the socket is absent (the Part-1 degradation contract),
  until the exec verbs are retired at the epic's terminal condition.
- Preserve the interaction-log persistence (`CommandLogWriter`/`CommandLogBatchPersister`) and
  re-attach semantics exactly — they consume `CommandChunk`s the same way they consumed pipe
  bytes.
- otel env still injected; delivery may stay HTTP for now (Part 7/observability decides whether
  it relays through the socket).

## Out of scope

- File access (Part 3), git verbs (Part 4), daemons (Part 5), MCP (Part 6). Daemons *spawn*
  commands but their supervision/lifecycle is Part 5; this part only moves the generic
  spawn+stream+signal mechanism.

## Testing

- `FakeContainerRuntime` gains a socket-backed mode, or a fake client peer runs the process
  host-side (as the fake does today) — the group-kill-via-message path must be exercised
  end-to-end (the fake runs real host processes, so pgid termination stays testable).
- Regression: every existing command/agent/action test passes with the socket path active.
