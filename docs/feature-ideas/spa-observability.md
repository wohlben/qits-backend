# SPA observability: browser telemetry from the web view into the workspace telemetry store

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

This idea closes the loop: the SPA in the web view exports OTLP to qits' existing in-process
receiver, its telemetry lands in the same per-workspace bucket as the backend's, and — because
fetch instrumentation propagates `traceparent` — a click in the web view produces **one full-stack
trace** (browser fetch span → dev-proxy → Quarkus server span) in the Recent traces drill-down.

Related/dependent plans:

- **Extends [observability](../features/2026-07-04_observability.md)** — the receiver, decoder,
  store, MCP tools and REST twins are all reused unchanged; the only backend addition is a
  browser-facing ingest path that stamps the workspace identity server-side (below). The agent's
  `telemetryErrors`/`telemetryTrace` tools see browser spans for free.
- **Feeds [workspace observation tabs](../features/2026-07-06_workspace-observation-tabs.md)** —
  Recent traces, the errors feed and the log tail render browser telemetry with zero UI change
  (the log tail's service filter already distinguishes services, so `webapp-browser` vs `webapp`
  falls out).
- **Rides the [daemon web-view picker](../features/2026-07-05_daemon-webview-picker.md) /
  [web-view configuration](../features/2026-07-06_daemon-webview-configuration.md)** — the
  same-origin path-prefix proxy is what makes this possible browser-side: the framed SPA shares
  qits' origin (no CORS), and its `/daemon/{workspaceId}/{daemonId}/` prefix — which the fixture's
  `index.html` already parses for the `<base>` rebase — is where it learns *which workspace it is*.
- **Modifies the [servable quarkus-angular fixture](../features/2026-07-05_servable-quarkus-angular-fixture.md)**
  — the fixture SPA gains the OTEL web SDK and becomes the reference example, mirroring how its
  backend is the reference for the env-var path.
- **Distinct from the [cross-origin proxy mode backlog idea](../backlog-ideas/daemon-proxy-cross-origin-mode.md)**
  — that idea's script-injection machinery is also the natural home for a future *zero-code* RUM
  variant (qits injects the instrumentation via the proxy); iteration one keeps the observability
  feature's stance that instrumentation is the target app's business.
- **Not about qits' own Angular UI.** Self-observability of the qits SPA (its errors/latency into
  its own store) is a separate idea if ever wanted; "SPA" here means the *observed workspace app's*
  frontend.

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

Two specific gaps make naive self-instrumentation land wrong even if the app tries:

- **Bucketing fails closed.** `TelemetryStore` buckets by `qits.repository.id` **and**
  `qits.workspace.id` resource attributes; missing either quarantines the data in `_unscoped`
  (bounded but unqueryable). The browser can learn its `workspaceId` from the proxy prefix, but the
  *repository id appears nowhere* in anything the browser sees.
- **Endpoint addressing is subtle.** Inside the frame, base-relative `api/…` URLs deliberately stay
  under the proxy prefix and land on the *dev server* (that's the web-view design). The OTLP
  exporter must post to the **origin-absolute** `/api/otel/…` path so it hits qits, not the framed
  app's own dev proxy.

## Part A — qits side: a browser ingest path that stamps identity server-side

Add a browser-facing twin of the receiver in `api/OtelReceiverResource` (service module,
`domain.telemetry.api`):

```
POST /api/otel/browser/{workspaceId}/v1/{traces|logs|metrics}
```

Same protobuf-only body handling (byte[], magic-byte gzip, `@Operation(hidden=true)`), but before
handing to `TelemetryDecoder`/`TelemetryStore` it:

1. Resolves the workspace (`workspaceId` → its repository) — unknown workspace ⇒ `404`, so garbage
   can't even grow the `_unscoped` bucket.
2. **Stamps** `qits.workspace.id` + `qits.repository.id` into the decoded records' resource
   attributes, *overriding* anything the SDK sent — the path segment is the identity, full stop.
   Implementation seam: `TelemetryDecoder` already flattens resource attrs; give the decode call an
   optional attribute-overlay parameter (or overlay the flattened map before `store.add(...)`), so
   `TelemetryStore` stays completely untouched.

Why this shape (and not alternatives):

- *Teach the store to resolve repo-from-workspace when the repo attr is missing* — rejected: the
  store is a dumb bounded buffer with no service dependencies; pulling a workspace lookup into its
  hot path muddies the fail-closed `_unscoped` contract.
- *Have the SPA stamp both attrs itself* — impossible for the repo id (see above) and undesirable
  anyway: server-side stamping means the browser SDK config stays generic (endpoint URL only, no
  qits-specific resource wiring).
- Security posture is unchanged: qits is an unauthenticated local dev tool; a browser that can
  reach `/api/otel` can already reach every other endpoint. The `workspaceId` path segment being
  client-supplied is the same trust level as the rest of the API. The existing `/api/otel/v1/*`
  path is untouched (backend exporters keep using it with real env-var-stamped attrs).

## Part B — fixture side: instrument the Angular SPA (the reference example)

The fixture app (`testing-repo-quarkus-angular.git`, `src/main/webui/`) gains a small
`telemetry.ts` bootstrapped from `main.ts`, gated the same way the `<base>` rebase is:

- **Gate + identity:** match `location.pathname` against `^/daemon/([^/]+)/[^/]+/` (the exact regex
  `index.html` already uses). No match ⇒ running standalone ⇒ **no telemetry, zero overhead**.
  Match ⇒ `workspaceId` is capture group 1 and the exporter endpoint is the origin-absolute
  `/api/otel/browser/${workspaceId}` (never base-relative — see the addressing gap above).
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
- **Resource:** `service.name = webapp-browser` (the browser doesn't know the daemon name and
  doesn't need to; the distinct name is what makes the log-tail service filter useful).
- Dev-only weight: the OTEL web SDK adds real kilobytes, but the fixture only ever runs `ng serve`;
  acceptable, and it's the honest reference for what a user's own app would do.

Fixture commit lands on `main` with `feature/greeting` rebased on top (still fast-forward),
`feature/diverged` untouched — same procedure as the web-view-configuration fixture change.
`seed-webapp` needs no change: the daemon, the web view and the `otel` toggle are already in place
(browser export is unconditional-when-framed, not gated on the daemon's `otel` flag — the flag
controls *env injection*, which the browser never sees; noted as an open question below).

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
- **Should the daemon's `otel` toggle gate browser export?** Lean **no** for iteration one: the
  toggle controls env injection into a process qits spawns; the browser SDK is the app's own code
  and the gate (framed-or-not) is structural. If a real "too chatty" case appears, the SPA could
  probe a qits config endpoint — machinery not worth building speculatively.
- **`sendBeacon` vs. XHR on unload.** The proto exporter uses XHR; if flush-on-`visibilitychange`
  proves lossy for last-interaction spans, revisit (possibly via the JSON exporter's beacon path —
  which would reopen the JSON-ingestion deferral). Measure first.

## Testing sketch

- **`OtelReceiverResourceTest`** (extend): POST to `/api/otel/browser/{workspaceId}/v1/traces` with
  a proto fixture carrying *no* resource attrs → spans land in the correct `repoId/workspaceId`
  bucket; a fixture carrying *forged* `qits.*` attrs → server-side stamp wins; unknown workspace →
  404 and the store (including `_unscoped`) stays empty; gzip + garbage behave like the existing
  paths.
- **`TelemetryDecoderTest`**: the attribute-overlay parameter overrides and passes through
  correctly.
- **Fixture (manual, part of the seed-webapp E2E loop):** the demo-payoff flow above — full-stack
  trace visible in Recent traces, a provoked SPA error visible in the errors feed and via the
  workspace chat agent; opening the fixture standalone (no `/daemon/` prefix) sends nothing
  (network tab clean).
- **No qits-frontend tests needed**: the Telemetry tab renders whatever the store holds; browser
  spans are just more spans.
