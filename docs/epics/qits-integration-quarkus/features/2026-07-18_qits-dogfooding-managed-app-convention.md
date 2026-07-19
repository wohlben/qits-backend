# qits dogfooding: qits conforms to its own managed-app convention

## Introduction

qits imposes an integration convention on the apps it manages — the SPA-observability decree
([spa-observability](../../qits-observability/features/2026-07-06_spa-observability.md)): a `GET /api/config.json` identity relay, a
`POST /api/otel/v1/*` OTLP path, and the browser-side
[`@qits/angular` library](../../qits-integration-angular/features/2026-07-13_qits-angular-integration-library.md), with the
[`testing-repo-quarkus-angular` fixture](../../qits-testing-fixtures/features/2026-07-05_servable-quarkus-angular-fixture.md) as the
reference implementation and [docs/guides/quarkus-angular-integration.md](../../../guides/quarkus-angular-integration.md)
as the walk. Until now qits itself conformed to none of it. This feature makes qits a
**second implementer of its own convention**, so the real `wohlben/qits-backend` repository can be
registered as a repository on a dev/prod qits deployment — framed web view, browser + backend
telemetry flowing to the supervising qits, capture button included. The registration recipe is
[docs/guides/qits-in-qits-registration.md](../../../guides/qits-in-qits-registration.md).

Related/dependent plans: [daemons](../../qits-workspace-daemons/features/2026-07-04_daemons.md) ·
[daemon web-view configuration](../../qits-workspace-daemons/features/2026-07-06_daemon-webview-configuration.md) ·
[observability](../../qits-observability/features/2026-07-04_observability.md) (the in-process OTLP receiver this feature tees) ·
[spa-feature-capture](../../qits-integration-angular/features/2026-07-14_spa-feature-capture.md) ·
[capture-state-snapshot](../../qits-integration-angular/features/2026-07-14_capture-state-snapshot.md) ·
[build-variant auth](../../qits-authentication/features/2026-07-16_build-variant-auth.md) (PublicPaths/QitsAuthPolicy touched) ·
[workspace submodule support](../../qits-project-repository-submodules/features/2026-07-14_workspace-submodule-support.md) (building qits in a
workspace container needs the fixture submodules materialized).

## What was added

### The OTLP tee (`OtelForwarder`)

qits is the *sink* side of the convention — it already owns `POST /api/otel/v1/{traces|logs|metrics}`
as the in-process receiver (`OtelReceiverResource`), the exact path the `@qits/angular` library
hard-codes (base-relative) as its export target. A managed app is expected to *forward* that path
upstream. Resolution: **tee, not proxy.** When `otel.exporter.otlp.endpoint` is configured (the
MicroProfile surface of the injected `OTEL_EXPORTER_OTLP_ENDPOINT`), every ingest is additionally
forwarded byte-verbatim — pre-gunzip, Content-Type/Content-Encoding relayed — to
`<endpoint>/v1/<signal>` by `service/.../telemetry/api/OtelForwarder.java`. The forward is
`sendAsync` fire-and-forget (connect 2 s / request 10 s): upstream status and failures are debug
logs, the local decode/store is never affected. Standalone (no endpoint) the tee is a no-op and the
receiver is byte-identical to before. A managed child therefore keeps its own telemetry view while
the parent sees everything too — including telemetry the child received from *its* own exporters.

### `GET /api/config.json` (`ConfigResource`)

A near-verbatim copy of the fixture's relay (`service/.../telemetry/api/ConfigResource.java`):
four optional MP-config keys → `{telemetry|null, capture|null}`, independently-nullable gates,
hidden from OpenAPI (`docs/openapi.yml` and the generated Angular client unchanged). Added to
`PublicPaths` (exact match, like `/api/capture`) — the library fetches it pre-bootstrap.

### Backend self-telemetry, dark by default

`quarkus-opentelemetry` joined `service/pom.xml`. `application.properties` sets
`quarkus.otel.sdk.disabled=true` (standalone AND every `@QuarkusTest` — main and test properties
merge), `http/protobuf`, logs+metrics enabled, and a root-path-aware
`suppress-application-uris` covering `/api/otel/v1/*` (an exporting child would self-loop),
`/daemon/*` (framed assets/HMR), `/git/*` (clone/push negotiations), `/mcp/*` (agent tool calls).
The qits-in-qits daemon start script flips the SDK on and bridges the endpoint
(`-Dquarkus.otel.sdk.disabled=false -Dquarkus.otel.exporter.otlp.endpoint=…` — dev mode ignores
the plain env var). `quarkus.log.file.enable=true` writes `quarkus.log` for a FILE log source
(tests turn it off).

### Frontend `@qits/angular` integration (`service/src/main/webui`)

The SHA-pinned git dep (same pin as the fixture), `pnpm.onlyBuiltDependencies` +
the zone.js `packageExtensions` entry, two-phase init (`initQitsIntegration()` before
`bootstrapApplication` in `main.ts`), `provideQitsIntegration(withFeatureCapture())` +
`provideHttpClient(withFetch(), withInterceptors([authSessionInterceptor]))` in `app.config.ts`,
`withQitsSnapshot('promptContext')` on `PromptContextStore` (a capture of the qits UI carries the
staged prompt context), and the fixture's inline `<base>` rebase script in `index.html`. At root,
`config.json` reports `telemetry: null` and the library stays fully dark.

### Subpath support (serving qits under `QITS_PUBLIC_BASE`)

The web-view proxy serves an app at `/daemon/{ws}/{daemonId}/` with no prefix stripping, so qits'
own UI and backend had to become servable under a base:

- **Frontend**: `@/shared/utils/app-base` (`appBasePath()`/`appUrl()`/`wsUrl()` derived from
  `document.baseURI`) wired into `provideApi(...)`, the workspace SSE `EventSource`, the terminal
  and chat `WebSocket`s, and the logout anchor. `ng serve` gains
  `--host 0.0.0.0 --serve-path "${QITS_PUBLIC_BASE:-/}"`.
- **Backend**: Quinoa's `ignored-path-prefixes` are `${quarkus.http.root-path:/}`-prefixed;
  `QitsAuthPolicy` strips the root path before `PublicPaths` matching; `DaemonProxyRoute` and
  `DevModeSpaFallbackRoute` do root-path-aware path arithmetic (`service/.../http/RootPath.java`).
- **Two dev-mode traps found and fixed** (both would have silently killed any based run):
  1. *Quinoa readiness probe*: Quinoa GETs its `check-path` (default `/`) and accepts only
     200/404 — but `ng serve --serve-path` answers `/` with a **302** to the base, so Quinoa
     declared the dev server dead and killed it on a 30 s loop. Fixed with
     `quarkus.quinoa.dev-server.check-path=${quarkus.http.root-path:/}`.
  2. *Dev-proxy self-loop*: the webui's `/daemon → :8080` proxy rule matched the serve path
     itself (`/daemon/{ws}/{d}/…`), bouncing every app request back to Quarkus. The static
     `proxy.conf.json` became the fixture-style env-keyed `proxy.conf.js` (`{base}api`,
     `{base}daemon`), collapsing to the old entries at base `/`.

At the default root path every one of these expands/collapses to the previous behavior — verified
by the full service + webui suites and a browser click-through at `/` and under
`/daemon/ws-x/d-x/` (SPA boots, routes, and calls its API under the prefix with zero console
errors in both).

## Web-view topology for qits itself

The qits daemon frames **port 8080 (Quarkus)** with `entryPath: "projects"` — unlike the fixture's
4200-framing — because qits' UI is SSE/websocket-heavy on `/api`: framing Quarkus serves REST,
SSE and websockets-next natively and reuses the everyday Quinoa→ng dev proxy for the SPA. With the
check-path fix, Quarkus' "Listening on:" line only appears after Quinoa's probe saw the dev server
up, so it doubles as the daemon ready pattern.

## Known limitations

- A child qits in a workspace container has **no docker socket**: its own workspace-container
  features fail lazily on first use (provisioning is lazy by design — browsing, API, telemetry,
  and the UI all work). Nested web views therefore can't materialize.
- `quarkus.http.root-path` is **build-time**: fine for the `quarkus:dev` daemon (`-D` at launch),
  impossible to rebase for an already-packaged child.
- Unframed, the relayed capture `ingestUrl` is container-internal and unreachable from a browser —
  the OPTIONS probe fails and the button hides (by design). Framed, the library posts same-origin
  `/api/capture`, which is the **parent's** ingest: captures of a managed qits land in the parent.
- The first in-container build of qits is heavy (full reactor + pnpm), and parent + child dev
  servers together are memory-hungry.

## Verification

- `./mvnw -pl domain test && ./mvnw -pl service test -Dqits.variant=forwardauth` (includes
  `OtelTeeTest`, `OtelTeeUnreachableTest`, `ConfigResource*Test`) and the `auth/*` suites
  (`PublicPathsTest` covers the new entry); webui `pnpm test && pnpm lint && pnpm build`
  (includes `app-base.spec.ts`).
- Standalone subpath smoke: `QITS_PUBLIC_BASE=/daemon/ws-x/d-x/ ./mvnw -pl service -am quarkus:dev
  -Dquarkus.bootstrap.workspace-discovery=true -Dqits.variant=forwardauth
  -Dquarkus.http.root-path=/daemon/ws-x/d-x/` → SPA, deep links, `api/config.json`,
  `api/auth/me`, `q/health`, git host and MCP all answer under the prefix; nothing at `/`.
- The real qits-in-qits walk is the registration guide's acceptance section.
