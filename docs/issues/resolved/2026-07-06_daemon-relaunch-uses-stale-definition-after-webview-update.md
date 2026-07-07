# Daemon relaunch after container recreate uses the stale pre-update definition — proxy 404s until a manual stop/start

> **Resolved 2026-07-07.** `DaemonSupervisor.relaunch(instance)` now calls a new
> `refreshDefinition(instance)` before `launch()`, re-resolving the `RepositoryDaemonDto` from the
> repository (falling back to the pinned copy if the definition was deleted mid-flight). The proxy's
> `proxyTarget(...)` now reads the current definition, so it agrees with the REST instance list after
> an automatic `ON_FAILURE`/`ALWAYS` relaunch. Regression test:
> `DaemonSupervisorTest#automaticRelaunchPicksUpADefinitionEditedMidRun` (edit a running daemon's
> webView, kill its session, assert `proxyTarget` sees the new webView after the crash-restart).

## Introduction

Found while walking a fresh starter through the
[integration guide](../feature-ideas/quarkus-angular-integration-guide.md) (Tier 2, adding a
`webView` to a live daemon). Related plans:
[daemon web-view configuration](../features/2026-07-06_daemon-webview-configuration.md) (the
recreate-container affordance this collides with), [daemons](../features/2026-07-04_daemons.md)
(the supervisor's restart machinery).

## Observed repro

1. Daemon (restartPolicy `ON_FAILURE`) is READY in a workspace, definition has **no** `webView`.
2. `PUT /api/repositories/{repoId}/daemons/{id}` adds `webView {port: 4200, entryPath}`.
   The instance list now shows `proxyPath` and `needsContainerRecreate: true` — as designed.
3. Follow the recreate rule: `POST …/stop-container` then `POST …/ensure-container`.
4. The container kill looks like a crash to the supervisor, so `ON_FAILURE` schedules a
   relaunch; the daemon comes back READY in the fresh container (which now publishes the port —
   `docker ps` shows `127.0.0.1:<port>->4200/tcp`).
5. **The web view is still dead**: `GET /daemon/{ws}/{daemonId}/…` returns 404
   "No web-viewable daemon here." while the daemons list simultaneously reports READY,
   `proxyPath` set, `needsContainerRecreate: false`. The states disagree.
6. Manual `stop` + `start` of the daemon fixes it — the fresh launch reads the updated
   definition and the proxy serves.

## Cause

`DaemonSupervisor.relaunch(instance)` calls `launch(instance)` with the **launch-time**
`instance.daemon` (`RepositoryDaemonDto` captured when the run began); it never re-reads the
definition (`DaemonSupervisor.java:695`). The proxy's only lookup,
`DaemonSupervisor.proxyTarget(...)` (`DaemonSupervisor.java:788`), checks
`instance.daemon.webView()` — the stale copy, still `null`. Meanwhile the REST instance list
(`toInstanceDto`) prefers the *database* definition, so it happily reports a `proxyPath` — the
UI and the proxy answer from two different snapshots.

Any definition update behaves this way on automatic relaunches (startScript, observers, env
too); the webView case is just the one where a supervisor-internal staleness becomes an
externally visible contradiction, on exactly the flow the web-view feature's amber
"recreate container" affordance tells users to take.

## Suggested fix direction

Refresh the definition at relaunch: have `relaunch()` (or `launch()`) re-resolve the
`RepositoryDaemonDto` from the repository before starting, falling back to the pinned copy if
the definition was deleted mid-flight. Alternatively (weaker), make the recreate-container
affordance stop the daemon outright instead of letting `ON_FAILURE` resurrect it, so the next
start is always a fresh launch. Add a regression test: update a daemon's webView while running,
crash-restart it, assert `proxyTarget` sees the new webView.

## Workaround (documented in the guide)

After changing a daemon definition, do a manual **stop + start** of the daemon (not just a
container recreate) so the new definition takes effect.
