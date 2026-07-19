# OTEL 502: qits' dev-mode HTTP binds loopback, unreachable from workspace containers on qits-net

**Status:** Resolved (2026-07-07).

## Introduction

The second regression from the [qits-net devcontainer unification](../../epics/qits-live-deployment/features/2026-07-07_qits-net-devcontainer-unification.md),
found right after the [web-view host-not-allowed fix](2026-07-07_web-view-host-not-allowed-after-devcontainer-move.md).
Touches the container→qits contract owned by [`QitsHostResolver`](../../../domain/src/main/java/eu/wohlben/qits/domain/repository/control/QitsHostResolver.java)
and the [spa-observability](../../epics/qits-observability/features/2026-07-06_spa-observability.md) / OTEL path
(`OtelEnvironment` → the app's `OtelProxyResource` → qits' `OtelReceiverResource`). Related guide:
[Quarkus+Angular integration](../../guides/quarkus-angular-integration.md) Tiers 4–5.

## Symptom

No OTEL telemetry reaches qits since the devcontainer move; the browser network panel shows **502**
for the SPA's `POST …/api/otel/v1/{traces|logs|metrics}`. The web view itself renders fine, and the
qits UI works from the host browser.

## Cause

qits' Quarkus **dev mode binds `quarkus.http.host` to `localhost` by default** (a dev-mode safety
default; prod/`package` runs bind `0.0.0.0`). That was invisible while qits ran on the host, but now
qits runs *inside* a container on `qits-net`, so port 8080 listening on loopback is unreachable from
the sibling workspace containers. Confirmed live: in the devcontainer, `curl localhost:8080/q/health`
→ 200, but from a workspace container `curl http://qits:8080/q/health` → connection refused, and the
listening socket for 8080 was `::ffff:127.0.0.1` (4200 was correctly `0.0.0.0`).

Chain: the framed SPA POSTs OTLP base-relative → the app's `OtelProxyResource` forwards to
`OTEL_EXPORTER_OTLP_ENDPOINT` = `http://qits:8080/api/otel/v1/…` → **connection refused** →
`OtelProxyResource` returns **502**. The same loopback bind also breaks container→qits **git** and
**MCP**; OTEL is just the first such traffic normal dev use exercises (the seed containers were first
cloned by `postcreate.sh`'s *packaged* — 0.0.0.0 — run, so their initial clone had worked). The host
browser reaching the UI on `:4200` is unaffected because Quinoa's ng dev server (0.0.0.0:4200)
proxies `/api` + `/daemon` to `:8080` over the container's own loopback.

## Fix

Set `QUARKUS_HTTP_HOST=0.0.0.0` in the devcontainer's `docker-compose.yml` `environment`, so every
in-container run (`quarkus:dev`, `seed`, `seed-webapp`) binds all interfaces and is reachable at
`qits:8080` on qits-net. Scoped to the devcontainer — host runs keep the dev default. This also makes
the published `127.0.0.1:8080` mapping actually reach the process.

**Applying it to a running devcontainer:** the compose env change takes effect on the next container
(re)create. To fix a *live* session immediately without a rebuild, restart dev with the flag:

```bash
pkill -f quarkus:dev; pkill -f 'target/.*-dev.jar'
./mvnw -pl service -am quarkus:dev -Dquarkus.bootstrap.workspace-discovery=true -Dquarkus.http.host=0.0.0.0
```

Then restart the workspace's dev-server daemon so its OTLP exporters retry against a now-reachable
`qits:8080`.
