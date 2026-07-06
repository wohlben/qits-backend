# SPA observability: the backend proxies browser OTLP and relays identity via `/api/config.json`

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
the full OTEL picture, because qits injected it into its environment — acts as its frontend's
telemetry gateway. Two decrees: it serves a small `/api/config.json` relaying telemetry identity to
its own SPA, and it **proxies OTLP through** — the SPA posts telemetry to its own backend
(base-relative, like any other API call), which forwards the bytes to whatever
`OTEL_EXPORTER_OTLP_ENDPOINT` it was given. This is the standard edge-gateway pattern for browser
telemetry, and it maps cleanly onto a later production build (same endpoints, values from
`application.properties`, collector reachable only from the backend). Browser telemetry lands in
the same per-workspace bucket as the backend's, and — because fetch instrumentation propagates
`traceparent` — a click in the web view produces **one full-stack trace** (browser fetch span →
dev-proxy → Quarkus server span) in the Recent traces drill-down. **qits ships zero new backend
code**; the deliverable is the decree plus the fixture as its reference implementation.

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
- **Modifies the [servable quarkus-angular fixture](../features/2026-07-05_servable-quarkus-angular-fixture.md)**
  — the fixture gains the config resource, the OTLP passthrough and the instrumented SPA,
  mirroring how its backend is the reference for the env-var path.
- **Robust against the [cross-origin proxy mode backlog idea](../backlog-ideas/daemon-proxy-cross-origin-mode.md)**
  — because the SPA only ever talks to *its own backend*, browser telemetry survives a frame that
  is no longer same-origin with qits (where a direct-to-qits exporter would hit CORS). That
  backlog idea's script-injection machinery also remains the natural home for a future *zero-code*
  RUM variant; this idea keeps the observability feature's stance that instrumentation is the
  target app's business.
- **Followed by the [Quarkus/Angular integration guide](quarkus-angular-integration-guide.md)** —
  once this lands, the full integration contract (daemon config, web view, logs, backend + frontend
  OTEL) gets documented end-to-end as a user-facing guide; it is sequenced after this idea so it
  documents the complete picture in one pass.
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
lacks. Its environment carries the endpoint (`OTEL_EXPORTER_OTLP_ENDPOINT` — a
*container-reachable* address the browser could not reliably use anyway), the complete identity
(`OTEL_RESOURCE_ATTRIBUTES=qits.workspace.id=…,qits.repository.id=…,qits.command.id=…` — including
the repository id, which appears *nowhere* the browser can see), and the service name. The app
already has a frontend→backend channel. So the backend relays the identity and carries the data.

## The decree

A workspace app that wants browser telemetry exposes two things to its own frontend. Both are the
app's business to implement (in the fixture: two small JAX-RS resources); the *shape* is the
convention.

**1. `GET /api/config.json` — identity relay.**

```json
{
  "telemetry": {
    "resourceAttributes": {
      "qits.workspace.id": "…",
      "qits.repository.id": "…",
      "qits.command.id": "…"
    },
    "serviceName": "Quarkus dev server"
  }
}
```

- Built from the backend's own runtime config: in dev under qits, the injected `OTEL_*` environment
  (Quarkus reads env through MicroProfile Config for free); **in a production build the same
  endpoint serves values from `application.properties`** — the pattern survives the dev/prod
  boundary, which is the point of decreeing config endpoints instead of URL-sniffing hacks.
- `telemetry` is `null` when the backend has no OTEL config — which doubles as the **gate**: the
  fixture run standalone (no qits, no env) reports no telemetry and the SPA stays dark; a daemon
  with the `otel` toggle off likewise. The daemon's existing toggle thus gates browser export too,
  with no new mechanism.
- The attributes must ride the config relay because the alternative — the backend stamping them
  into the OTLP payload during the proxy pass — means decoding and re-encoding protobuf in the app.
  Too heavy for a fixture, and not what a real app would do; the proxy stays a byte-verbatim pipe.

**2. `POST /api/otel/v1/{traces|logs|metrics}` — OTLP passthrough.**

The SPA exports to its **own backend**, base-relative like every other API call; the backend
forwards the request body verbatim to `${OTEL_EXPORTER_OTLP_ENDPOINT}/v1/{signal}` (which *it* can
reach — it lives in the container the address was composed for) and relays the response status.
`404` when the endpoint env is unset (the same gate as above; a correctly-gated SPA never calls
it). Forwarding failures (qits down) return `502` and the browser SDK's normal retry/drop behavior
applies — telemetry is best-effort by design.

Why proxy-through instead of the SPA posting to qits' receiver directly (the origin-absolute
`/api/otel` on the frame's origin, which happens to be qits through the same-origin daemon proxy):

- **No addressing subtlety.** Base-relative URLs are the one thing the framed SPA already does
  correctly everywhere (`<base>` rebase, dev proxy). Direct export would need the SPA to compose
  an origin-absolute URL and *know* that its frame origin is qits — an invisible coupling.
- **Topology-proof.** Direct export silently depends on the frame being same-origin with qits: the
  parked cross-origin proxy mode would break it with CORS, and a production SPA posting straight to
  a collector needs CORS + an exposed collector anyway. An app-internal call survives all of it —
  in production the collector stays reachable only from the backend, which is how you want it.
- **Cost is small and honest:** one passthrough resource (accept `application/x-protobuf` bytes,
  forward, relay status) and a longer hop chain in dev (frame → daemon proxy → ng dev server → dev
  proxy → Quarkus → qits receiver) — all local. `TelemetryStore` windows on `receivedAtMillis`
  (server clock) either way, and the bytes arrive unmodified, so nothing downstream can tell the
  difference.

Nothing in qits changes. The browser self-stamps the relayed resource attributes, the backend pipes
the protobuf to the existing `POST /api/otel/v1/*`, and `TelemetryStore` buckets it exactly like
the backend's own telemetry. (A second alternative was considered and dropped earlier: a qits-side
`/api/otel/browser/{workspaceId}/…` ingest path stamping identity server-side by resolving the
workspace — unnecessary once the backend relays both ids, and it would have put a workspace lookup
in front of the store's deliberately dumb fail-closed contract.)

## The fixture: reference implementation

Three pieces in `testing-repo-quarkus-angular.git`:

**Backend** — a `ConfigResource` (`GET /api/config.json`) reading
`OTEL_EXPORTER_OTLP_ENDPOINT` / `OTEL_RESOURCE_ATTRIBUTES` / `OTEL_SERVICE_NAME` via MicroProfile
Config (`@ConfigProperty`, all optional): parses the `k=v,k=v` attribute list, returns
`telemetry: null` when the endpoint is unset. And an `OtelProxyResource`
(`POST /api/otel/v1/{signal}`): consumes `application/x-protobuf` as `byte[]`, forwards to
`${OTEL_EXPORTER_OTLP_ENDPOINT}/v1/{signal}` with the JDK `HttpClient`, relays the status; `404`
without the env, `502` on forward failure.

**Frontend** — a small `telemetry.ts` bootstrapped from `main.ts`:

- Fetch `api/config.json` (base-relative — through the dev proxy to the backend, works framed and
  standalone). `telemetry: null` ⇒ done, zero overhead.
- **Traces:** `@opentelemetry/sdk-trace-web` + `@opentelemetry/exporter-trace-otlp-proto`
  (`http/protobuf` works in the browser, matching the receiver's protobuf-only stance — no JSON
  ingestion needed, keeping that explicitly-deferred item deferred) with
  `@opentelemetry/instrumentation-document-load` and `@opentelemetry/instrumentation-fetch`,
  exporter URL = base-relative `api/otel` (the SDK appends `/v1/<signal>` itself, same as every
  other exporter). The passthrough calls must be **excluded from fetch instrumentation**
  (`ignoreUrls: [/api\/otel/]`) or every export would spawn a span exporting itself.
  Fetch instrumentation propagates **`traceparent`** on the `api/greetings` call; the dev proxy
  forwards headers verbatim and `quarkus-opentelemetry` continues the trace — the browser span
  becomes the *root* and the server span its child. `BatchSpanProcessor` with a
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
- **Web-vitals / browser metrics** — the metrics table exists, but iteration one sends traces +
  error logs only (the passthrough route accepts `metrics` from day one so the convention is
  complete); LCP/CLS/INP as OTLP metrics is a clean later add.
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
- **Should the passthrough stamp/override resource attrs after all?** A malicious-or-buggy SPA can
  stamp any workspace's ids (same unauthenticated trust level as the rest of qits, so: fine for
  now). If the fixture ever grows real protobuf handling, moving the stamp into the proxy would
  drop `resourceAttributes` from config.json and make the browser config nearly empty — revisit
  then, not before.
- **`sendBeacon` vs. XHR on unload.** The proto exporter uses XHR; if flush-on-`visibilitychange`
  proves lossy for last-interaction spans, revisit (possibly via the JSON exporter's beacon path —
  which would reopen the JSON-ingestion deferral). Measure first.

## Testing sketch

- **qits side: nothing to add.** The receiver/store paths a browser exercises are the existing
  ones; `OtelReceiverResourceTest`/`TelemetryStoreTest` already cover attr-carrying payloads
  bucketing correctly and attr-less payloads landing `_unscoped`.
- **Fixture backend (its own repo, not the qits build):** `ConfigResource` returns the parsed
  relay when the `OTEL_*` config is present and `telemetry: null` when absent; `OtelProxyResource`
  forwards bytes + content type verbatim and relays the status, `404`s without the env, `502`s when
  the upstream is unreachable.
- **Fixture manual E2E (part of the seed-webapp loop):** the demo-payoff flow above — full-stack
  trace in Recent traces, a provoked SPA error in the errors feed and via the workspace chat
  agent; the daemon with `otel` **off** → `config.json` reports null → the SPA sends nothing
  (network tab clean); fixture standalone likewise; no self-referential export spans (the
  `ignoreUrls` exclusion holds).
