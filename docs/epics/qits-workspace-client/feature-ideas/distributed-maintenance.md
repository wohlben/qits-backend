# Distributed maintenance driven through `clientd`

## Introduction

Part 7 of [qits-workspace-client](../epic.md). **Out of scope until
[Part 1](clientd-binary-and-control-socket.md) lands** (and after the execution/daemon parts).
Moves the periodic and housekeeping work qits performs *against* a workspace container — today
host-scheduled and executed via `docker exec` — into `clientd`, which runs it locally on socket
instruction (or on its own schedule, reporting home). This is the "distributed maintenance" the
umbrella idea named: each container maintains itself, coordinated by qits, rather than qits
reaching into every container from one host scheduler.

Related/dependent plans:

- **Hard dependency** — [Part 1](clientd-binary-and-control-socket.md); builds on the
  execution ([Part 2](command-execution-over-socket.md)), git
  ([Part 4](in-container-git-verbs-over-socket.md)), and daemon
  ([Part 5](daemon-supervision-handover.md)) parts it consolidates.
- **Consolidates** the scattered periodic host-side jobs, e.g.
  [periodic checkpoint push](../../qits-workspaces/features/2026-07-05_periodic-checkpoint-push.md)
  (`WorkspaceCheckpointService`, `qits.workspace.checkpoint-interval-ms`), the daemon straggler
  reap (`DaemonSupervisor.reapStragglers` `:723`), and health probing (`HealthProbeService`).

## The current surface (what moves)

- **Periodic checkpoint push** — `WorkspaceCheckpointService` (host timer,
  `qits.workspace.checkpoint-interval-ms`, `service:81`) fetches HEAD and pushes via
  `docker exec git`. Becomes a `clientd` local task (ties to
  [Part 4](in-container-git-verbs-over-socket.md)).
- **Straggler reaping** — `reapStragglers()` scanning `/proc` (Part 5 already folds this into
  `clientd` as PID 1); listed here as maintenance for completeness.
- **Health probing** — `HealthProbeService` (`qits.daemons.*` poll knobs) polls in-container; can
  push from `clientd` instead of host poll.
- **Cache hygiene** — the shared maven/pnpm/claude cache volumes accumulate; `clientd` can prune
  on instruction.

## Scope

- A `Maintenance { kind }` instruction + scheduled local tasks in `clientd`, reporting outcomes
  over the socket. Move checkpoint push, health, and cache hygiene off host-scheduled
  `docker exec`.
- Preserve the existing intervals/knobs as configuration `clientd` honors (or that qits sends on
  the socket), and the checkpoint-push semantics exactly.

## Out of scope

- The earlier parts' primitives (execution/file/git/daemon/MCP) — this part *uses* them.

## Testing

- Scheduled task fires and reports; checkpoint push still produces the same origin-side commits;
  regression on `WorkspaceCheckpointService` and health behaviour.

---

*After this part, together with Parts 2–6, `DockerExecutor` retains only `run`/`start`/`stop`/
`rm`/network — the epic's terminal condition (see [epic.md](../epic.md)).*
