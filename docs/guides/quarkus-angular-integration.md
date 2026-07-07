# Integrating a Quarkus + Quinoa + Angular app with qits

This guide walks a **stock `code.quarkus.io` starter** (extensions `rest-jackson` +
`quinoa`, Angular in `src/main/webui/`) to a fully qits-managed app: framework-aware file
browsing, a web-viewable dev-server daemon, log observation, backend OTEL, and frontend OTEL
through the backend gateway. It was written by performing exactly this walk on a fresh starter
(2026-07-06/07) and cross-checking against the reference implementation, the
[`testing-repo-quarkus-angular` fixture](../features/2026-07-05_servable-quarkus-angular-fixture.md)
— every snippet below is the validated form.

It is written for two readers: a **human** integrating their own repo, and the **coding agent**
(point a workspace chat at this file). Steps are imperative, snippets are copy-paste-complete,
and every tier ends in a *Verify* block. The tiers are ordered but independent — stopping after
any tier leaves a working setup.

This is a *current-state contract* document: when a feature changes the contract, update this
guide in place (the `seed-webapp` fixture E2E loop is the executable twin; if seeding or the
fixture breaks, this guide is stale too).

## Prerequisites

- qits running (`./mvnw -pl service quarkus:dev`, UI on `:8080`).
- Docker with the workspace image built: `docker build -t qits/workspace docker/workspace`.
- What the container guarantees your app (from `docker/workspace/Dockerfile`): Debian bookworm,
  **JDK 25** (Temurin), **Node 22 + pnpm** (corepack), git, python3, tmux, the Claude Code CLI.
  The container runs as your host uid with the workspace cloned at **`/workspace`**; `HOME` is
  the workspace, so Maven/pnpm caches land in `/workspace/.m2`, `/workspace/.cache`, … and
  survive daemon restarts (but not container recreation).
- Your app builds with a **committed `./mvnw`** and pnpm (commit `pnpm-lock.yaml` — it is also
  how Quinoa detects the package manager).

Two rules learned the hard way, used throughout:

1. **Daemon definition changes need a manual daemon stop + start.** A crash-triggered relaunch
   reuses the definition captured at launch time, so an updated `webView`/observer/startScript
   does not take effect until a fresh start (see the
   [stale-definition issue](../issues/2026-07-06_daemon-relaunch-uses-stale-definition-after-webview-update.md)).
2. **Port publishing is container-create-time only.** Adding or changing `webView.port` on a
   live workspace needs a container recreate: `POST …/stop-container` then
   `POST …/ensure-container`, then a daemon start. (After a docker/host restart, the same
   recreate sequence is currently also the fix for wedged containers — see
   [this issue](../issues/2026-07-07_ensure-container-noops-on-exited-container-after-host-restart.md).)

## Registering the app

Repositories are created under a project; local paths and https/ssh remotes both work as clone
URLs. Registration mirrors the repo into qits' bare origin and auto-creates a `main` workspace
with a container. **The import is one-time** — qits owns its origin afterwards; later changes
you make outside qits do not sync in (develop inside the workspace: agent chat, terminal, or
the file browser).

```bash
curl -s -X POST http://localhost:8080/api/projects \
  -H 'Content-Type: application/json' -d '{"name": "My App"}'
# → {"project":{"id":"<projectId>", ...}}

curl -s -X POST http://localhost:8080/api/projects/<projectId>/repositories \
  -H 'Content-Type: application/json' \
  -d '{"url": "/absolute/path/or/remote/url", "archetype": "SERVICE"}'
# → {"repository":{"id":"<repoId>", "mainBranch":"main", ...}}
```

UI: *Projects → New project → Add repository*.

---

## Tier 0 — repo shape: detection and agent context

What qits reads from the clone alone, no configuration:

| Signal in the repo | What it enables |
|---|---|
| root `pom.xml` mentioning `quarkus` | **Quarkus** framework chip + filter in the file browser |
| `src/main/webui/angular.json` | **Angular** chip + filter |
| a `docs/` directory containing `*.md` | **Docs** chip (a root README alone does not count) |
| `foo.spec.ts` beside `foo.ts`; `src/test/java/**/FooTest.java` | **Code / Test tabs** on the source file |
| `CLAUDE.md` + `.claude/settings.json` | context + pre-approved commands for the workspace coding agent |

A stock starter already has the first two, and the Angular scaffold's `app.spec.ts` already
demonstrates the spec pairing. Add the rest:

- `docs/README.md` — endpoints, how to run. Anything; it just has to exist.
- `CLAUDE.md` — build/test commands, layout, conventions (e.g. "never hardcode a leading
  `/api`", see Tier 2).
- `.claude/settings.json` — pre-approve the harmless loops:

```json
{
  "permissions": {
    "allow": ["Bash(./mvnw test)", "Bash(./mvnw package)", "Bash(./mvnw quarkus:dev)"]
  }
}
```

**Starter cleanup** (once, if you scaffolded with the `quinoa` extension): the codestart ships a
Vite vanilla-JS `src/main/webui` and two properties you must remove when replacing it with your
Angular app — `quarkus.quinoa.ui-root-path=quinoa` (would serve the SPA under `/quinoa`) and
`quarkus.quinoa.package-manager-install=true` (pins node 20.10, too old for Angular 21; the
workspace container provides Node 22). Quinoa then auto-detects Angular + pnpm from
`angular.json`/`pnpm-lock.yaml`.

Optionally append container-cache dirs to `.gitignore` so in-container `git status` stays
clean: `.m2/`, `.cache/`, `.local/`, `.angular/`, `.redhat/`.

**Verify:** open the workspace (*Projects → repo → `main`*) — the Files tab shows **Quarkus**,
**Angular** and **Docs** chips; opening `app.ts` shows *Code / Test* tabs.

---

## Tier 1 — the dev-server daemon

Daemons are defined **per repository** and run **per workspace** (see
[daemons](../features/2026-07-04_daemons.md)). Create the dev-server daemon:

```bash
curl -s -X POST http://localhost:8080/api/repositories/<repoId>/daemons \
  -H 'Content-Type: application/json' -d '{
  "name": "Quarkus dev server",
  "description": "Runs ./mvnw quarkus:dev — REST API + Angular SPA via Quinoa.",
  "startScript": "./mvnw -q quarkus:dev -Dquarkus.http.host=0.0.0.0 -Dquarkus.http.port=8080 -Dquarkus.http.root-path=\"${QITS_PUBLIC_BASE:-/}\" -Dquarkus.otel.exporter.otlp.endpoint=\"${OTEL_EXPORTER_OTLP_ENDPOINT:-http://localhost:4317}\"",
  "readyPattern": "(?i)dev server is up|Application bundle generation complete|Local:.*:4200",
  "stopSignal": "TERM",
  "restartPolicy": "ON_FAILURE",
  "maxRestarts": 3
}'
```

Every flag in the `startScript` is load-bearing:

- `-Dquarkus.http.host=0.0.0.0` — Quarkus must be reachable beyond container loopback.
- `-Dquarkus.http.root-path="${QITS_PUBLIC_BASE:-/}"` — serves the whole app (API included)
  under the daemon's proxy prefix (Tier 2). The `:-/` default keeps a standalone run at `/`.
- `-Dquarkus.otel.exporter.otlp.endpoint=…` — **dev mode does not honor the
  `OTEL_EXPORTER_OTLP_ENDPOINT` env var** (Quarkus reads only `quarkus.otel.*`); this bridge
  hands the injected value in (Tier 4;
  [resolved issue](../issues/resolved/2026-07-05_quarkus-otel-endpoint-not-bridged.md)). Before
  Tier 4 adds the extension it is inert — Quarkus logs an ignorable
  "Unrecognized configuration key" warning.
- The `readyPattern` matches the **Angular dev server's** readiness lines (Quinoa forwards
  them), not Quarkus' own `Listening on:` — READY should mean "the thing the web view frames
  answers", which is `:4200` (Tier 2).

Start it in a workspace and watch the state:

```bash
curl -s -X POST http://localhost:8080/api/repositories/<repoId>/workspaces/main/daemons/<daemonId>/start -d '{}' -H 'Content-Type: application/json'
curl -s http://localhost:8080/api/repositories/<repoId>/workspaces/main/daemons   # entries[].instance.status
```

**First-launch cost:** the container starts with empty caches, so the first run downloads the
full Maven + pnpm dependency trees — READY took ~4 minutes on the validation walk. Restarts are
warm (<20 s) as long as the container lives, because the caches persist under `/workspace`.

**Verify:** status reaches `READY`; a `stop` (wait for `STOPPED` — stopping is asynchronous)
followed by `start` reaches `READY` again quickly.

---

## Tier 2 — the web view

The trap tier. The daemon web view frames your app in an iframe served through qits' proxy at
`/daemon/{workspaceId}/{daemonId}/` — the value qits injects as **`$QITS_PUBLIC_BASE`**. The
frame targets the **frontend dev server (`:4200`)** for HMR; the SPA's API calls travel
base-relative through the ng dev-server proxy to Quarkus, which serves under the same prefix
via `quarkus.http.root-path` (already in the Tier 1 startScript). Full design:
[daemon web-view configuration](../features/2026-07-06_daemon-webview-configuration.md).

### App-side changes (five pieces, all required)

**1. `src/main/webui/package.json`** — the `start` script Quinoa runs:

```json
"start": "ng serve --host 0.0.0.0 --serve-path \"${QITS_PUBLIC_BASE:-/}\" --proxy-config proxy.conf.js"
```

(`--host 0.0.0.0`: stock `ng serve` binds container loopback and the published port would reach
nothing.)

**2. `src/main/webui/proxy.conf.js`** — forward the SPA's own API calls to Quarkus:

```js
const base = process.env.QITS_PUBLIC_BASE || '/';
const target = { target: 'http://localhost:8080', secure: false };

module.exports = {
  [base + 'api']: target,   // the based path used under the qits web view
  '/api': target,           // keeps a standalone `pnpm start` working
};
```

**3. `src/main/webui/src/index.html`** — runtime `<base>` rebase. Angular 21's esbuild dev
server has `--serve-path` but **no `--base-href`**, so rebase at runtime, before Angular boots:

```html
<base href="/">
<script>
  (function () {
    var match = location.pathname.match(/^\/daemon\/[^/]+\/[^/]+\//);
    if (match) document.querySelector('base').setAttribute('href', match[0]);
  })();
</script>
```

**4. Base-relative API calls everywhere in the SPA** — `http.post('api/greetings', …)`, never
`'/api/greetings'`. Relative URLs resolve against the rebased `<base>`, so the same code works
at `/` and under the prefix. Put this convention in your `CLAUDE.md`.

**5. `src/main/resources/application.properties`** — serve the API under `/api` and make
Quinoa's SPA-routing exclusion **root-path-aware**:

```properties
quarkus.rest.path=/api

quarkus.quinoa.enable-spa-routing=true
quarkus.quinoa.ignored-path-prefixes=${quarkus.http.root-path:/}api
quarkus.quinoa.dev-server.port=4200
```

The `${quarkus.http.root-path:/}` prefix is the subtle one: Quinoa matches ignored prefixes
against the **full** request path, so a bare `/api` silently stops matching under the daemon
prefix — and then **every API GET loops forever** between Quinoa's dev proxy and ng's API proxy.
POSTs are unaffected (Quinoa only handles GET/HEAD), so a POST-only app hides the
misconfiguration until the first GET. See the
[resolved issue](../issues/resolved/2026-07-06_quinoa-ignored-prefix-root-path-loop.md).

### qits-side

Add the web view to the daemon definition (`PUT` replaces the definition — send the full body,
Tier 1's fields plus):

```json
"webView": {"port": 4200, "entryPath": "greeting"}
```

`port` is the container-loopback port the proxy targets — **the frontend dev server**, not
Quarkus. `entryPath` is the route the frame opens (omit for the app root). Then, because ports
publish at container creation:

```bash
curl -s -X POST http://localhost:8080/api/repositories/<repoId>/workspaces/main/stop-container   -d '{}' -H 'Content-Type: application/json'
curl -s -X POST http://localhost:8080/api/repositories/<repoId>/workspaces/main/ensure-container -d '{}' -H 'Content-Type: application/json'
```

then **stop + start the daemon** (rule 1 — an auto-relaunch after the container kill would run
the stale, webView-less definition and the proxy would 404). The instance's
`needsContainerRecreate` field / the amber badge in the UI tells you when this dance is needed.

### Symptoms of getting it wrong

| Symptom | Cause |
|---|---|
| Blank iframe, asset 404s in devtools | missing `--serve-path` / `<base>` rebase — assets resolve against `/` |
| SPA renders, API calls 404 | fetches hardcode `/api` instead of base-relative `api/…` |
| SPA renders, API **GET**s hang forever (POSTs fine) | `ignored-path-prefixes` not root-path-aware — the Quinoa↔ng loop |
| Frame shows 502 "container does not publish the daemon's port" | `webView.port` added after the container existed — recreate it |
| Frame shows 404 "No web-viewable daemon here." while the API lists a `proxyPath` | daemon relaunched with a stale definition — manual daemon stop + start |
| `ERR_EMPTY_RESPONSE` in the frame | `ng serve` without `--host 0.0.0.0` |

**Verify (the walk's strict acceptance):** open the workspace page → *Web view* floaty → the
frame renders your SPA on the `entryPath` route; an API POST made by the SPA succeeds (check the
rendered result, or `curl -X POST http://localhost:8080/daemon/main/<daemonId>/api/…`); an API
GET through the prefix returns promptly (no loop); editing a frontend file in the workspace
hot-reloads the frame; the *Pick element* DOM picker highlights and records a pick.

---

## Tier 3 — logs to qits

Daemon output is observed line-by-line; a rolling file gets you the full backend log even when
`-q` quiets Maven. See
[daemon log observation](../features/2026-07-04_daemon-log-observation-expansion.md).

**App-side** — `application.properties`:

```properties
quarkus.log.file.enable=true
quarkus.log.file.path=quarkus.log
```

(Workspace-relative path; also add `*.log` and `*.log.[0-9]*` to `.gitignore` for the rotation
files.)

**qits-side** — extend the daemon definition (full `PUT` + daemon stop/start, as always):

```json
"observers": [
  {"kind": "LOG_LEVEL"},
  {"kind": "PATTERN", "pattern": "(?i)(BUILD FAILURE|Failed to start Quarkus|Live reload failed)", "severity": "ERROR"}
],
"sources": [
  {"path": "quarkus.log", "label": "Quarkus dev log"}
]
```

`LOG_LEVEL` is zero-config severity classification (log levels, exception class names, stack
traces); the `PATTERN` observer adds the stack-specific failure lines that don't carry a
severity word. The `FILE` source tails `quarkus.log` with `tail -F` semantics.

**Verify:** provoke an error (hot-reload a `throw` into an endpoint and call it — remember the
container clone is live-editable) → within seconds the workspace **Events** tab shows
`ERROR_DETECTED` entries from *both* sources (`output` and `quarkus.log:<line>`), also at
`GET /api/daemon-events?repoId=…&workspaceId=…`; the daemon transitions to `DEGRADED`
(status is sticky — restart the daemon to clear it); a running workspace chat receives a
`[daemon:…]` note. Revert the throw.

---

## Tier 4 — backend OTEL

**App-side** — `pom.xml`:

```xml
<dependency>
    <groupId>io.quarkus</groupId>
    <artifactId>quarkus-opentelemetry</artifactId>
</dependency>
```

`application.properties` (traces are on by default; logs/metrics are opt-in):

```properties
quarkus.otel.logs.enabled=true
quarkus.otel.metrics.enabled=true
quarkus.otel.exporter.otlp.protocol=http/protobuf
%test.quarkus.otel.sdk.disabled=true
```

Endpoint, service name and resource attributes stay out of the file — qits injects them per
launch (see the env table below), and the Tier 1 startScript already bridges the endpoint into
dev mode. `%test` disables the SDK where no OTLP backend exists.

**qits-side** — set `"otel": true` in the daemon definition (full `PUT` + stop/start).

Two behaviors to know (both observed on the walk, both fine):

- Quarkus ignores `OTEL_SERVICE_NAME` like it ignores the endpoint env var — spans arrive under
  your **Maven artifactId** as service name. `OTEL_RESOURCE_ATTRIBUTES` *is* honored, which is
  what routes telemetry to the right workspace (`qits.workspace.id`).
- Metrics export on a ~60 s interval — the Metrics section fills a minute after first traffic.

**Verify:** drive a few requests through the web view → the workspace **Telemetry** tab shows
them under *Traces* (SERVER spans) and, after a minute, *Metrics* (JVM gauges). In a workspace
chat, the agent's `telemetryErrors`/`telemetryTrace`/`telemetrySlowSpans`/`telemetrySearchLogs`/
`telemetryMetrics` MCP tools are attached and answer.

---

## Tier 5 — frontend OTEL through the backend gateway

qits ships **no** SPA-side code for this — it is a convention
([spa-observability](../features/2026-07-06_spa-observability.md)): the backend acts as its
SPA's telemetry gateway with two small resources, and the SPA exports base-relative to its own
backend. Copy all four files from the fixture (they are app-agnostic; adjust the package):

1. **`ConfigResource`** — `GET /api/config.json`, relays the injected OTEL identity
   (`otel.exporter.otlp.endpoint` / `otel.resource.attributes` / `otel.service.name` via
   MicroProfile Config); returns `"telemetry": null` when no endpoint is configured — the gate
   that keeps a standalone or otel-off run dark.
2. **`OtelProxyResource`** — `POST /api/otel/v1/{traces|logs|metrics}`, byte-verbatim
   passthrough to `${endpoint}/v1/{signal}`; 404 when unconfigured, 502 on forward failure.
3. **`src/main/webui/src/telemetry.ts`** — the whole browser SDK setup + a
   `TelemetryErrorHandler`.
4. **`src/main/webui/src/main.ts`** — `initTelemetry().catch(() => undefined).then(() =>
   bootstrapApplication(App, appConfig))`.

Fixture source of truth:
`domain/src/test/resources/fixtures/testing-repo-quarkus-angular` (`main`) — including unit
tests for both resources worth copying along.

Frontend deps (versions validated 2026-07-06):

```bash
pnpm add @opentelemetry/api@^1.9.1 @opentelemetry/api-logs@^0.220.0 \
  @opentelemetry/exporter-logs-otlp-proto@^0.220.0 @opentelemetry/exporter-trace-otlp-proto@^0.220.0 \
  @opentelemetry/instrumentation@^0.220.0 @opentelemetry/instrumentation-document-load@^0.65.0 \
  @opentelemetry/instrumentation-fetch@^0.220.0 @opentelemetry/resources@^2.9.0 \
  @opentelemetry/sdk-logs@^0.220.0 @opentelemetry/sdk-trace-web@^2.9.0
```

`app.config.ts`:

```ts
providers: [
  provideBrowserGlobalErrorListeners(),
  provideRouter(routes),
  provideHttpClient(withFetch()),
  { provide: ErrorHandler, useClass: TelemetryErrorHandler },
],
```

And one more property (`application.properties`):

```properties
quarkus.otel.traces.suppress-application-uris=${quarkus.http.root-path:/}api/otel/v1/*
```

The traps, each one load-bearing (all encoded in the fixture's `telemetry.ts` — details in the
[feature doc](../features/2026-07-06_spa-observability.md)):

- **`provideHttpClient(withFetch())`** — Angular's default XHR backend is invisible to
  `FetchInstrumentation`: without it, no client span and no `traceparent`, so no full-stack
  traces. And `initTelemetry()` must complete **before** `bootstrapApplication` — `FetchBackend`
  captures `window.fetch` on first use, so the instrumentation has to patch it first.
- **Exporter URLs are verbatim** in the JS proto exporters (no `/v1/<signal>` appended,
  resolved against `location.href`, not `<base>`) — build absolute per-signal URLs from
  `document.baseURI`.
- **`ignoreUrls: [/\/api\/otel\/v1\//]`** on `FetchInstrumentation` — the exporters POST via
  `fetch()`; without the exclusion every export instruments itself, recursively.
- **Errors funnel through Angular's `ErrorHandler`**, not `window` listeners: zoneless Angular
  catches handler exceptions before they reach `window`, and
  `provideBrowserGlobalErrorListeners()` forwards the genuinely-global ones into `ErrorHandler`
  anyway. (Zoneless also means **no `@opentelemetry/context-zone`** — the default stack context
  manager is correct.)
- **Flush fast (`scheduledDelayMillis: 1000`)** — closing the web-view floaty *removes the
  iframe*, which fires no `pagehide`/`visibilitychange`; spans still in the default 5 s buffer
  are silently lost. Symptom: a briefly-opened web view leaves only server spans.
- **`suppress-application-uris`** (root-path-aware, same reason as the Quinoa prefix) — without
  it the backend mints a `POST /otel/v1/…` server span for every browser export batch.

**Verify:** open the web view and interact → the Telemetry tab shows **one trace per
interaction with the browser CLIENT span as root and the Quarkus SERVER span as its child**
(service `<name>-browser` vs the backend's); a provoked SPA error (e.g. a `throw` from a button
handler) appears in *Recent errors* as an ERROR log record under `<name>-browser`; *no*
`POST /otel/v1/…` spans appear in Traces.

---

## Reference: what qits injects, and what the app must do with it

Injected into every daemon/action/chat exec (`CommandService.prepare` →
`OtelEnvironment`/`DaemonProxyPath`); explicit entries in the daemon's `environment` map win
over all of these.

| Variable | When | Value shape | The app must… |
|---|---|---|---|
| `TERM` | always | `xterm-256color` | nothing (sane terminal output) |
| `QITS_PUBLIC_BASE` | daemon has a `webView` | `/daemon/{workspaceId}/{daemonId}/` (stable across restarts) | serve under it: `quarkus.http.root-path`, `ng serve --serve-path`, `<base>` rebase, proxy key |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | daemon `otel: true` | `http://<qits-host>:<port>/api/otel` (container-reachable) | bridge into dev mode via `-Dquarkus.otel.exporter.otlp.endpoint` (not honored as env); relay to the browser via `config.json` gate |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `otel: true` | `http/protobuf` | match it (`quarkus.otel.exporter.otlp.protocol`) |
| `OTEL_SERVICE_NAME` | `otel: true` | the daemon name | backend ignores it (artifactId wins — fine); relay to the browser, which appends `-browser` |
| `OTEL_RESOURCE_ATTRIBUTES` | `otel: true` | `qits.workspace.id=…,qits.repository.id=…,qits.command.id=…` | leave alone (Quarkus honors it — it routes telemetry to your workspace); relay verbatim to the browser |

## Final acceptance

Your workspace now supports the same manual E2E loop as the `seed-webapp` fixture (the
executable form of this guide, `./mvnw -pl cli quarkus:run -Dcli.args=seed-webapp`):

1. Daemon starts → `READY` (Tier 1).
2. Web view renders the SPA through the proxy prefix; an API round trip works; HMR live; DOM
   picker picks (Tier 2).
3. A provoked backend error → Events tab + chat note (Tier 3).
4. Interactions → full-stack traces (browser CLIENT rooting Quarkus SERVER) + metrics in the
   Telemetry tab; a provoked SPA error → Recent errors; agent telemetry MCP tools attached
   (Tiers 4–5).

## Related documents

- Features: [daemons](../features/2026-07-04_daemons.md) ·
  [daemon web-view configuration](../features/2026-07-06_daemon-webview-configuration.md) ·
  [daemon log observation](../features/2026-07-04_daemon-log-observation-expansion.md) ·
  [observability](../features/2026-07-04_observability.md) ·
  [spa-observability](../features/2026-07-06_spa-observability.md) ·
  [framework-aware file browser](../features/2026-07-03_framework-aware-file-browser.md) ·
  [servable fixture](../features/2026-07-05_servable-quarkus-angular-fixture.md)
- Resolved issues distilled above:
  [OTEL endpoint not bridged in dev mode](../issues/resolved/2026-07-05_quarkus-otel-endpoint-not-bridged.md) ·
  [Quinoa ignored-prefix root-path loop](../issues/resolved/2026-07-06_quinoa-ignored-prefix-root-path-loop.md)
- Issues found while validating this guide:
  [stale daemon definition on relaunch](../issues/2026-07-06_daemon-relaunch-uses-stale-definition-after-webview-update.md) ·
  [ensure-container no-ops on exited containers](../issues/2026-07-07_ensure-container-noops-on-exited-container-after-host-restart.md) ·
  [daemons empty state references removed global library](../issues/2026-07-06_workspace-daemons-empty-state-references-removed-global-library.md)
