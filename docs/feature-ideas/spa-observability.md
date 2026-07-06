# SPA observability: the backend relays its OTEL config to the browser via `/api/config.json`

## Introduction

The [observability](../features/2026-07-04_observability.md) pipeline instruments workspace apps by
injecting `OTEL_EXPORTER_OTLP_*` env vars at daemon launch — which reaches exactly the processes
qits spawns. The **browser half** of a workspace app is invisible: the fixture's Angular SPA runs
in the user's browser inside the web-view iframe, gets no env vars, and exports nothing. Interact
with the greeting demo and the Telemetry tab shows the `POST /greetings` **server** span — but no
document-load, no client-side fetch timing, and, most painfully, **a JS error in the SPA never
reaches the errors feed or the agent's telemetry MCP tools**. The
[workspace observation tabs](../features/2026-07-06_workspace-observation-tabs.md) made the flowing
telemetry visible, which is exactly how this gap surfaced: the traces that flow are all backend.

The fix is a **convention, not a qits feature**: the workspace app's backend — which *does* hold
the full OTEL picture, because qits injected it into its environment — serves a small
`/api/config.json` relaying the telemetry endpoint and identity to its own frontend. The SPA
fetches it at bootstrap, self-configures the OTEL web SDK from it, and exports to qits' existing
receiver. Its telemetry lands in the same per-workspace bucket as the backend's, and — because
fetch instrumentation propagates `traceparent` — a click in the web view produces **one full-stack
trace** (browser fetch span → dev-proxy → Quarkus server span) in the Recent traces drill-down.
**qits ships zero new backend code**; the deliverable is the decree plus the fixture as its
reference implementation.

Related/dependent plans:

- **Consumes [observability](../features/2026-07-04_observability.md) as-is** — receiver, decoder,
  store, MCP tools and REST twins are all unchanged. The store's bucketing contract
  (`qits.repository.id` + `qits.workspace.id` resource attrs, else `_unscoped`) is satisfied
  because the browser learns *both ids* from the backend's relayed `OTEL_RESOURCE_ATTRIBUTES`. The
  agent's `telemetryErrors`/`telemetryTrace` tools see browser spans for free.
- **Feeds [workspace observation tabs](../features/2026-07-06_workspace-observation-tabs.md)** —
  Recent traces, the errors feed and the log tail render browser telemetry with zero UI change
  (the log tail's service filter already distinguishes services, so `webapp-browser` vs `webapp`
  falls out).
- **Rides the [daemon web-view picker](../features/2026-07-05_daemon-webview-picker.md) /
  [web-view configuration](../features/2026-07-06_daemon-webview-configuration.md)** — the
  same-origin path-prefix proxy is what lets the SPA reach qits' receiver at an origin-relative
  `/api/otel` with no CORS, from both the packaged app (:8080) and the qits webui dev server
  (:4200, whose proxy already forwards `/api`).
- **Modifies the [servable quarkus-angular fixture](../features/2026-07-05_servable-quarkus-angular-fixture.md)**
  — the fixture gains the config resource and the instrumented SPA, mirroring how its backend is
  the reference for the env-var path.
- **Distinct from the [cross-origin proxy mode backlog idea](../backlog-ideas/daemon-proxy-cross-origin-mode.md)**
  — that idea's script-injection machinery is also the natural home for a future *zero-code* RUM
  variant (qits injects the instrumentation via the proxy); this idea keeps the observability
  feature's stance that instrumentation is the target app's business.
- **Not about qits' own Angular UI.** Self-observability of the qits SPA is a separate idea if
  ever wanted; "SPA" here means the *observed workspace app's* frontend.

## The problem, concretely

`seed-webapp`, greeting workspace, daemon running with `otel` on. Open the web view, post a
greeting, open the Telemetry tab:

1. **Recent traces** shows the Quarkus-side `POST /greetings` span — the trace *starts* at the
   server. The user experience (page load, the fetch's client-side latency including the dev-proxy
   hop) has no spans.
2. Break the SPA (an exception in a click handler, a failed fetch): **nothing** appears in the
   errors feed. The agent asked to "investigate why the button does nothing" has no telemetry to
   pull — the whole motivation of the observability feature stops at the process boundary.
3. The env-var injection seam (`OtelEnvironment`, composed in `CommandService.prepare()`) cannot
   fix this: browsers don't read env vars, and the SDKs' zero-code story
   (`NODE_OPTIONS`, `-javaagent`) has no browser equivalent.

But the asymmetry is the answer: the **backend half of the same app** holds everything the browser
lacks. Its environment carries the endpoint (`OTEL_EXPORTER_OTLP_ENDPOINT`), the complete identity
(`OTEL_RESOURCE_ATTRIBUTES=qits.workspace.id=…,qits.repository.id=…,qits.command.id=…` — including
the repository id, which appears *nowhere* the browser can see), and the service name. The app
already has a frontend→backend channel. So the backend relays.

## The decree: `/api/config.json`

A workspace app that wants browser telemetry exposes a config endpoint to its own frontend
(`/api/config.json` — in the fixture a tiny JAX-RS resource, not a static file; the name is the
contract, the implementation is the app's business):

```json
{
  "telemetry": {
    "otlpPath": "/api/otel",
    "resourceAttributes": {
      "qits.workspace.id": "…",
      "qits.repository.id": "…",
      "qits.command.id": "…"
    },
    "serviceName": "Quarkus dev server"
  }
}
```

- Built from the backend's own runtime config: in dev under qits, that is the injected `OTEL_*`
  environment (Quarkus reads env through MicroProfile Config for free); **in a production build the
  same endpoint serves values from `application.properties`** — the pattern survives the dev/prod
  boundary, which is the point of decreeing a config endpoint instead of URL-sniffing hacks.
- `telemetry` is `null` when the backend has no OTEL config — which doubles as the **gate**: the
  fixture run standalone (no qits, no env) reports no telemetry and the SPA stays dark; a daemon
  with the `otel` toggle off likewise. The daemon's existing toggle thus gates browser export too,
  with no new mechanism.
- **`otlpPath`, not the endpoint URL verbatim.** `OTEL_EXPORTER_OTLP_ENDPOINT` is the
  *container-reachable* address (`http://<git-host>:<qits-port>/api/otel` — on WSL2 the distro's
  eth0 IP). Handing it to the browser verbatim would mean a cross-origin POST to a host the browser
  may not reach, plus CORS machinery on the receiver. Instead the backend relays the URL's **path**
  and the SPA composes it against **its own origin** — which is qits' origin, because the frame is
  served through the same-origin daemon proxy. A production deployment pointing at a real external
  collector would serve a full URL in its own config; the fixture's contract stays path-based
  because same-origin is the topology qits guarantees.
- The SPA must treat the path as **origin-absolute** (`location.origin + otlpPath`), never
  base-relative: inside the frame, base-relative `api/…` URLs deliberately stay under the proxy
  prefix and land on the framed app's *dev server* — right for `api/greetings` and for fetching
  `config.json` itself, wrong for the exporter.

Nothing in qits changes for this. The browser self-stamps the relayed resource attributes, posts
protobuf to the existing `POST /api/otel/v1/{traces,logs}`, and `TelemetryStore` buckets it exactly
like the backend's telemetry. (An alternative was considered and dropped: a qits-side
`/api/otel/browser/{workspaceId}/…` ingest path that stamps identity server-side by resolving the
workspace. Unnecessary once the backend relays both ids, and it would have put a workspace lookup
in front of the store's deliberately dumb fail-closed contract.)

## The fixture: reference implementation

Two pieces in `testing-repo-quarkus-angular.git`:

**Backend** — a `ConfigResource` (JAX-RS, `GET /api/config.json`) reading
`OTEL_EXPORTER_OTLP_ENDPOINT` / `OTEL_RESOURCE_ATTRIBUTES` / `OTEL_SERVICE_NAME` via MicroProfile
Config (`@ConfigProperty`, all optional): parses the `k=v,k=v` attribute list, extracts the
endpoint's path, returns `telemetry: null` when the endpoint is unset.

**Frontend** — a small `telemetry.ts` bootstrapped from `main.ts`:

- Fetch `api/config.json` (base-relative — through the dev proxy to the backend, works framed and
  standalone). `telemetry: null` ⇒ done, zero overhead.
- **Traces:** `@opentelemetry/sdk-trace-web` + `@opentelemetry/exporter-trace-otlp-proto`
  (`http/protobuf` works in the browser, matching the receiver's protobuf-only stance — no JSON
  ingestion needed, keeping that explicitly-deferred item deferred) with
  `@opentelemetry/instrumentation-document-load` and `@opentelemetry/instrumentation-fetch`.
  Fetch instrumentation propagates **`traceparent`** on the same-origin `api/greetings` call; the
  dev proxy forwards headers verbatim and `quarkus-opentelemetry` continues the trace — the browser
  span becomes the *root* and the server span its child. `BatchSpanProcessor` with a
  flush-on-`visibilitychange` so spans survive tab switches/navigation.
- **Errors → logs:** `@opentelemetry/sdk-logs` + the proto logs exporter; global `error` /
  `unhandledrejection` listeners emit ERROR-severity log records (message + stack). Severity ≥ 17
  means they surface in the **existing errors feed** and `telemetryErrors` MCP tool with no query
  changes.
- **Resource:** the relayed `resourceAttributes` verbatim, plus
  `service.name = <relayed serviceName> + "-browser"` — the distinct name is what makes the
  log-tail service filter useful.
- Dev-only weight: the OTEL web SDK adds real kilobytes, but the fixture only ever runs `ng serve`;
  acceptable, and it's the honest reference for what a user's own app would do.

Fixture commit lands on `main` with `feature/greeting` rebased on top (still fast-forward),
`feature/diverged` untouched — same procedure as the web-view-configuration fixture change.
`seed-webapp` needs no change: the daemon already has `otel` on, which is now the one switch for
both halves.

## The demo payoff

`seed-webapp` → open the greeting workspace → web view → post a greeting:

- **Recent traces** shows a `documentLoad` span and a `POST api/greetings` trace whose drill-down
  contains *both* the browser fetch span and the Quarkus server span — one trace, full stack.
- Type a name that makes the SPA throw (or kill the backend and let the fetch fail) → the **errors
  feed** shows the browser-side error with its stack, and the workspace chat agent can pull it via
  `telemetryErrors` — "investigate the broken button" now works for frontend bugs too.

## Explicitly deferred

- **Zero-code injection via the daemon proxy** (qits injecting the instrumentation `<script>` into
  proxied HTML, RUM-style) — would make *any* framed app observable without app changes, but it's
  response-rewriting machinery that belongs with the
  [cross-origin proxy mode](../backlog-ideas/daemon-proxy-cross-origin-mode.md) injection seam.
  Trigger: wanting browser telemetry from an app whose source qits shouldn't touch.
- **CORS on the receiver** — only needed if a browser ever has to export cross-origin (a full-URL
  `telemetry.endpoint` pointing elsewhere than the frame's origin). The same-origin proxy topology
  makes it unnecessary today.
- **Web-vitals / browser metrics** — the metrics table exists, but iteration one sends traces +
  error logs only; LCP/CLS/INP as OTLP metrics is a clean later add.
- **Session/user correlation** (a session-id resource attr to group one browser tab's telemetry) —
  wait until multiple simultaneous web-view users are a real scenario.
- **qits' own UI self-observability** — different feature, different consumer; named here only to
  disambiguate.
- **XHR instrumentation** — the fixture uses `fetch`; `instrumentation-xml-http-request` only if a
  framed app needs it.

## Open questions

- **Zone context manager vs. zoneless.** The fixture is Angular 21; if it bootstraps zoneless,
  `@opentelemetry/context-zone` is wrong and the default stack-based context manager (fine for
  fetch/document-load, which don't need cross-async correlation from user code) should do. Confirm
  against the fixture's actual bootstrap before picking dependencies.
- **Config shape: relay `qits.command.id`?** The command id churns per daemon relaunch and the
  browser session may outlive it. Lean: relay whatever the env holds (it's identity the backend
  half also carries), and accept that a stale frame stamps the previous command id — bucketing only
  depends on the workspace/repository ids.
- **`sendBeacon` vs. XHR on unload.** The proto exporter uses XHR; if flush-on-`visibilitychange`
  proves lossy for last-interaction spans, revisit (possibly via the JSON exporter's beacon path —
  which would reopen the JSON-ingestion deferral). Measure first.

## Testing sketch

- **qits side: nothing to add.** The receiver/store paths a browser exercises are the existing
  ones; `OtelReceiverResourceTest`/`TelemetryStoreTest` already cover attr-carrying payloads
  bucketing correctly and attr-less payloads landing `_unscoped`.
- **Fixture backend (its own repo, not the qits build):** `ConfigResource` returns the parsed
  relay when the `OTEL_*` config is present and `telemetry: null` when absent; endpoint-path
  extraction handles the trailing-slash/`/api/otel` shape.
- **Fixture manual E2E (part of the seed-webapp loop):** the demo-payoff flow above — full-stack
  trace in Recent traces, a provoked SPA error in the errors feed and via the workspace chat
  agent; the daemon with `otel` **off** → `config.json` reports null → the SPA sends nothing
  (network tab clean); fixture standalone likewise.
