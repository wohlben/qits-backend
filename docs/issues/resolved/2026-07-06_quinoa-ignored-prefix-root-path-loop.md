# Quinoa dev proxy loops API GETs forever when the app serves under a root path

## Introduction

Encountered (and fixed) while implementing
[SPA observability](../../features/2026-07-06_spa-observability.md), whose `GET /api/config.json`
was the fixture SPA's first-ever GET API call. Affects the
[servable quarkus-angular fixture](../../features/2026-07-05_servable-quarkus-angular-fixture.md)
when framed by the [daemon web view](../../features/2026-07-06_daemon-webview-configuration.md)
(`quarkus.http.root-path=$QITS_PUBLIC_BASE`); any user app following the same integration pattern
inherits the same trap, so the
[Quarkus/Angular integration guide](../../feature-ideas/quarkus-angular-integration-guide.md)
should carry the root-path-aware config.

## Observed

`seed-webapp`, greeting workspace, daemon READY. `POST …/api/greetings` through the daemon proxy
works, but **every GET under the API prefix hangs until client timeout** — including
`GET …/api/config.json` (a real resource) and `GET …/api/nonexistent`. Reproduce inside the
container: `curl --max-time 5 http://localhost:8080/daemon/<ws>/<daemon>/api/config.json` → curl
exit 28. A `POST` to the same path answers `405` instantly, proving Quarkus REST matches the path
and the GET never reaches it. Standalone (root path `/`) everything works.

## Cause

Quinoa 2.8.3's dev proxy (`QuinoaDevProxyHandler`) checks `ctx.normalizedPath()` — the **full**
request path, including `quarkus.http.root-path` — against `quarkus.quinoa.ignored-path-prefixes`,
and the deployment step (`QuinoaConfig.getNormalizedIgnoredPathPrefixes`) never prepends the root
path to user-provided prefixes. With the fixture's `ignored-path-prefixes=/api` and the daemon's
`root-path=/daemon/<ws>/<daemon>/`, the path `/daemon/<ws>/<daemon>/api/…` doesn't start with
`/api`, so Quinoa treats the API GET as a UI request and forwards it to `ng serve` — whose
`proxy.conf.js` (`${QITS_PUBLIC_BASE}api` key) sends it straight back to Quarkus. Quarkus → ng →
Quarkus, forever. Only GET/HEAD are affected (`QuinoaRecorder.shouldHandleMethod`), which is why
the greeting demo (POST-only) never surfaced it.

## Fix

In the fixture's `application.properties`, make the ignored prefix root-path-aware
(fixture commit `1a4c4ec`):

```properties
quarkus.quinoa.ignored-path-prefixes=${quarkus.http.root-path:/}api
```

The `:/ ` default keeps standalone runs (`root-path` unset) at `/api`. The same expansion is needed
for `quarkus.otel.traces.suppress-application-uris` (its javadoc says so explicitly; fixture commit
`35247d4`).

## Follow-up direction

Arguably a Quinoa upstream issue (ignored prefixes should probably be resolved relative to the
root path, like most Quarkus path config). If an upstream fix lands, the expression can revert to
plain `/api`. Until then, treat "app framed under a path prefix + Quinoa dev mode + API GETs" as
requiring the root-path-aware prefix — worth a line in the integration guide.
