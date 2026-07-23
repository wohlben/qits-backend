# Epic: qits-workspace-daemon — the in-container `workspace-daemon` control plane

## Introduction

Today qits drives every workspace container **from the host, by shelling `docker`**: it runs
`docker exec` for every command (git verbs, action scripts, the coding agent, daemon launches),
reads and writes files with `docker exec cat`/`tar`, mirrors daemon logs by tailing files inside
the container, kills process groups by reading pid files, and reaps escaped forks by scanning
`/proc`. The container itself has **no process of its own**: it runs `--init` + `sleep infinity`
(`WorkspaceContainerFactory` seeds the run argv, command at `WorkspaceContainerFactory.java:198`),
a passive box that only exists to be `docker exec`'d into.

This epic replaces that model. It introduces **`workspace-daemon`** — a single compiled binary (Quarkus
command-mode, GraalVM native) that becomes each workspace container's **init (PID 1)**, opens a
**persistent bidirectional control socket** to the qits backend, and — part by part — **takes
over every interaction qits performs against the container**. qits stops shelling `docker exec`
and instead **sends a message to `workspace-daemon`**, which performs the action in-container and streams
results home. `workspace-daemon` terminates MCP for the workspace locally (provisioning the necessary
tokens), supervises the workspace's daemons, provides the coding agent the data it needs, and
runs distributed maintenance — while the host-side threads that used to shell docker become
**thin clients** that still stream their logs/data to the qits backend, just over the socket
instead of over a `docker exec` pipe.

The deliverable is the container's own qits-side **control plane**: the reachability model
inverts from "host reaches in with the docker CLI" to "the container dials home and qits speaks
to it." The docker CLI shrinks back to what only the host can do — create, start, stop, and
remove the container.

**This epic is deliberately staged. Only Part 1 (the infrastructure) is in scope now**; every
subsequent migration is its own feature-idea, explicitly out of scope until Part 1 lands. Part 1
stands up `workspace-daemon`, its socket, its lifecycle handshake, and the generic command-routing seam —
and proves one command end-to-end — **without changing any existing behaviour**: the current
`docker exec` paths keep running untouched alongside it. The later parts move one subsystem at a
time onto the socket, each removing its slice of the docker-CLI surface.

### The natural replacement boundary

The whole surface funnels through **one interface**,
`repository.control.ContainerRuntime` (impl `DockerExecutor`), with a `FakeContainerRuntime`
test double already in each module's `src/test` — a clean seam confirming the migration can land
verb by verb behind a stable API. `workspace-daemon` is, in effect, the eventual *second implementation*
of that interface's exec/daemon/file verbs, reached over the socket instead of the docker CLI.

### Builds on / cross-cutting concerns

- **Builds on [qits-workspaces](../qits-workspaces/epic.md)** — the container model, lazy
  provisioning (`WorkspaceService.ensureContainer` `:833`/`:878`, `provisionContainer` `:182`),
  the `ContainerRuntime` seam, and `QitsHostResolver` reachability (`QitsHostResolver.java:53`)
  are exactly what `workspace-daemon` re-homes onto a socket. `workspace-daemon` becomes the container's PID 1,
  replacing `sleep infinity`.
- **Re-homes [qits-workspace-commands](../qits-workspace-commands/epic.md)** — the command
  substrate's single `docker exec` seam (`CommandRegistry.dockerExec()` `:211`, fed by
  `CommandService.prepare()` `:515`) is the first real call site to route through `workspace-daemon`
  (Part 2). The re-attach model and interaction log are unchanged; only the transport moves.
- **Re-homes [qits-workspace-daemons](../qits-workspace-daemons/epic.md)** — the tmux-backed
  `DaemonSupervisor` (`launch` `:435`, log-mirror follower `:496`, `/proc` straggler reap
  `:723`, liveness poll `:591`, pid-group kill) collapses into `workspace-daemon`-owned supervision
  (Part 5). `workspace-daemon` streams daemon logs home as a thin client.
- **Re-homes MCP + credentials for [qits-coding-agents](../qits-coding-agents/epic.md)** —
  `workspace-daemon` **terminates** the agent's MCP connection inside the container and provisions the
  tokens, replacing the per-URL `AgentLaunchService.derivedMcpUrl()` `:759` + shared-`HOME`
  credential-volume model (`withAgentHome()` `:689`, `docker/workspace/agent-login.sh`) with
  caller-bound credentials handed over the control socket (Part 6). Ties to
  [qits-tokens](../qits-tokens/epic.md) / the `scoped-tokens` draft.
- **Feeds [qits-observability](../qits-observability/epic.md)** — daemon/command logs and OTLP
  today reach the backend over per-URL HTTP composed via `QitsHostResolver`
  (`OtelEnvironment.forLaunch()` `:35`). Under `workspace-daemon` the streaming inverts to the socket,
  with `workspace-daemon` as the thin-client relay.

### Scope rule

This epic owns **the `workspace-daemon` binary, its control socket/transport, its lifecycle role as the
container's PID 1, and the progressive migration of each host-driven `docker exec`/file-access
path onto the socket.** It does **not** redefine the domains it re-homes — a daemon is still a
`CommandSession`, a workspace is still a branch ref + a container, MCP scopes are still the
same. It changes **how qits talks to the container**, not what the container runs.

## Terminology

- **`workspace-daemon`** — the workspace **client daemon**: the in-container binary, PID 1, the qits-side
  control plane. Distinct from the host-side `DaemonSupervisor` (which manages *dev-server*
  daemons — and, from Part 5, delegates into `workspace-daemon`). "ROOT process" means **PID 1 / init**
  (the root of the container's process tree), not the root *user*: the container keeps running
  as the host uid to preserve `/workspace` ownership (see the Part-1 draft's open decision).
- **Control socket** — the persistent bidirectional channel `workspace-daemon` opens to the backend on
  boot. Carries qits→`workspace-daemon` action messages and `workspace-daemon`→qits events/streams.
- **Thin client** — a host-side thread that used to shell `docker exec` and now sends a message
  over the socket; it still owns the qits-side bookkeeping (registry entry, log persistence),
  it just no longer touches docker.

## Parts (implementation order)

### Part 1 — infrastructure only (IN SCOPE NOW)

- **[workspace-daemon-binary-and-control-socket](features/2026-07-22_workspace-daemon-binary-and-control-socket.md)**
  (**implemented 2026-07-22**) —
  the new `workspace-daemon/` Quarkus command-mode module compiled to a native binary; the Dockerfile
  workspace stage builds/ships it and the container command becomes `workspace-daemon` (PID 1, replacing
  `sleep infinity`); `workspace-daemon` dials home and establishes the bidirectional control socket;
  qits learns liveness from the handshake; the generic action-message envelope is defined and
  **one** trivial command is proven end-to-end over the socket. **No existing call site is
  migrated** — the `docker exec` paths keep running untouched; the suite (incl.
  `FakeContainerRuntime`) stays green. This part builds the *capability and transport*; the
  later parts move real subsystems onto it.

### Later parts (OUT OF SCOPE until Part 1 lands — each its own feature-idea)

Ordered by dependency; each removes its slice of the docker-CLI surface.

- **[command-execution-over-socket](feature-ideas/command-execution-over-socket.md)** (Part 2) —
  route `CommandRegistry.dockerExec()` (`:211`, both the pty4j interactive and pipe stream-json
  shapes) and `CommandService.prepare()` (`:515`) through `workspace-daemon` instead of `docker exec -i`;
  the pid-file group-kill dance (`CommandSession.killGroup()` `:226`) becomes an in-`workspace-daemon`
  process-group manager. The single biggest call site.
- **[container-file-access-over-socket](feature-ideas/container-file-access-over-socket.md)**
  (Part 3) — replace `ContainerFileAccess` (`docker exec cat`/`tar`; there is **no** `docker
  cp`) with socket read/write/list. This is the "docker copy" replacement the umbrella idea
  named, reframed to the real surface.
- **[in-container-git-verbs-over-socket](feature-ideas/in-container-git-verbs-over-socket.md)**
  (Part 4) — delegate `WorkspaceService.containerGit()` (`:112`; fetch/ff-only/merge/push,
  `git rev-parse HEAD`, submodule wiring, and the initial `git clone --branch` in
  `provisionContainer` `:201`) to `workspace-daemon`, removing the host-side `docker exec git …` paths.
- **[daemon-supervision-handover](feature-ideas/daemon-supervision-handover.md)** (Part 5) —
  daemons run under `workspace-daemon` (replacing the tmux sessions, the log-mirror follower, the
  `/proc` straggler reap, the liveness poll, and the pid-group kill). `DaemonSupervisor`
  becomes a thin host-side coordinator; `workspace-daemon` owns the in-container processes and streams
  their logs home. Auto-start/auto-stop coupling to the workspace lifecycle is unchanged.
- **[mcp-termination-and-token-provisioning](feature-ideas/mcp-termination-and-token-provisioning.md)**
  (Part 6) — `workspace-daemon` becomes the MCP endpoint the agent talks to inside the container
  (terminating the connection locally), provisions the per-scope tokens, and authorizes back to
  qits over the control socket — replacing `derivedMcpUrl()` (`:759`) and the shared-`HOME`
  credential volume with caller-bound credentials. Depends on Part 2 (agent launches ride the
  command path) and dovetails with [qits-tokens](../qits-tokens/epic.md).
- **[distributed-maintenance](feature-ideas/distributed-maintenance.md)** (Part 7) — `workspace-daemon`
  runs the periodic/maintenance work locally (checkpoint push, straggler reaping, cache
  hygiene, health probes) on socket instruction instead of host-scheduled `docker exec`.

### Cross-cutting evolution (candidate to restructure the later parts)

- **[daemon-self-provisioning-and-file-only-config](feature-ideas/daemon-self-provisioning-and-file-only-config.md)**
  — instead of qits driving clone/bootstrap/daemon-start over the socket verb by verb (Parts 4+5),
  the daemon **self-provisions from its start-time env** (`QITS_WORKSPACE_DAEMON_*`, already shipped
  in Part 1): on boot it clones `/workspace`, reads `.qits-config.yml` **from the checkout**, runs
  bootstrap, and starts the dev daemons — autonomously. It also inverts the config source-of-truth
  (the committed file becomes authoritative; the UI writes back to it; the DB store degrades to a
  derived projection). This is a *different control model* (daemon-autonomous vs qits-instructed)
  than Parts 4/5 assume, so it's tracked as a candidate to **reframe those parts** — or spin its own
  epic — rather than a slot-in part. Read it before designing Parts 4/5.

### Terminal condition (eventual, tracked here — not its own part yet)

Once Parts 2–7 land, `DockerExecutor` shrinks to `run`/`start`/`stop`/`rm`/network; every
`exec`/daemon/file verb on `ContainerRuntime` is gone, and the only host→container shell is
**container creation**. The reachability model has fully inverted: the container dials home, and
qits speaks to it over the socket. That collapse is the epic's definition of done.

## Status

- Part 1 — **implemented (2026-07-22).** `workspace-daemon-protocol/` + `workspace-daemon/` modules, the backend
  control-socket route (`eu.wohlben.qits.workspacedaemonhost`), the `WorkspaceContainerFactory` command swap
  + `QITS_WORKSPACE_DAEMON_*` dial-home env, the Dockerfile `workspace-daemon-build` native stage, and the log-only
  `WorkspaceDaemonLiveness` observation in `WorkspaceService`. Behaviour-neutral: the default suite
  passes unchanged; `workspace-daemon` ships dark (holds the socket open, migrates no `docker exec` call
  site). See [the feature](features/2026-07-22_workspace-daemon-binary-and-control-socket.md).
- Parts 2–7 — **drafts, parked.** Out of scope; now unblocked by Part 1.
