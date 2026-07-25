# Workspace service (`quarkus:dev`) wedges alive-but-not-serving and is never recovered — service start/supervision needs rearchitecting

## Introduction

Related / dependent plans:

- [qits-workspace-services epic](../epics/qits-workspace-services/epic.md) — owns the dev-server
  ("service") lifecycle this issue is about.
- [qits-workspace-daemon epic](../epics/qits-workspace-daemon/epic.md), esp.
  [daemon-supervised dev daemons](../epics/qits-workspace-daemon/features/2026-07-24_daemon-supervised-dev-daemons.md)
  (the `ServiceSupervisor` that spawns/monitors/restarts services in-container) and
  [config as single source of truth](../epics/qits-workspace-daemon/features/2026-07-24_config-as-single-source-of-truth.md)
  (the `.qits-config.yml` `services:` block).
- [daemon healthchecks](../epics/qits-workspace-services/features/2026-07-10_daemon-healthchecks.md) —
  the health-check mechanism that currently informs the UI but does **not** drive recovery.
- [qits-in-qits registration guide](../guides/qits-in-qits-registration.md) — the dogfood setup
  where this was observed (the qits dev server running as a managed workspace service).
- Memory-documented trigger: this workspace's `quarkus:dev` wedging under concurrent reactor builds
  (the `qits-in-qits-dev-daemon-restart` note).

## Summary

A workspace service declared with `restart-policy: ON_FAILURE` (e.g. the qits-in-qits **"qits dev
server"** running `./mvnw -pl service -am quarkus:dev`) can stop serving on its port while its
process stays **alive**. The daemon's `ServiceSupervisor` judges liveness purely by **process
exit**, so an alive-but-wedged server is never detected as failed and never restarted. It lingers,
holding ~1 GiB+ RSS, with `:8080` dead — appearing orphaned/down to the user and to the parent qits,
with no automatic recovery. The declared health-checks do **not** trigger a restart; they only feed
UI status.

The broader point (per user): `quarkus:dev`'s in-process live-reload is fragile here — it "keeps
breaking" — and the intended direction is to run workspace services as a **locally-built "normal"
(packaged) server** rather than dev mode, and to **rearchitect how workspace services are started
and supervised** so a non-serving service is actually recovered.

## Observed behavior

On this qits-in-qits workspace container (PID 1 = `docker-init` → PID 7 = `qits-workspace-daemon`):

- `.qits-config.yml` service **"qits dev server"**: `start: ./mvnw -q -pl service -am quarkus:dev …`,
  `auto-start: true`, `restart-policy: ON_FAILURE`, `max-restarts: 3`, `ready-pattern:
  "(?i)Listening on: http"`, plus COMMAND (`/q/health`) and HTTP (`:4200`) health-checks.
- Process state (observed):
  - PID `1759` — `mvnw … quarkus:dev …` launcher, **PPID 7** (the daemon's supervisor session), `Ssl`, ~525 MiB, 41 min old.
  - PID `2117` — the forked dev JVM `java … -javaagent:quarkus-class-change-agent … -jar service/target/service-dev.jar`, child of 1759, `Sl`, ~745 MiB.
  - **`ss -ltnp` shows nothing listening on `:8080`**; `curl http://localhost:8080/…` → no response (`000`).
- Neither JVM is defunct/zombie — both are alive and idle. The supervisor therefore never ran its
  exit path, and the parent qits (which keys "running" off process/socket liveness) doesn't relaunch
  it. Net effect: a dead-but-resident service that is not recovered.

### Repro (this environment)

1. A workspace service using `quarkus:dev` is auto-started by the daemon.
2. Its live-reload wedges — e.g. a concurrent reactor build mutates `service/target/classes` under
   the running dev mode (the class-change agent's known failure mode; see the
   `qits-in-qits-dev-daemon-restart` memory), or any crash of the HTTP server that doesn't exit the JVM.
3. `:8080` stops answering while PIDs 1759/2117 stay alive.
4. No restart occurs; the service is stuck until manually killed (`pkill -f quarkus:dev; pkill -f
   service-dev.jar`), after which the supervisor/parent can start a fresh one.

## Suspected cause (code pointers)

- **Liveness is process-exit-only.** `workspace-daemon/.../ServiceSupervisor.java`: the monitor
  thread blocks on `process.waitFor()` and only acts in `handleExit(...)` (~L306–307, L328). Restart
  is decided there as `"ALWAYS".equals(policy) || ("ON_FAILURE" && exitCode != 0)` (~L339–340),
  bounded by `maxRestarts` (~L341–342). **A process that never exits never reaches this path**, so a
  wedged-but-alive service is neither marked failed nor restarted.
- **Health-checks don't drive recovery.** In the daemon, `healthChecks()` is only stored on the
  `Supervised` declaration (`ServiceSupervisor.java:244`) — there is no loop that runs the checks and
  acts on failure. Health evaluation lives host-side in
  `domain/.../service/control/HealthProbeService.java` and surfaces status for the UI only; it does
  **not** feed back into a stop/restart. So "unhealthy" is observational, not actionable.
- **The DEGRADED/observer subsystem that might have caught this was removed** (commit `d0dc4676`
  "remove log-observer / DEGRADED / log-source subsystem"), leaving no "alive but not healthy → act"
  state.
- **No orphan reaping for alive-but-not-serving sessions** on daemon (re)start / reconnect adoption
  (`ServiceSupervisor` reconnect re-report path): adoption re-reports running processes but does not
  validate they still serve.
- **`quarkus:dev` fragility** is the aggravating trigger: its in-process class-change agent wedges
  when `target/classes` changes under it, and it forks a second JVM (`*-dev.jar`) whose HTTP server
  can die without the outer `mvnw` exiting.

## Impact

- Workspace services silently die and are not recovered; the workspace looks broken with no signal
  beyond "port dead."
- Resource waste: two idle JVMs (~1.3 GiB RSS here) held indefinitely inside the container's cgroup.
- Dogfood (qits-in-qits) web view / telemetry go dark until manual intervention.

## Suggested fix direction

Two complementary prongs; the second is the user's stated direction and likely the larger rework:

1. **Health-driven liveness & bounded recovery.** Make sustained health-check failure of a
   still-alive service an actionable failure: the daemon periodically runs the declared health-checks
   (it already parses them) and, after a grace/threshold, treats the service as failed → group-kill
   the session and apply the restart policy (bounded by `maxRestarts`, with backoff). This restores
   an "alive but unhealthy → recover" path to replace the removed DEGRADED subsystem, and reaps
   alive-but-not-serving sessions on adoption.
2. **Run workspace services as a locally-built "normal" server, not `quarkus:dev`.** Rearchitect the
   service model so a service is built once (in the bootstrap chain) and then run as a **packaged
   artifact** (e.g. `java -jar target/quarkus-app/quarkus-run.jar` / `quarkus:run`), trading
   live-reload for a stable, restartable process the supervisor can reason about by exit code.
   Considerations to resolve in the rework:
   - Loss of hot-reload for the qits-in-qits dogfood — decide whether a daemon-orchestrated
     rebuild-and-restart-on-change replaces `quarkus:dev`'s in-process agent, or hot-reload is simply
     dropped for managed services.
   - The **build-guard ordering** still holds: the reactor `install` must complete before anything
     binds `:8080` (the guard fails lifecycle builds once the port is taken), so the "build" and
     "run" phases must stay separated (bootstrap vs. service start).
   - Config surface: `.qits-config.yml` `services:` may need a first-class "build step vs. run step"
     distinction rather than one `start:` command that both builds and serves.

## Update (2026-07-25): prong 2 implemented

Prong 2 (run a packaged server, not `quarkus:dev`) is now implemented for the qits-in-qits child:

- New **`local` auth variant** (`auth/local`, `-Dqits.variant=local`) — explicitly unauthenticated,
  works in `NORMAL`/packaged launch mode (unlike forwardauth's LaunchMode-guarded dev fallback), so
  a packaged child serves with a working identity behind the parent proxy with no login. See
  docs/epics/qits-authentication/features/2026-07-16_build-variant-auth.md.
- `.qits-config.yml` **"qits server"** service now runs the packaged fast-jar
  (`java … -jar service/target/quarkus-app/quarkus-run.jar`) built with `-Dqits.variant=local`, and
  drops the Angular `:4200` health-check (Quinoa serves the prebuilt SPA statically — no `ng serve`).
  This removes ~1.1 GiB of `ng serve`/esbuild and runs the JVM in prod mode (~0.4 GiB vs ~1 GiB dev):
  the workspace service drops from ~2.1 GiB to ~0.4 GiB.

Verification note: the RAM/OOM impact is to be confirmed empirically after deploy — the co-resident
running service prevented a clean in-situ measurement (this issue's own failure mode). Prong 1
(health-driven recovery of an alive-but-not-serving service) is still open.

## Notes

- Immediate manual recovery in this environment: `pkill -f quarkus:dev; pkill -f service-dev.jar`,
  then let the supervisor/parent relaunch (or start the service from the UI).
- This issue is about the **start/supervision architecture**, not a one-line fix; the two prongs
  above are candidate feature-ideas under the qits-workspace-services / qits-workspace-daemon epics.
