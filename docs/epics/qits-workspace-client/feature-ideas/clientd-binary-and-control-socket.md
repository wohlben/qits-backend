# `clientd`: the in-container binary + control socket (infrastructure only)

## Introduction

Part 1 of [qits-workspace-client](../epic.md) — and the **only in-scope part**. It stands up the
infrastructure every later refactoring needs, and **nothing more**: a compiled binary that
becomes each workspace container's init (PID 1), a persistent bidirectional socket back to the
qits backend, a lifecycle handshake, and one generic "take this action" message proven
end-to-end. It **migrates no existing call site** — the current host-driven `docker exec` paths
keep running, untouched, alongside `clientd`. When this lands, qits *can* send a command to the
in-container client and get output back; the parts that follow move real subsystems (command
execution, file access, git verbs, daemons, MCP, maintenance) onto that seam.

> **This is the foundation, not the payoff.** The temptation is to migrate a real call site "for
> free" while we're here. Don't. Part 1's value is that it changes **zero** behaviour and can
> ship dark (the binary runs as PID 1, holds the socket open, and is otherwise idle). Every
> behaviour change is a later, independently-reviewable part. Keeping Part 1 behaviour-neutral is
> what makes the later migrations safe to land one at a time.

Related/dependent plans:

- **Parent epic** — [qits-workspace-client](../epic.md); this part unblocks all of Parts 2–7.
- **Builds on [lazy workspace container provisioning](../../qits-workspaces/features/2026-07-08_lazy-workspace-container-provisioning.md)** —
  the container command and provisioning flow this part changes live in
  `WorkspaceService.provisionContainer` (`:182`) and `WorkspaceContainerFactory` (the run argv,
  `sleep infinity` command at `WorkspaceContainerFactory.java:198`).
- **Reuses [qits-net / devcontainer reachability](../../qits-live-deployment/features/2026-07-07_qits-net-devcontainer-unification.md)** —
  `clientd` dials the backend at the address `QitsHostResolver.qitsHost()` (`:53`) already
  resolves for clone/OTLP/MCP URLs. No new reachability model; the socket rides the same host.
- **Consistent with the [cli](../../../../CLAUDE.md) command-mode module** — `clientd` is a
  second `@QuarkusMain` app like `cli/`, but native-compiled and web-stack-free.
- **Precedent for behaviour-neutral staging** — like
  [workspace-bootstrap-commands](../../qits-workspaces/features/2026-07-18_workspace-bootstrap-commands.md)
  hooked the container lifecycle without disturbing daemon auto-start, this part hooks PID 1
  without disturbing the exec paths.

## The binary

A new Maven module **`clientd/`** (group `eu.wohlben`, package `eu.wohlben.qits.clientd`):

- A Quarkus **command-mode** app (`@QuarkusMain` in `eu.wohlben.qits.clientd.Main`), **no web
  stack** — like `cli/`, but built to a **GraalVM native binary** (`-Dnative`) so the container
  ships a single static-ish executable, not a JVM launch. (The workspace image already carries a
  JDK for the coding agent's tools; `clientd` is native specifically so PID 1 starts instantly
  and carries no JVM warm-up or heap baseline.)
- Depends on **neither `service` nor `auth/*`**. It may depend on `domain` **only** for shared
  protocol records if we put them there; the preferred split is a tiny framework-free
  **`clientd-protocol`** carrier (or a package inside `clientd/` that the backend also indexes)
  holding the wire envelope records, so backend and binary share one definition. **Open
  decision** (below): where the shared protocol type lives.
- Runs as the container's **init (PID 1)**: it replaces `sleep infinity` as the container
  command, so it must do the init job — **reap zombies and forward signals** to its children
  (today handled by Docker's `--init`/tini shim; `clientd` either keeps `--init` in front of it
  or does the reaping itself — open decision below).

## What Part 1 changes

1. **New `clientd/` module** — Quarkus command-mode, native build profile, its own
   `application.properties` with the socket/backend config. Added to the reactor; the Maven
   build-cache treats it like any module. It needs **no `-Dqits.variant`** (no auth, no service).

2. **Dockerfile workspace stage** (`docker/qits/Dockerfile`, stage `workspace` at `:38`) — build
   the native `clientd` (in a builder stage) and `COPY` the binary into the workspace image at a
   fixed path (e.g. `/usr/local/bin/clientd`). The workspace stage today has **no entrypoint/CMD**
   by design (`:34-37`); Part 1 gives it one: **`ENTRYPOINT`/`CMD` becomes `clientd`** so a plain
   `docker run <image>` starts the client. `WorkspaceContainerFactory` stops appending `sleep
   infinity` (`:198`) — the container command is now the binary. (The **prod app image**'s final
   stage entrypoint at `:327` is unrelated and unchanged.)

3. **`clientd` boot → control socket** — on start, `clientd` reads its identity from the
   container environment/labels (`qits.workspace.id`, `qits.repository.id`, branch, parent —
   already set as labels by `WorkspaceContainerFactory.java:139-142` and available as env), then
   **dials the backend and opens a persistent bidirectional socket**. Transport reuses the
   existing qits HTTP reachability (`QitsHostResolver.qitsHost()` + `qits.workspace.qits-port`)
   — **WebSocket over the qits HTTP port** is the leading candidate (works through the same
   `qits-net` DNS / `host.docker.internal` path as `/git`, `/api/otel`, `/mcp`, and needs no new
   exposed port), with raw TCP as the fallback (open decision below). A new backend route (in
   `service`, `eu.wohlben.qits.clienthost` or similar) accepts the connection and registers it
   in an app-scoped **`WorkspaceClientRegistry`** keyed by workspaceId.

4. **Lifecycle handshake** — on connect, `clientd` sends a `HELLO` (identity + capability
   version) and the backend acknowledges. The registry now knows the workspace's client is live.
   `WorkspaceService.ensureContainer` (`:833`/`:878`) **additionally** observes this handshake as
   a liveness signal — but Part 1 **does not** replace the existing reconciliation ladder
   (`isRunning` label poll `:891`, start-in-place `:913`, materialize-from-ref `:948`); the
   handshake is recorded alongside, informational, so nothing regresses if the socket is absent
   (older images, or the binary crashing). A missing/broken socket must degrade to exactly
   today's behaviour.

5. **The action-message envelope** — define the wire contract: a small set of framework-free
   records for qits→`clientd` requests and `clientd`→qits events/streams. Minimum for Part 1:
   - `RunCommand { correlationId, argv[], cwd, env{} }` → streamed `CommandChunk { correlationId,
     stream(STDOUT|STDERR), bytes }` → `CommandExit { correlationId, exitCode }`.
   - `Hello`/`Ack`, `Heartbeat`, and `ClientLog` (clientd's own logs).
   This is the seam Parts 2–6 extend (add `ReadFile`/`WriteFile`, `StartDaemon`/`SignalDaemon`,
   `OpenMcp`, …). Part 1 defines only what it needs to prove the transport.

6. **Prove one command end-to-end** — a single backend-initiated `RunCommand` (e.g. `echo` /
   `git rev-parse HEAD`) sent over the socket, executed by `clientd` in the container, streamed
   back, and asserted. This is a **demonstration/integration test**, not a wiring of any real
   call site — `CommandRegistry`, `WorkspaceService.containerGit`, `ContainerFileAccess`, and
   the daemon paths all still shell `docker exec` exactly as before.

7. **`clientd` streams its own logs** — as a thin client, `clientd` sends its stdout/stderr and
   structured events home over the socket (`ClientLog`), so a crashing or misbehaving client is
   visible in qits without `docker logs`. This is the thin-client streaming pattern the later
   parts reuse for daemon/command output.

8. **Workspace data surface (minimal stub)** — the umbrella idea calls for `clientd` to "provide
   agents the data they need to work." Part 1 defines the **shape** only: a `Describe` request →
   `WorkspaceInfo { workspaceId, repoId, branch, parent, head, dirty }` reply that `clientd`
   answers from in-container git. It is a stub proving the request/response direction; consumers
   (the coding agent, the detail UI) are wired in later parts, not here.

## Explicitly out of scope (each its own later feature-idea)

- **Migrating command execution** off `docker exec` — [Part 2](command-execution-over-socket.md).
  `CommandRegistry.dockerExec()` (`:211`) is untouched in Part 1.
- **Container file access** over the socket — [Part 3](container-file-access-over-socket.md).
- **In-container git verbs** (`WorkspaceService.containerGit` `:112`, the initial clone) —
  [Part 4](in-container-git-verbs-over-socket.md).
- **Daemon supervision** (tmux → `clientd`) — [Part 5](daemon-supervision-handover.md).
  `DaemonSupervisor` still uses `containers.startDaemon` etc.
- **MCP termination + token provisioning** — [Part 6](mcp-termination-and-token-provisioning.md).
  `AgentLaunchService` still composes `derivedMcpUrl()` and mounts the shared `HOME` volume.
- **Distributed maintenance** — [Part 7](distributed-maintenance.md).
- **Retiring `DockerExecutor`'s exec/daemon verbs** — the epic's terminal condition, after all
  the above.

## Open decisions (to resolve during Part 1)

- **PID 1 / init duties** — keep Docker's `--init` (tini) in front of `clientd` (simplest;
  `clientd` is just the main child and tini reaps), or make `clientd` itself the reaping init
  (one process, but must handle `SIGCHLD`/zombie reaping and signal forwarding correctly).
  Leaning: **keep `--init`** for Part 1 to avoid reinventing tini; revisit if it complicates the
  daemon-supervision handover (Part 5).
- **"ROOT process" = PID 1, not root user** — the container runs as the host uid today
  (`--user`, `WorkspaceContainerFactory.java:137`) so `/workspace` files are host-owned. `clientd`
  should keep running as that uid. Confirm nothing in the init role needs uid 0 (signal
  forwarding and process management within one uid do not).
- **Transport** — WebSocket-over-qits-HTTP (reuses reachability + port, no new exposure) vs raw
  TCP on a dedicated port (simpler framing, but a new port to publish/route). Leaning WebSocket.
- **Where the protocol records live** — a shared `clientd-protocol` module vs a package in
  `clientd/` indexed by the backend vs in `domain`. Leaning: a tiny framework-free
  `clientd-protocol` jar both sides depend on, so neither `service` nor the binary owns the wire
  contract.
- **Graceful degradation contract** — precisely define backend behaviour when the socket is
  absent/broken: Part 1 requires it to be **exactly today's behaviour** (fall back to
  `docker exec`), which is trivially true because Part 1 wires no real call site. State it here
  so Parts 2+ inherit an explicit "socket down ⇒ fall back to docker exec (until retired)" rule
  during their transition windows.

## Testing

- **Unit** — the protocol records + envelope (framework-free, fast).
- **Backend** — `WorkspaceClientRegistry` handshake/registration with a fake in-JVM socket peer
  (no container).
- **`FakeContainerRuntime` stays green** — Part 1 changes no `ContainerRuntime` call path, so the
  existing suites pass unchanged. `FakeContainerRuntime` emulates the container as a host clone;
  if the extended/real-docker ITs run `clientd` as PID 1, they must still pass with the exec
  paths unchanged (the binary is idle w.r.t. them).
- **Extended IT (`@Tag("extended")`, real docker)** — build the workspace image with `clientd`,
  `docker run` it, assert the handshake lands in the registry and a `RunCommand` round-trips.
  Self-skips when docker/image absent, like the other `*IT`s.
- No behaviour regression is the acceptance bar: the full default suite is identical before/after.
