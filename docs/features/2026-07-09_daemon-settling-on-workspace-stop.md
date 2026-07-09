# Daemon settling: stopping a workspace settles its daemons

## As built (2026-07-09)

Shipped as the stop-side half of the coupling, landing alongside its sibling
[daemon-autostart-on-workspace-start](../features/2026-07-09_daemon-autostart-on-workspace-start.md).
Concretely:

- **`WorkspaceContainerStopping(repoId, workspaceId, graceful)`** — a new synchronous CDI event
  (`repository.control`), fired via `WorkspaceContainerEventPublisher.fireStopping(...)` using
  `Event.fire` (not `fireAsync`), **before** `containers.rm`, so the settle completes while the
  container and its tmux sessions still exist. `stopContainer` fires it `graceful=true`; `doDiscard`
  (discard + the INTEGRATED-cleanup path) fires it `graceful=false`.
- **`DaemonSupervisor.settleForWorkspace(repoId, workspaceId, graceful)`** — a non-throwing batch
  settle scanning `instances` for the workspace's live entries. Sets `stopRequested` + cancels
  liveness/pending (so a racing liveness poll and any queued relaunch both take the STOPPED path),
  settles `RESTARTING` instances immediately, and for live sessions (graceful only) signals
  `stopSignal` and blocks up to `stop-grace-ms` (`awaitAllDeadOrTimeout`) before terminating the
  follower; every instance transitions **STOPPED with an INFO event** (no CRASHED, no ERROR, no agent
  notification). Clears the workspace's `adoptionProbed` keys so a future container re-probes.
- The observer unified into **`DaemonLifecycleCoupler`** (the renamed `DaemonAutoStarter`), hosting
  both directions: `onContainerStarted(@ObservesAsync)` (start) and `onContainerStopping(@Observes`,
  synchronous) (stop). Kill switch `qits.daemons.autostop-enabled` (default `true`; tests default it
  off and re-enable per-profile, beside `autostart-enabled`).
- No entity/DTO/REST/MCP/UI/migration/openapi change — purely the missing lifecycle call. Tests:
  `DaemonLifecycleCouplerSettleTest` (settle, RESTARTING, resurrection regression),
  `DaemonSettleKillSwitchTest`, a synchronous `WorkspaceContainerStoppingRecorder`, and
  before-`rm` ordering assertions in `WorkspaceContainerLifecycleServiceTest`.

The design narrative below is preserved as written.

## Introduction

The `DaemonSupervisor` has no concept of a **deliberate container stop**. Its world model knows
exactly two ways a daemon session ends: someone asked the *daemon* to stop (`stopRequested`), or
it crashed — so when the *container* is stopped out from under a live daemon
(`stopContainer`, `discardWorkspace`), the liveness poll can only read it as a crash and feed the
restart policy. This idea adds the missing half of daemon↔workspace lifecycle coupling: **when a
workspace container is deliberately stopped, its daemons are gracefully settled first** —
stop-signaled, followers terminated, instances marked STOPPED — instead of being left to the
crash machinery.

Related/dependent plans:

- **Sibling of [daemon-autostart-on-workspace-start](daemon-autostart-on-workspace-start.md)** —
  the start-side half of the same coupling. Together they make workspace stop/start round-trip
  ("a running workspace has its daemons up; a stopped one has them settled"). Independently
  buildable, and this half carries its own urgency: without it, auto-start makes the resurrection
  behavior below *more* frequent, since every stopped workspace whose daemons auto-started hits
  it. The two share the CDI-event inversion (this doc adds `WorkspaceContainerStopping` beside the
  sibling's `WorkspaceContainerStarted`).
- **Hard dependency on [daemons](../features/2026-07-04_daemons.md)** /
  [tmux-backed-daemons](../features/2026-07-05_tmux-backed-daemons.md): settling reuses the
  existing graceful-stop path (`stopSignal`, `stop-grace-ms`, follower termination) — no new stop
  mechanics, just a new caller with workspace scope.
- **Completes [lazy container provisioning](../features/2026-07-08_lazy-workspace-container-provisioning.md)'s
  `stopContainer` contract**: the "lossless graceful stop" today is lossless for *git state* (push
  before rm) but abrupt for *processes* — daemons are hard-killed by the rm and their supervisor
  state left dangling. Settling makes the graceful stop actually graceful end to end.
- **[Disposable containers](../features/2026-07-04_disposable-workspace-containers.md)**: "the
  container is a recreatable cache" only holds if discarding one is a clean, *silent* operation —
  today it produces spurious CRASHED events and agent notifications.

## The gap today, concretely

`DaemonSupervisor.start`'s counterpart works fine when you stop *a daemon*; nothing exists for
stopping *a workspace*. `stopContainer` (`WorkspaceService.java:720`) pushes the branch, removes
the container, marks the row STOPPED — and never tells the supervisor. The still-tracked READY
instance then runs the crash path:

1. `checkLiveness` (`DaemonSupervisor.java:420`): `daemonAlive` on the removed container is a
   failed `docker exec` → `false` (`DockerExecutor.exec` returns the non-zero result rather than
   throwing, `DockerExecutor.java:125`); `daemonExitCode` → `null` → treated as exit 1
   (`DaemonSupervisor.java:431-433`).
2. `handleExit` (`DaemonSupervisor.java:628`): `stopRequested` is false — nobody asked the
   *daemon* to stop — so the restart policy decides.
3. With `ON_FAILURE` (the default) or `ALWAYS`: `relaunch → launch →
   commandService.beginDaemonRun` (`CommandService.java:351`) → `ensureContainer`
   (`WorkspaceService.java:560`) sees a still-ACTIVE workspace with a surviving branch ref and
   dutifully provisions a fresh container. Net effect, predicted from the code (deterministic
   repro: seed-webapp → start the dev-server daemon → `POST .../stop-container`): **the container
   the user just deliberately stopped is resurrected** within ~2s (liveness poll) + backoff, and
   the workspace flips back to RUNNING. `ensureContainer` is behaving correctly — the caller's
   world model is what's missing.
4. With `NEVER` (or a clean-exit `ON_FAILURE`): no resurrection, but the deliberate stop settles
   **CRASHED with an ERROR event** — recorded and agent-notified as a failure.

`discardWorkspace` has the same missing notification with a milder outcome: the workspace is no
longer active, so the relaunch's `ensureContainer` throws NotFound and the instance settles
"relaunch failed" CRASHED (`DaemonSupervisor.java:708-716`) — noise and a spurious agent
notification rather than resurrection.

## The model: a `WorkspaceContainerStopping` event

Dependency direction forbids `WorkspaceService` (repository.control) injecting `DaemonSupervisor`
(daemon.control depends on repository.control, not vice versa), so — exactly like the sibling's
start event — invert with CDI:

- **`WorkspaceContainerStopping(repoId, workspaceId)`**, fired **synchronously** by
  `stopContainer` and `doDiscard` *before* `containers.rm`, so settling completes while the
  container (and its tmux sessions) still exists.
- Observed in the daemon area (the sibling's `DaemonAutoStarter` observer bean is the natural
  home; a more neutral name like `DaemonLifecycleCoupler` fits if both ideas land). For every
  tracked live instance of the (repo, workspace):
  1. mark `stopRequested`, cancel liveness and any pending relaunch (the existing
     `stopRequested` check in `relaunch` already guards the backoff-task race);
  2. send the daemon's `stopSignal` to its session and wait a bounded graceful window (reusing
     `stop-grace-ms`) — dev servers get to flush before the container dies;
  3. terminate the follower and settle **STOPPED with an INFO "workspace stopped" event** — not
     CRASHED, no ERROR, no agent notification;
  4. drop the workspace's `adoptionProbed` keys, so a future container of this workspace gets a
     fresh adoption probe instead of being skipped by the once-per-key guard.
- Instances in `RESTARTING` (no live session) settle directly at step 3 — mirroring what the
  per-daemon `stop` already does for that state.

`stopContainer` then proceeds unchanged: push, rm, mark STOPPED. The settle is scoped to
*deliberate* stops — an out-of-band container death (host restart) still goes through the crash
machinery, which is correct: that one *is* a failure, and `ensureContainer`'s in-place-start path
plus the sibling's auto-start recover it.

## Surface changes

None. No entity, DTO, REST, MCP, or UI change — the feature is purely the missing lifecycle call.
Its visible effect is negative space: no CRASHED chip after a workspace stop, no resurrected
container, one INFO event per settled daemon in the feed.

## Explicitly deferred

- **Remembering what was running for the next start** — "settle on stop, relaunch on start" as a
  persisted desired-state reconciliation is the sibling doc's deferred item; this idea keeps
  settling stateless.
- **Settling on qits shutdown** — the tmux-backed design *deliberately* lets sessions outlive a
  qits restart (that's the adoption feature), so a qits `@PreDestroy` must keep not settling
  anything. Only container-scoped stops couple.

## Open questions

- **Graceful-stop budget.** The synchronous settle adds up to `stop-grace-ms` (default 5s, per
  workspace — daemons can be signaled concurrently) to `stopContainer`, which already does a git
  push. Acceptable for a "lossless stop"? Alternative: skip the signal and settle bookkeeping
  only, letting `containers.rm` kill the processes — faster, still fixes resurrection and the
  CRASHED noise, loses graceful shutdown. Lean signal-with-grace; the alternative is the fallback
  if the stop endpoint ever feels sluggish.
- **Does `discardWorkspace` deserve the graceful signal too?** A discard is throwing the work
  away; the bookkeeping-only settle (no signal, no grace) may be the better fit there. Lean yes to
  that split: graceful for `stopContainer`, immediate for discard.

## Testing sketch

- **Supervisor/observer test** (domain, `FakeContainerRuntime`): READY daemon + stopping event →
  instance STOPPED with INFO (not CRASHED/ERROR), liveness cancelled, follower terminated, no
  relaunch scheduled after the liveness interval; RESTARTING instance → pending relaunch
  cancelled, settled STOPPED; `adoptionProbed` cleared for the workspace's keys.
- **`WorkspaceServiceTest` additions**: `stopContainer` and discard fire the stopping event
  *before* `containers.rm` (orderable with the fake); the resurrection regression end to end —
  running daemon, `stopContainer`, container still absent after the liveness interval and the
  workspace row still STOPPED.
- **Manual (devcontainer, docker)**: seed-webapp → start the dev-server daemon → stop the
  workspace from the UI → daemon chip settles STOPPED (no amber/red), event feed shows "workspace
  stopped" INFO, `docker ps` stays clean; ensure the container again → (with the sibling) the
  daemon comes back.
