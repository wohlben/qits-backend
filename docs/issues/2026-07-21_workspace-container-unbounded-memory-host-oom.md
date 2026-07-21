# Workspace containers run with no memory limit — a dev daemon can OOM the whole host

## Introduction

Related plans:

- `docs/epics/qits-workspaces/features/2026-07-04_workspace-containers.md` — the per-workspace container execution model this issue lives in.
- `docs/epics/qits-workspaces/features/2026-07-08_lazy-workspace-container-provisioning.md` — where containers are materialized (`WorkspaceService.ensureContainer`).
- `docs/epics/qits-observability/` — the telemetry/log paths audited below (all found bounded).

## Observed

Starting a workspace and running its dev daemon (the `quarkus:dev` + Angular dev-server
daemon of the webapp fixture) reliably drives the **entire host** out of memory — a full
server crash / freeze, not just one process. It only happens while the dev daemon is
running.

## Suspected cause

`WorkspaceContainerFactory.forWorkspace` (`domain/src/main/java/eu/wohlben/qits/domain/repository/control/WorkspaceContainerFactory.java:106`)
builds the complete `docker run` argv, and it sets **no resource limits whatsoever** — no
`--memory`, no `--memory-swap`, no `--pids-limit`, no `--cpus`. `DockerExecutor.run` only
prepends `docker run` and executes it.

That interacts badly with how JVMs size themselves. With no cgroup memory limit, each JVM
inside the container sees the **whole host's RAM** and defaults its max heap to 25% of it
(`MaxRAMPercentage`). A dev daemon means at least:

- the Maven launcher JVM (`./mvnw quarkus:dev`) — up to 25% of host RAM,
- the forked Quarkus dev-mode application JVM — another 25%,
- the Angular dev server (node/vite watcher; node's old-space cap is ~4 GB and pnpm
  install spikes on top),

plus qits' own dev JVM in the devcontainer (another 25% default). None of these are wrong
individually — they are each sizing against "available" memory that is in reality shared
and already spoken for. Under WSL2 the effect is worse: the WSL2 VM gets a fixed memory
slice, and exhausting it hard-freezes the whole VM ("full-on crash, not just the
process").

## Ruled out (in-memory stores audited, all bounded)

- `TelemetryStore` (`service/.../telemetry/control/TelemetryStore.java`) — per-workspace
  count caps + a 64 MB global byte ceiling with fattest-bucket eviction.
- `CommandSession` ring buffer — 256 KB cap, 16 KB per-line cap.
- `TechnicalProcess` segments — 64 KB head + 192 KB tail caps.
- `TailSink` — 40 lines / 2000 chars.

Two unbounded-but-secondary growths worth noting (not the crash driver):

- `CommandLogService.queue` is an unbounded `LinkedBlockingQueue` — heap only grows if H2
  persistence falls behind a chatty daemon; a cap (drop-oldest + warn) would make it
  strictly safe.
- Every daemon output line is persisted to H2 (`command_log_line`) with no retention, and
  the tmux mirror log (`/tmp/qits-daemons/<id>.log` in the container) only truncates on
  (re)start — both are **disk** growth, unbounded over a long-lived daemon.

## Suggested fix direction

Add opt-out resource limits to `WorkspaceContainerFactory`:

- `qits.workspace.memory-limit` (e.g. default `4g`) → `--memory` (+ `--memory-swap` set
  to the same value so the container can't swap-thrash the host). Since
  `UseContainerSupport` is default, every JVM inside then sizes its heap against the
  cgroup limit automatically — no per-tool `-Xmx` plumbing needed.
- Optionally `qits.workspace.pids-limit` → `--pids-limit` (fork-bomb guard) and
  `qits.workspace.cpus` → `--cpus`.

Blank config value disables the flag, matching the volume-mount pattern already in the
factory. `FakeContainerRuntime`-based tests are unaffected (no real `docker run`).
