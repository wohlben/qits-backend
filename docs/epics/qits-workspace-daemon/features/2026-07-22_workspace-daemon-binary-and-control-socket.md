# `workspace-daemon`: the in-container binary + control socket (infrastructure only)

> **Status: implemented (2026-07-22).** New modules `workspace-daemon-protocol/` (the framework-free wire
> contract) and `workspace-daemon/` (the Quarkus command-mode native binary); a backend control-socket route
> `eu.wohlben.qits.workspacedaemonhost` (`DaemonControlSocket` + `WorkspaceDaemonRegistry` + `DaemonMessageCodec`)
> in `service`; the `WorkspaceContainerFactory` now appends **no** container command and injects the
> `QITS_WORKSPACE_DAEMON_*` dial-home env; the `docker/qits/Dockerfile` `workspace-daemon-build` (Mandrel JDK-25) native
> stage compiles the binary as **`qits-workspace-daemon`** and makes it the workspace stage **ENTRYPOINT** at
> `/usr/local/bin/qits-workspace-daemon` (replacing `sleep infinity`); the framework-free
> `WorkspaceDaemonLiveness` SPI observed (log-only) in `WorkspaceService.ensureContainer`; and
> `/api/workspace-daemon/` added to `PublicPaths`. Behaviour-neutral: the full default suite passes unchanged.
> The "Open decisions" below are recorded as resolved.

## Introduction

Part 1 of [qits-workspace-daemon](../epic.md) — and the **only in-scope part**. It stands up the
infrastructure every later refactoring needs, and **nothing more**: a compiled binary that
becomes each workspace container's init (PID 1), a persistent bidirectional socket back to the
qits backend, a lifecycle handshake, and one generic "take this action" message proven
end-to-end. It **migrates no existing call site** — the current host-driven `docker exec` paths
keep running, untouched, alongside `workspace-daemon`. When this lands, qits *can* send a command to the
in-container client and get output back; the parts that follow move real subsystems (command
execution, file access, git verbs, daemons, MCP, maintenance) onto that seam.

> **This is the foundation, not the payoff.** The temptation is to migrate a real call site "for
> free" while we're here. Don't. Part 1's value is that it changes **zero** behaviour and can
> ship dark (the binary runs as PID 1, holds the socket open, and is otherwise idle). Every
> behaviour change is a later, independently-reviewable part. Keeping Part 1 behaviour-neutral is
> what makes the later migrations safe to land one at a time.

Related/dependent plans:

- **Parent epic** — [qits-workspace-daemon](../epic.md); this part unblocks all of Parts 2–7.
- **Builds on [lazy workspace container provisioning](../../qits-workspaces/features/2026-07-08_lazy-workspace-container-provisioning.md)** —
  the container command and provisioning flow this part changes live in
  `WorkspaceService.provisionContainer` (`:182`) and `WorkspaceContainerFactory` (the run argv,
  `sleep infinity` command at `WorkspaceContainerFactory.java:198`).
- **Reuses [qits-net / devcontainer reachability](../../qits-live-deployment/features/2026-07-07_qits-net-devcontainer-unification.md)** —
  `workspace-daemon` dials the backend at the address `QitsHostResolver.qitsHost()` (`:53`) already
  resolves for clone/OTLP/MCP URLs. No new reachability model; the socket rides the same host.
- **Consistent with the [cli](../../../../CLAUDE.md) command-mode module** — `workspace-daemon` is a
  second `@QuarkusMain` app like `cli/`, but native-compiled and web-stack-free.
- **Precedent for behaviour-neutral staging** — like
  [workspace-bootstrap-commands](../../qits-workspaces/features/2026-07-18_workspace-bootstrap-commands.md)
  hooked the container lifecycle without disturbing daemon auto-start, this part hooks PID 1
  without disturbing the exec paths.

## The binary

A new Maven module **`workspace-daemon/`** (group `eu.wohlben`, package `eu.wohlben.qits.workspacedaemon`):

- A Quarkus **command-mode** app (`@QuarkusMain` in `eu.wohlben.qits.workspacedaemon.Main`), **no web
  stack** — like `cli/`, but built to a **GraalVM native binary** (`-Dnative`) so the container
  ships a single static-ish executable, not a JVM launch. (The workspace image already carries a
  JDK for the coding agent's tools; `workspace-daemon` is native specifically so PID 1 starts instantly
  and carries no JVM warm-up or heap baseline.)
- Depends on **neither `service` nor `auth/*`**. It may depend on `domain` **only** for shared
  protocol records if we put them there; the preferred split is a tiny framework-free
  **`workspace-daemon-protocol`** carrier (or a package inside `workspace-daemon/` that the backend also indexes)
  holding the wire envelope records, so backend and binary share one definition. **Open
  decision** (below): where the shared protocol type lives.
- Runs as the container's **init (PID 1)**: it replaces `sleep infinity` as the container
  command, so it must do the init job — **reap zombies and forward signals** to its children
  (today handled by Docker's `--init`/tini shim; `workspace-daemon` either keeps `--init` in front of it
  or does the reaping itself — open decision below).

## What Part 1 changes

1. **New `workspace-daemon/` module** — Quarkus command-mode, native build profile, its own
   `application.properties` with the socket/backend config. Added to the reactor; the Maven
   build-cache treats it like any module. It needs **no `-Dqits.variant`** (no auth, no service).

2. **Dockerfile workspace stage** (`docker/qits/Dockerfile`) — a `workspace-daemon-build` builder stage
   native-compiles the binary as **`qits-workspace-daemon`** (Maven `quarkus.package.output-name=qits-workspace-daemon`
   + `add-runner-suffix=false`) and `COPY`s it to `/usr/local/bin/qits-workspace-daemon`. The workspace stage
   gets an **`ENTRYPOINT ["/usr/local/bin/qits-workspace-daemon"]`** so a plain `docker run <image>` starts the
   client; `WorkspaceContainerFactory` stops appending `sleep infinity` and appends **no** command at
   all (the image ENTRYPOINT is the single source of truth). (The **prod app image**'s final stage
   overrides `ENTRYPOINT` with `java -jar`, so it is unaffected.)

3. **`workspace-daemon` boot → control socket** — on start, `workspace-daemon` reads its identity from the
   container environment/labels (`qits.workspace.id`, `qits.repository.id`, branch, parent —
   already set as labels by `WorkspaceContainerFactory.java:139-142` and available as env), then
   **dials the backend and opens a persistent bidirectional socket**. Transport reuses the
   existing qits HTTP reachability (`QitsHostResolver.qitsHost()` + `qits.workspace.qits-port`)
   — **WebSocket over the qits HTTP port** is the leading candidate (works through the same
   `qits-net` DNS / `host.docker.internal` path as `/git`, `/api/otel`, `/mcp`, and needs no new
   exposed port), with raw TCP as the fallback (open decision below). A new backend route (in
   `service`, `eu.wohlben.qits.workspacedaemonhost` or similar) accepts the connection and registers it
   in an app-scoped **`WorkspaceDaemonRegistry`** keyed by workspaceId.

4. **Lifecycle handshake** — on connect, `workspace-daemon` sends a `HELLO` (identity + capability
   version) and the backend acknowledges. The registry now knows the workspace's client is live.
   `WorkspaceService.ensureContainer` (`:833`/`:878`) **additionally** observes this handshake as
   a liveness signal — but Part 1 **does not** replace the existing reconciliation ladder
   (`isRunning` label poll `:891`, start-in-place `:913`, materialize-from-ref `:948`); the
   handshake is recorded alongside, informational, so nothing regresses if the socket is absent
   (older images, or the binary crashing). A missing/broken socket must degrade to exactly
   today's behaviour.

5. **The action-message envelope** — define the wire contract: a small set of framework-free
   records for qits→`workspace-daemon` requests and `workspace-daemon`→qits events/streams. Minimum for Part 1:
   - `RunCommand { correlationId, argv[], cwd, env{} }` → streamed `CommandChunk { correlationId,
     stream(STDOUT|STDERR), bytes }` → `CommandExit { correlationId, exitCode }`.
   - `Hello`/`Ack`, `Heartbeat`, and `DaemonLog` (workspace-daemon's own logs).
   This is the seam Parts 2–6 extend (add `ReadFile`/`WriteFile`, `StartDaemon`/`SignalDaemon`,
   `OpenMcp`, …). Part 1 defines only what it needs to prove the transport.

6. **Prove one command end-to-end** — a single backend-initiated `RunCommand` (e.g. `echo` /
   `git rev-parse HEAD`) sent over the socket, executed by `workspace-daemon` in the container, streamed
   back, and asserted. This is a **demonstration/integration test**, not a wiring of any real
   call site — `CommandRegistry`, `WorkspaceService.containerGit`, `ContainerFileAccess`, and
   the daemon paths all still shell `docker exec` exactly as before.

7. **`workspace-daemon` streams its own logs** — as a thin client, `workspace-daemon` sends its stdout/stderr and
   structured events home over the socket (`DaemonLog`), so a crashing or misbehaving client is
   visible in qits without `docker logs`. This is the thin-client streaming pattern the later
   parts reuse for daemon/command output.

8. **Workspace data surface (minimal stub)** — the umbrella idea calls for `workspace-daemon` to "provide
   agents the data they need to work." Part 1 defines the **shape** only: a `Describe` request →
   `WorkspaceInfo { workspaceId, repoId, branch, parent, head, dirty }` reply that `workspace-daemon`
   answers from in-container git. It is a stub proving the request/response direction; consumers
   (the coding agent, the detail UI) are wired in later parts, not here.

## Explicitly out of scope (each its own later feature-idea)

- **Migrating command execution** off `docker exec` — [Part 2](command-execution-over-socket.md).
  `CommandRegistry.dockerExec()` (`:211`) is untouched in Part 1.
- **Container file access** over the socket — [Part 3](container-file-access-over-socket.md).
- **In-container git verbs** (`WorkspaceService.containerGit` `:112`, the initial clone) —
  [Part 4](in-container-git-verbs-over-socket.md).
- **Daemon supervision** (tmux → `workspace-daemon`) — [Part 5](daemon-supervision-handover.md).
  `DaemonSupervisor` still uses `containers.startDaemon` etc.
- **MCP termination + token provisioning** — [Part 6](mcp-termination-and-token-provisioning.md).
  `AgentLaunchService` still composes `derivedMcpUrl()` and mounts the shared `HOME` volume.
- **Distributed maintenance** — [Part 7](distributed-maintenance.md).
- **Retiring `DockerExecutor`'s exec/daemon verbs** — the epic's terminal condition, after all
  the above.

## Decisions (resolved as-built)

- **PID 1 / init duties — kept Docker's `--init` (tini).** `WorkspaceContainer.toRunArgv()` still
  emits `--init`, so tini stays PID 1 and `workspace-daemon` is its direct child; tini reaps zombies (it will
  matter once `RunCommand`'s `ProcessBuilder` children exist in Part 2) and forwards signals.
  `workspace-daemon` does not reinvent init. Revisit only if the daemon-supervision handover (Part 5) needs it.
- **"ROOT process" = PID 1, not root user — unchanged.** The container still runs as the host uid
  (`--user`); `workspace-daemon` runs as that uid. Signal forwarding and process management within one uid
  need no uid 0, confirmed.
- **Transport — WebSocket over the qits HTTP port.** A plain `ws://` connection to
  `/api/workspace-daemon/{workspaceId}` on the existing port, reached the same way `/git`, `/api/otel`, `/mcp`
  are (qits-net DNS / `host.docker.internal`); no new exposed port, no TLS. The backend endpoint is a
  `quarkus-websockets-next` `@WebSocket`; `workspace-daemon` uses the Vert.x-core `WebSocketClient` (via
  `quarkus-vertx`, which starts no HTTP server). `/api/workspace-daemon/` is token-free in `PublicPaths`, and
  `SameOriginUpgradeCheck` already permits the Origin-less native client.
- **Protocol records — a tiny framework-free `workspace-daemon-protocol` jar.** Both `service` and `workspace-daemon`
  depend on it; it holds the message records, the `DaemonMessage` sealed interface, the type/field
  constants, and a `Map`-based `DaemonCodec`. Each side bridges the map to its own JSON library
  (`service` → Jackson, `workspace-daemon` → Vert.x `JsonObject`), so neither owns the wire contract.
- **Graceful degradation contract — socket down ⇒ exactly today's behaviour.** Trivially true in
  Part 1 (no real call site is wired). Enforced structurally by `workspace-daemon` **never exiting on a
  connection error** (unbounded capped-backoff reconnect; a missing/malformed dial-home URL just
  logs and idles), so the container stays alive exactly as `sleep infinity` did and every existing
  `docker exec` path is untouched. Parts 2+ inherit the explicit rule: **socket down ⇒ fall back to
  `docker exec` (until that verb is retired).**

## No daemon ⇒ no workspace (intentional fail-fast, no keep-alive fallback)

The container runs **only** `qits-workspace-daemon` (the image ENTRYPOINT); qits appends no `docker
run` command and there is **deliberately no `sleep infinity` fallback**. This is a design invariant,
not an oversight: a workspace container that stays alive *without* the daemon never sends `HELLO`, so
qits has no control socket to it — and once the later parts move command/file/git/MCP execution onto
the daemon, such a container is an **unmanaged shadow** running with qits' uid, mounts and network
but outside qits' control plane. Keeping it alive (as the old `sleep infinity` did) would manufacture
exactly that. So the launch path fails closed: **a container that cannot run the daemon exits rather
than lingering.**

Concretely, the only way the daemon binary is absent is a **stale `qits/workspace` image** (built
before this change) — the Dockerfile `COPY` is unconditional, so any freshly built image always
carries it, and a failed native build produces no image at all. Against a stale image, `docker run`
exits immediately and the workspace surfaces as not-running, which is the correct signal to rebuild
the image (qits' app image is `FROM workspace`, so a normal deploy rebuilds both from the same
commit). The informational `WorkspaceDaemonLiveness` handshake recorded in Part 1 is the seam by
which later parts will make this authoritative — treating a container that never handshakes as an
invalid workspace to reap, not a live one.

## As-built notes / deviations

- **`workspace-daemon` depends on neither `service` nor `domain`** — only `workspace-daemon-protocol` +
  `quarkus-arc`/`quarkus-vertx` — to keep the native image lean and `-am` cheap. The
  `Describe`→`WorkspaceInfo` reply carries no correlation id in Part 1 (single in-flight stub);
  add one when a real consumer needs concurrent describes.
- **Native builder image — confirmed to exist.** The `workspace-daemon-build` stage uses
  `quay.io/quarkus/ubi9-quarkus-mandrel-builder-image:jdk-25` (native-image must match the JDK-25
  reactor bytecode). **Mandrel 25 is published** (verified: `mandrel-25.0.3.0-Final`, `native-image
  25.0.3` on JDK 25 compiles `workspace-daemon` end-to-end). The Oracle GraalVM `native-image:25` image is a
  drop-in fallback if the quay tag ever lags.
- **Config bug found by the native run (fixed).** `workspace-daemon`'s identity `@ConfigProperty`s were
  `defaultValue = ""` on plain `String`s; SmallRye treats an empty default as *no value*, so a
  `workspace-daemon` booted without the `QITS_WORKSPACE_DAEMON_*` env failed to resolve them and did not stay alive.
  They are now `Optional<String>` resolved to `""` (the same reason `WorkspaceContainerFactory
  .timezone` is `Optional`). Verified in both JVM and native boot. No JVM unit test caught this
  because they never boot the `workspace-daemon` app itself — the native smoke run did.
- **Native memory.** On a memory-constrained builder (a ≤4 GiB cgroup), pass
  `-Dquarkus.native.additional-build-args=--parallelism=1`; single-threaded codegen keeps peak RSS
  ~2.2 GB. The default (unconstrained) build needs no such flag.
- **Workspace image gains a C/build toolchain.** `docker/qits/Dockerfile`'s `workspace` stage now
  installs `build-essential` + `pkg-config` + `zlib1g-dev` + `libssl-dev` so workspace containers can
  compile native dependencies (node-gyp, Python C-extensions, cgo, native-image links) by default —
  previously the slim base had no compiler. This is independent of `workspace-daemon` (which is cross-built in
  the `workspace-daemon-build` stage and only copied in), but belongs with this change as the workspace
  toolchain baseline.
- **Latent test fix carried in.** The extended real-docker ITs (`WorkspaceContainerIT`,
  `WorkspaceWatchIT`, `ContainerFileBrowserIT`) manually seed `WorkspaceContainerFactory` and did
  not set the `memoryLimit`/`pidsLimit`/`cpus` Optionals added by the 2026-07-21 memory-cap change —
  a latent NPE reachable only under `-Pextended`. They now seed those (and the new
  `qitsHostResolver`/`qitsPort`) so `forWorkspace` runs.

## Testing

- **Unit** — the protocol records + envelope (framework-free, fast).
- **Backend** — `WorkspaceDaemonRegistry` handshake/registration with a fake in-JVM socket peer
  (no container).
- **`FakeContainerRuntime` stays green** — Part 1 changes no `ContainerRuntime` call path, so the
  existing suites pass unchanged. `FakeContainerRuntime` emulates the container as a host clone;
  if the extended/real-docker ITs run `workspace-daemon` as PID 1, they must still pass with the exec
  paths unchanged (the binary is idle w.r.t. them).
- **Extended IT (`@Tag("extended")`, real docker)** — `DaemonControlSocketIT` builds the workspace
  image with `workspace-daemon`, `docker run`s it, and asserts the handshake + a `RunCommand` round-trip over
  the socket (using a standalone Vert.x server as the backend stand-in). Self-skips when docker/image
  absent, like the other `*IT`s.
- No behaviour regression is the acceptance bar: the full default suite is identical before/after.

### As-run verification (2026-07-22)

All JVM suites green: `workspace-daemon-protocol` (12), `workspace-daemon` (4), `domain` factory/container (11),
`auth/core` `PublicPaths` (8), `service` `DaemonControlSocketTest` (4 — handshake+`Ack`+liveness,
`RunCommand` round-trip, `Describe`→`WorkspaceInfo`, teardown prune), `WorkspaceActiveProcessTest`
(3, provisioning regression), `cli` (3, optional `Instance<>` empty). The `service`/`domain` runs
used an isolated git worktree so a live `quarkus:dev` on the tree was not disturbed.

The **native path was fully exercised** (Mandrel 25.0.3, JDK 25): `workspace-daemon` native-compiles clean
through all 8 build phases; the binary boots in **~0.009s**, logs the idle warning and **stays
alive** with no dial-home URL (the never-exit guarantee), and — pointed at a Vert.x WebSocket
server — dialed home, sent `HELLO`, received a `RunCommand`, executed it, and streamed back
`exit=0`. The real-docker image build + extended IT still need a host with a container runtime.
