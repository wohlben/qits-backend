# Periodic checkpoint-push: bound the unpushed-work loss window

## Introduction

Follow-up to [disposable workspace containers](2026-07-04_disposable-workspace-containers.md),
which made a lost container a non-event by recreating it from the durable branch — but recreation
restores **origin state only**, so commits made in a container and never pushed die with it. That
feature closes the *graceful* case (the live-container guard + `stopContainer` pushing before
removal); this one closes the *ungraceful* case (host reboot, `docker rm`, a crash) by periodically
pushing each running container's branch to origin, so an unexpected death loses at most one
interval of committed work.

Related / dependent plans:

- **Parent feature**: [disposable-workspace-containers](2026-07-04_disposable-workspace-containers.md)
  — this implements the "§D checkpoint-push" open question it explicitly deferred. Reuses that
  feature's `pushBranch` helper and the durable-branch-is-truth model.
- Builds on the container lifecycle from
  [workspace-containers](2026-07-04_workspace-containers.md) (the `docker exec … git push` path
  over the in-process `/git` server).
- Interacts with the **ahead/behind** UI from
  [repository-discovery](../../qits-project-repositories/features/2026-05-01_repository-discovery.md): checkpoint pushes move the origin
  ref, so a branch's ahead count drops to 0 right after a sweep — expected, not a bug.

## What was implemented

`WorkspaceCheckpointService` (`domain`, `repository.control`) — an `@ApplicationScoped` bean with a
single-thread daemon `ScheduledExecutorService` (the hand-rolled `DaemonSupervisor` pattern; no
quarkus-scheduler dependency). On `StartupEvent` it schedules a fixed-delay sweep every
`qits.workspace.checkpoint-interval-ms`; `0` disables it entirely.

Each sweep (`checkpointAll()`, also callable synchronously — the test seam):

1. **Enumerates repos from the filesystem** — data-dir subdirs containing an `origin/`, the same
   rule `RepositoryDiscoveryService.discover` uses. The sweep is deliberately **DB-free** (branches
   come from the containers' create-time `qits.branch` labels via `listWorkspaceContainers`), so
   the scheduler thread needs no request context or transaction.
2. **Only running containers**: a container in `listWorkspaceContainers` *is* the live definition
   of RUNNING (the persisted `runtimeStatus` is recomputed from this same listing elsewhere).
3. **Pushes only when ahead**: skips a container whose HEAD equals the origin ref
   (`WorkspaceService.isFullyPushed` — the same probe `canCleanupBranch` uses), so idle containers
   never churn origin refs or flicker the ahead/behind UI.
4. **Best-effort throughout**: pushes via `WorkspaceService.pushBranch` (the same plain
   `git push origin <branch>` as `stopContainer` — never force-push; the ref only moves forward
   while a single container owns the branch). A per-container catch keeps one failure from
   aborting the sweep, and the tick itself swallows everything — an uncaught exception would
   silently cancel a `scheduleWithFixedDelay` timer.

`checkpointAll()` returns a `CheckpointSummary(pushed, skipped)` record — the observable outcome of
a sweep (and the only reliable "no push happened" oracle in tests).

### Resolved open questions

- **Cadence**: `qits.workspace.checkpoint-interval-ms` (the `-ms` config convention), default
  **5 minutes in the service** (`application.properties`), off by code default — so the short-lived
  `cli` and all tests never run the timer. The 5-minute default trades a bounded loss window for a
  brief 0-ahead blip in the branch tree after each sweep.
- **Per-workspace vs. global**: one global fixed-delay sweep. Simpler, no per-workspace state, and
  overlap-free by construction (single thread + fixed delay).
- **Races**: a checkpoint racing `stopContainer`/`mergeWorkspace`/an in-flight agent commit is
  harmless — every party runs the same forward-only `git push origin <branch>`, atomic per-ref.
- A container still mid-provisioning can appear in the listing before its clone finishes; its push
  fails non-zero and is swallowed. Harmless one-sweep noise.

## Testing

`WorkspaceCheckpointServiceTest` (domain), on the `FakeContainerRuntime` — which runs real host
git, so pushes genuinely advance the bare origin:

- **Ahead container**: a commit in the container + one sweep → origin ref equals the container
  HEAD, `pushed == 1`.
- **Noise guard**: a level container is skipped (`pushed == 0`, origin ref byte-identical).
- **Loss-window regression**: commit → checkpoint → `rm` the container (unexpected death) →
  `ensureContainer` → the recreated container has the checkpointed commit. The mirror of the parent
  feature's `unpushedWorkDiesWithAnUnexpectedlyRemovedContainer`.

No extended IT was added: `WorkspaceRecreateIT` already proves the real-docker push/recreate
transport end-to-end; the checkpoint only adds enumeration and the ahead-gate on top of the same
`pushBranch`, and the fake (real git) covers that fully.
