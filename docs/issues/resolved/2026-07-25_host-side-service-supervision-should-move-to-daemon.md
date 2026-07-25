# Host-side service supervision is redundant — the workspace-daemon owns it; collapse the host to a pure projection

> **Resolved 2026-07-25.** The host `ServiceSupervisor`
> (`domain/.../service/control/ServiceSupervisor.java`) was collapsed to a **pure projection** of the
> daemon's `DaemonEvent`s, exactly the subtraction this issue proposed:
>
> - **Removed** the tmux/host-exec supervision half: `launch`/`launch(adopt)`, the log follower,
>   `startLivenessPoll`/`checkLiveness`, host `handleExit`/`relaunch`/`refreshDefinition`, the
>   `reapStragglers` `/proc`-marker reaper, the `graceReady` timer, the whole `ScheduledExecutorService`,
>   and `adoptIfRunning`/`adoptionProbed` (tmux boot re-adoption — now event-driven via the daemon's
>   reconnect re-report). The `qits.services.liveness-poll-ms` knob went with it. (`ready-grace-ms`/
>   `restart-backoff-initial-ms`/`stop-grace-ms` stay — `WorkspaceContainerFactory` forwards them to the
>   in-container daemon, which does the supervising.)
> - **`start`/`stop`/`settleForWorkspace` now unconditionally delegate** to the `WorkspaceServiceDriver`
>   (the control socket); the `daemonBacked(workspaceId)` branch and the `WorkspaceDaemonLiveness` gate
>   are gone. A workspace with no live daemon can't run a service, so a manual start stays STARTING
>   ("not available yet") until a daemon connects — no host execution.
> - **`ProjectionSink`** is all that remains of the runtime: it maps `STARTING/READY/RESTARTING/
>   CRASHED/STOPPED` onto the display state machine, settles `daemon:<name>` process segments (streamed
>   lines now flow into the segment too, restoring a UX that had silently regressed in daemon-backed
>   mode), and resolves the web-view proxy origin. The daemon owns every start/restart/backoff/stop.
> - **Host-side health probing removed.** `HealthProbeService` only ran on the deleted tmux path (health
>   already read UNKNOWN in daemon-backed mode), so it and its two tests were deleted; health is now the
>   daemon's to report — see prong 1 below.
>
> This ends the **double-supervision hazard**: a socket blip can no longer flip the host onto a second
> supervisor that fights the daemon over the process and `:8080`. The observed "kept relaunching" can no
> longer originate host-side — supervision lives in exactly one place (the daemon).
>
> **Deferred (still open):** suggested-fix **point 4 / [wedged-service](2026-07-25_wedged-workspace-service-not-recovered.md)
> prong 1** — health-check-driven recovery of an alive-but-not-serving service — is a daemon-side
> feature and stays a follow-up under that issue; the host collapse doesn't implement it.
>
> Tests: `ServiceSupervisorProjectionTest` is the projection spec (dup-start, proxy target, adoption);
> the tmux-only `ServiceSupervisorTest` was deleted, and the auto-start/settle/proxy/bootstrap tests were
> converted to drive lifecycle through a fake `WorkspaceServiceDriver` (a profile-scoped `@Alternative`
> in the service module, so the daemon ITs keep the real registry).

## Introduction

Related / dependent plans:

- [qits-workspace-daemon epic](../epics/qits-workspace-daemon/epic.md), esp.
  [daemon-supervised dev daemons (Part 4)](../epics/qits-workspace-daemon/features/2026-07-24_daemon-supervised-dev-daemons.md)
  — the workspace-daemon is meant to own the service (dev-server) process lifecycle end to end:
  spawn, restart, backoff, policy, group-kill, liveness — and report only the *outcome* as a
  `DaemonEvent`; the host is a **thin client that projects** those events.
- [qits-workspace-services epic](../epics/qits-workspace-services/epic.md) — owns the host-side
  `ServiceSupervisor`.
- [qits-workspaces / workspace-containers](../epics/qits-workspaces/features/2026-07-04_workspace-containers.md)
  — "**the container is the sole environment for execution, not a mode — there is no host-execution
  fallback.**" The host tmux/host-exec supervision path below directly contradicts this.
- Sibling issue: [wedged workspace service not
  recovered](2026-07-25_wedged-workspace-service-not-recovered.md) — surfaced while chasing why a
  killed service kept relaunching in qits-in-qits.

## Summary

The host-side `ServiceSupervisor` (`domain/.../service/control/ServiceSupervisor.java`, in the parent
qits) still carries a **complete second supervisor**: a tmux/host-exec launcher, a 2-second liveness
poll, its own restart policy with backoff + `restartCount`, and a log follower. In **daemon-backed**
mode it is correctly bypassed — `start()` registers a *projection only* and delegates start/stop to
the daemon over the socket — but the full supervisor still exists and **activates whenever
`daemonBacked(workspaceId)` is false** (i.e. whenever no daemon socket is currently live). Since the
workspace-daemon is now the sole in-container executor *and* supervisor, that host-side supervision
is redundant and should be **removed**, collapsing the host `ServiceSupervisor` to a pure projection
of daemon-emitted `DaemonEvent`s.

Keeping two supervisors is not just dead weight — it is a **double-supervision hazard**: a transient
daemon-socket blip flips `daemonBacked` to false, at which point the host will try to host-supervise
(tmux `launch` + liveness poll + restart) a service the daemon is *still running in-container*, so
the two fight over the process and the `:8080` port.

## Current state (code pointers)

Host `ServiceSupervisor` (`domain/src/main/java/eu/wohlben/qits/domain/service/control/ServiceSupervisor.java`):

- **Correct, daemon-backed path** — `start()` (`:248`): when `daemonBacked(workspaceId)` (`:266`), it
  registers a projection and calls `serviceDriver.startService(...)` (`:277`); `stop()` (`:286`)
  delegates via `signalService(...)` (`:299`). No host launch/poll/restart. This is the shape the
  whole class should reduce to.
- **Redundant host-supervision path** — reached via the fallback `launch(instance)` (`:280`, "tmux
  fallback (no live daemon) — drive the process ourselves"):
  - `launch(...)` (`:530`/`:546`) spawns and follows a host-driven session;
  - `startLivenessPoll(...)` (`:636`, `:675`) schedules `checkLiveness` every
    `qits.services.liveness-poll-ms` (default **2000ms**, `:207`);
  - `checkLiveness(...)` (`:691`) polls the detached session and, on exit, calls host `handleExit`;
  - host `handleExit(...)` (`~:795`) applies its own restart policy (`restartCount` `:79`, backoff
    `qits.services.restart-backoff-initial-ms` `:201`) → `relaunch(...)` (`:854`) → `launch(...)`.
- Config knobs that exist only for this host supervision and would go with it:
  `qits.services.liveness-poll-ms`, `qits.services.restart-backoff-initial-ms`,
  `stopGraceMillis`/stop-grace (the host force-kill dance).

The daemon already owns the real thing: `workspace-daemon/.../ServiceSupervisor.java` (spawn via
`setsid`, `handleExit` restart policy, backoff, `max-restarts`, group-kill), emitting `DaemonEvent`s
the host projects.

## Observed

In qits-in-qits, a killed `quarkus:dev`/packaged service kept relaunching within seconds across many
kills — beyond the daemon's own (never-reset) `max-restarts` budget — so a supervisor was re-driving
starts. (Original mis-attribution to correct: this is *not* the coding agent restarting it, and in a
cleanly daemon-backed workspace it is *not* the host's liveness poll either — the host poll only runs
on the non-daemon path. The exact re-driver in the observed run — a daemon-socket blip flipping the
host onto its fallback supervisor, a fresh `StartDaemon` from the lifecycle coupler resetting the
daemon's budget, or the daemon's boot auto-start re-firing — should be pinned down as part of this
cleanup, but the redundant host supervisor is a hazard regardless of which fired.)

## Impact

- **Double supervision / port fights** when the daemon socket blips: host and daemon both drive the
  same service, contending for `:8080`.
- Dead, contradictory code and config against the "no host-execution fallback" model — a standing
  source of confusion and of subtle races (the host force-kill dance, the reap-escaped-forks logic
  targeting "Quarkus dev mode's forked application JVM").
- Harder reasoning about the wedged-service recovery ([sibling
  issue](2026-07-25_wedged-workspace-service-not-recovered.md)): two overlapping restart policies.

## Suggested fix direction

Collapse the host `ServiceSupervisor` to a **pure projection**:

1. Remove the host-exec/tmux supervision entirely — `launch`/`launch(adopt)`, the follower,
   `startLivenessPoll`/`checkLiveness`, host `handleExit`/`relaunch`, the escaped-fork reaper, and
   the `qits.services.liveness-poll-ms` / `restart-backoff` / stop-grace knobs. The container is the
   sole executor; there is no live-daemon-less workspace to fall back for.
2. Make `start()`/`stop()` unconditionally delegate to the daemon (`startService`/`signalService`),
   dropping the `daemonBacked(workspaceId)` branch — a workspace with no live daemon can't run a
   service anyway, so the honest response is "not available yet," not host execution.
3. Keep only the projection: subscribe to the daemon's `DaemonEvent` stream, map it to
   `ServiceInstance` status for the UI/proxy, and let the daemon own every start/restart/backoff/
   stop decision (it already does).
4. As part of this, resolve the [wedged-service issue](2026-07-25_wedged-workspace-service-not-recovered.md)
   prong 1 **in the daemon** (health-check-driven recovery of an alive-but-not-serving service),
   since supervision then lives in exactly one place.

This is a subtraction, not a rewrite — the daemon-backed path already does the right thing; the work
is deleting the redundant host half and the `daemonBacked` conditional that guards it.
