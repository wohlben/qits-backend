# Transient vite proxy error at the READY instant flips the daemon permanently DEGRADED

## Introduction

Found while end-to-end-verifying the
[workspace-detail tab consolidation](../features/2026-07-09_workspace-detail-tab-consolidation.md)
(a pure-frontend change — this issue is backend/fixture behavior). Concerns the
[daemons](../features/2026-07-04_daemons.md) observer pipeline (`LogLevelClassifier`,
`ERROR_DETECTED` → DEGRADED), the [daemon web-view proxy](../features/2026-07-05_daemon-webview-picker.md)
(`DaemonProxyRoute`), and the [servable fixture](../features/2026-07-05_servable-quarkus-angular-fixture.md)'s
SPA-observability `config.json` relay. Sibling of the resolved
[degraded-false-positive-on-quarkus-dev-output](resolved/2026-07-05_degraded-false-positive-on-quarkus-dev-output.md)
— same "healthy demo reads as broken" symptom, different (and this time genuinely
ERROR-classified) trigger. The [daemon-healthchecks idea](../feature-ideas/daemon-healthchecks.md)'s
deferred **auto-recovering DEGRADED** is the principled fix direction.

## Observed (devcontainer, 2026-07-09)

`seed-webapp` → workspace detail → **Daemons** tab → Start the "Quarkus dev server" daemon, with
the **Web view** tab already opened once (so, post-consolidation, the iframe mounts the moment the
daemon turns web-viewable). Event feed, in order:

```
07:33:48  ready (pattern matched)
07:33:50  output  error-log: Quinoa package manager live coding dev service starting:
          7:33:48 AM [vite] http proxy error: /daemon/greeting/<daemonId>/api/config.json
07:33:50  degraded (errors in output; process still alive)
```

The fixture app itself is fine — seconds later the web view serves the greeting page and
`/api/greetings` works. But `DEGRADED` does not auto-recover (by design), so the flagship demo
daemon sits permanently amber after a ~2-second boot race.

## Suspected cause

At `readyPattern` match the workspace SSE invalidation makes the daemon web-viewable, and the
(already-activated) Web view tab frames the app **immediately**. The fixture SPA loads from vite
and fetches its `config.json` identity relay; that request rides the qits proxy into vite, whose
`/api` dev-proxy target — the fixture's Quarkus — matched "Listening on" a moment ago but isn't
serving REST yet. vite logs `[vite] http proxy error: …/api/config.json` on its stderr, the
`LogLevelClassifier` sees an ERROR-worthy line, `ERROR_DETECTED` fires, READY → DEGRADED, forever.

Pre-consolidation this was latent: a human opened the web-view dialog manually, usually well after
boot. The tab consolidation makes "frame at the READY instant" the common case, so the race is now
easy to hit. Note also the logged path retains the `/daemon/<ws>/<id>/` prefix — worth checking
whether `DaemonProxyRoute` forwards the un-stripped URI and the fixture's vite tolerates it (cf.
[quinoa-ignored-prefix-root-path-loop](resolved/2026-07-06_quinoa-ignored-prefix-root-path-loop.md)).

## Suggested fix direction

- **Auto-recovering DEGRADED** (the daemon-healthchecks idea's deferred item): an error hit while
  output subsequently stays clean should decay back to READY. Fixes the class, not the instance.
- Narrower: a **post-ready observer grace window** (mirror of the existing ready grace) so boot-race
  noise in the first seconds after `readyPattern` doesn't latch DEGRADED; or classify vite's
  `http proxy error` during startup as WARNING in `LogLevelClassifier`.
- Fixture-side: make the vite `/api` dev-proxy retry/silence until the backend port accepts, if
  Quinoa exposes such a knob.
