# Integrating a Quarkus + Quinoa + Angular app with qits

This guide walks a **stock `code.quarkus.io` starter** (extensions `rest-jackson` +
`quinoa`, Angular in `src/main/webui/`) to a fully qits-managed app: framework-aware file
browsing, a web-viewable dev-server daemon with per-service healthchecks, log observation,
backend OTEL, and frontend OTEL through the backend gateway. It was written by performing exactly this walk on a fresh starter
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

- qits running (`./mvnw -pl service -am quarkus:dev -Dquarkus.bootstrap.workspace-discovery=true`, UI on `:8080`).
- Docker with the workspace image built: `docker build -t qits/workspace docker/workspace`.
- What the container guarantees your app (from `docker/workspace/Dockerfile`): Debian bookworm,
  **JDK 25** (Temurin), **Node 22 + pnpm** (corepack), git, python3, tmux, the Claude Code CLI.
  The container runs as your host uid with the workspace cloned at **`/workspace`**; `HOME` is
  the workspace, so Maven/pnpm caches land in `/workspace/.m2`, `/workspace/.cache`, … and
  survive daemon restarts (but not container recreation).
- Your app builds with a **committed `./mvnw`** and pnpm (commit `pnpm-lock.yaml` — it is also
  how Quinoa detects the package manager).

Two rules learned the hard way, used throughout:

1. **Daemon definition changes take effect on the next (re)launch, not on the running process.**
   A live daemon keeps running the definition it started with; an updated
   `webView`/observer/startScript applies when it next launches. Both a manual daemon stop + start
   and an automatic crash-triggered relaunch re-read the current definition (the relaunch used to
   reuse a stale launch-time copy — [now fixed](../issues/resolved/2026-07-06_daemon-relaunch-uses-stale-definition-after-webview-update.md)),
   so a container recreate — which the supervisor sees as a crash — already picks up the new
   definition.
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

## Tier 0b — isolate the language server from the build (required)

**Why (do not skip this for a Java project):** the workspace runs a **Java language server** — the
coding agent's bundled **jdtls**, and VS Code's **redhat.java** if you also open the repo in an
IDE. Both import the project through **m2e**, whose Eclipse *output directory* defaults to the
**same `target/classes`** that Maven and your **`quarkus:dev` dev-server daemon** (Tier 1) use.
When the language server's model is briefly incomplete — right after a `mvn clean`, or mid
re-index — its background compiler writes half-resolved `*.class` stubs into that shared
`target/classes`. The running `quarkus:dev` then hot-reloads them and dies:

- `java.lang.Error: Unresolved compilation problems` (e.g. a Lombok `@Builder` method "undefined"), or
- a mass Arc **"Unsatisfied dependency"** for every generated MapStruct/Panache bean (broken/partial
  `*Impl` classes ArC can't index).

The agent's language server and the dev-server are fighting over the same output. **The fix is
client-agnostic and lives entirely in the POM**: give the language server its *own* build
directory so it can never touch `target/`. Add this profile to the **(root/parent) `pom.xml`** — it
is inherited by every module:

```xml
<profiles>
  <!-- IDE/agent-only build isolation. Activates ONLY under m2e — redhat.java AND the coding
       agent's jdtls both set the `m2e.version` user property on every Maven resolve (m2e-core's
       MavenExecutionContext), and no `./mvnw` CLI invocation sets it. Relocating the whole build
       DIRECTORY sends the language server's classes/test-classes/generated-sources to target-ide/,
       so Maven and the quarkus:dev daemon keep exclusive ownership of target/. Relocate
       <directory> (a profile's <build> may set it); do NOT try <outputDirectory> — a profile
       can't set it, and the Quarkus dev mojo can't resolve a property-indirected outputDirectory
       for reactor hot-reload deps. -->
  <profile>
    <id>m2e-separate-output</id>
    <activation>
      <property><name>m2e.version</name></property>
    </activation>
    <build>
      <directory>${project.basedir}/target-ide</directory>
    </build>
  </profile>
</profiles>
```

Then gitignore the IDE build dir (add beside the container-cache dirs from Tier 0):

```gitignore
target-ide/
```

`${project.basedir}` resolves per-module, so each module gets its own `target-ide/`. CLI builds
(`./mvnw …`, and `quarkus:dev`) never activate the profile and keep using `target/` — verified in
qits itself, where this replaced an earlier, wrong "disable the build cache for the module" patch
(see [maven-build-cache](../features/2026-07-05_maven-build-cache.md)).

**Verify:** with the `quarkus:dev` daemon running (Tier 1), edit a `.java` file and save. The
daemon hot-reloads cleanly — no `Unresolved compilation problems`, no mass "Unsatisfied
dependency". A `target-ide/` appears (the language server's output); `target/classes` stays owned
by Maven. If the IDE still shows stale red, reload the window so the language server re-imports.

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

## Tier 1b — healthchecks: per-service health dots

`READY` is a single bit, and this daemon stands up **two** servers (Quarkus `:8080` + the Angular
dev server `:4200` — one process group, one `readyPattern`). If Angular dies or wedges while
Quarkus stays up, the daemon still reads READY and the app is half-broken with no signal.
Healthchecks close that gap: named probes qits runs on an interval **inside the workspace
container**, each with its own green/red/grey dot beside the status chip. See
[daemon healthchecks](../features/2026-07-10_daemon-healthchecks.md).

**qits-side only — no app changes.** Extend the daemon definition (full `PUT`, as always):

```json
"healthChecks": [
  {"name": "Quarkus", "kind": "COMMAND",
   "command": "curl -fsS -m 2 \"http://127.0.0.1:8080${QITS_PUBLIC_BASE%/}/q/health\""},
  {"name": "Angular", "kind": "HTTP", "port": 4200, "path": "/", "expectStatus": "2xx,3xx,4xx"}
]
```

(That is exactly the `seed-webapp` reference pair. `/q/health` assumes `smallrye-health` in your
app — any always-200 API path works as well.)

What each choice is doing:

- **Probes run in the container's own network namespace** (`docker exec`), so `127.0.0.1:<port>`
  is the service's own loopback. **No port publishing, no container recreate** — unlike
  `webView.port` (rule 2), you can add or change checks freely; they apply on the next daemon
  (re)launch (rule 1).
- **Why the Quarkus check is a `COMMAND`, not `HTTP`:** after Tier 2 your backend serves under
  `$QITS_PUBLIC_BASE` (`quarkus.http.root-path`), so `/q/health` is *not* at the bare root — and
  the `HTTP` kind is deliberately shell-free (a plain curl argv; no env expansion in `path`), so
  it cannot express `${QITS_PUBLIC_BASE%/}/q/health`. A `COMMAND` check is a bash script and can.
  **Before Tier 2** (no root-path yet) the plain form works fine:
  `{"name": "Quarkus", "kind": "HTTP", "port": 8080, "path": "/q/health"}`. All probes get
  `QITS_PUBLIC_BASE` in their env (plus the daemon's own `environment` map).
- **The Angular check accepts `4xx`** — under `--serve-path`, bare `/` on `:4200` may 404 or
  redirect; any HTTP answer means the dev server is serving, while connection-refused (red) means
  it's compiling or dead. That refused-while-compiling window is the demo: start the daemon and
  watch Quarkus go green while Angular sits red, then flips.
- There is also a dependency-free **`TCP`** kind (`{"kind": "TCP", "port": …}` — a bash
  `/dev/tcp` connect) for ports that don't speak HTTP.
- **Defaults:** probe every 5 s (`intervalMs`), 2 s timeout (`timeoutMs`), green after 1 success
  (`healthyThreshold`), red only after 3 consecutive failures (`unhealthyThreshold` — debounces a
  transient refusal), first probe after the daemon's ready grace (`initialDelayMs`). Check names
  must be unique within the daemon.

Semantics to rely on (and not fight):

- **Display-only.** Health never changes `DaemonStatus`, never restarts anything, never writes a
  `daemon_event` row. The dots sit *beside* the chip; a READY daemon with a red dot is exactly
  the "half-down" state the feature exists to show.
- **Live gauge, not history.** Only the latest result per check is kept, in memory: a qits
  restart drops it (dots grey, then repopulate within one interval), a stopped daemon reads all
  grey — never a stale red. `UNHEALTHY` means the probe ran and got a bad answer (wrong status,
  nonzero exit, timeout); grey `UNKNOWN` means "no verdict" (not started, or the probe itself
  couldn't run — e.g. a missing tool).
- The dots update over the workspace's existing SSE feed (on state flips), and the hover tooltip
  carries latency + the failing evidence (`exit 7: curl: (7) Failed to connect…`, `HTTP 503
  (expected 2xx,3xx)`). Agents get the same data from the `listWorkspaceDaemons` MCP tool's
  `health` field.

**Verify:** start the daemon → both dots green within one interval of READY (Angular red first
if you catch the compile window). Then kill the frontend inside the container:
`docker exec <container> bash -c 'pkill -9 -f "ng serve"'` → the Angular dot flips red within
~15 s (3 failed probes) **while the chip stays READY**, with the connection-refused evidence in
the tooltip; the Events feed gains nothing. Restart the daemon → all dots reset grey, then green.

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

The container kill looks like a crash to the supervisor, so an `ON_FAILURE`/`ALWAYS` daemon
auto-relaunches and — since [the relaunch now re-reads the definition](../issues/resolved/2026-07-06_daemon-relaunch-uses-stale-definition-after-webview-update.md)
— comes back on the new `webView`; a `NEVER` daemon (or one already stopped) needs a manual
start. The instance's `needsContainerRecreate` field / the amber badge in the UI tells you when
the recreate is needed.

### Symptoms of getting it wrong

| Symptom | Cause |
|---|---|
| Blank iframe, asset 404s in devtools | missing `--serve-path` / `<base>` rebase — assets resolve against `/` |
| SPA renders, API calls 404 | fetches hardcode `/api` instead of base-relative `api/…` |
| SPA renders, API **GET**s hang forever (POSTs fine) | `ignored-path-prefixes` not root-path-aware — the Quinoa↔ng loop |
| Frame shows 502 "container does not publish the daemon's port" | `webView.port` added after the container existed — recreate it |
| Frame shows 404 "No web-viewable daemon here." while the API lists a `proxyPath` | a `NEVER`-policy daemon didn't relaunch after the container recreate — start it (auto-relaunch of `ON_FAILURE`/`ALWAYS` now reads the fresh definition) |
| `ERR_EMPTY_RESPONSE` in the frame | `ng serve` without `--host 0.0.0.0` |
| Frame shows "This host … is not allowed" | not an app-config gap — qits' proxy rewrites the Host to `localhost` for you ([resolved](../issues/resolved/2026-07-07_web-view-host-not-allowed-after-devcontainer-move.md)); if you still see it, qits predates that fix |

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

### Meta-enrichment: handler attribution and span depth

The backend counterpart of Tier 5's meta-enrichment
([backend-telemetry-meta-enrichment](../features/2026-07-11_backend-telemetry-meta-enrichment.md)):
Quarkus's automatic server spans carry HTTP semconv only — nothing names the handler, and the
trace has no interior. Two conventions fix that, both demonstrated in the fixture:

- **Handler attribution on every server span.** Copy `TelemetryMetaFilter` from the fixture
  (adjust the package): one `@ServerRequestFilter` method (post-matching, so the resource is
  resolved; auto-registered, no `@Provider`) that stamps onto the *current* span — never a second
  one — the stable semconv `code.function.name`
  (`eu.wohlben.qits.testingrepo.GreetingResource.greet`) and `code.file.path`
  (`src/main/java/<pkg>/<TopLevelClass>.java`, nested classes resolving to their enclosing file).
  Write-once: every resource in the app gets attribution with no per-method ceremony. Guards:
  null resource class (nothing matched) and an invalid/non-recording span (SDK off, or the URI is
  on the Tier 5 suppress list — suppression prevents span *creation*, so there is no ordering
  hazard). The file path is a standard-Maven-layout derivation — wrong-by-construction for
  Kotlin/generated/multi-source-root handlers; acceptable, it's metadata, not control flow. No
  `code.line.number`: method line numbers aren't reachable via reflection.
- **Trace interior via `@WithSpan`.** The annotations
  (`io.opentelemetry.instrumentation.annotations.WithSpan`/`@SpanAttribute`/
  `@AddingSpanAttributes`) ship with `quarkus-opentelemetry` and work on any CDI bean, no agent
  needed. The decree: annotate **boundary→control seams and anything worth timing** — not every
  method; span-per-method is noise. Tag interesting parameters:
  `@WithSpan Greeting compose(@SpanAttribute("greeting.name") String name)` in the fixture's
  `GreetingService`. One trap: the interceptor only fires through the **injected CDI proxy** — a
  same-class self-invocation silently creates no span.
- **Log records come pre-attributed — verify, don't build.** Quarkus's own OTel log handler
  already stamps `code.function.name`, `code.line.number`, `log.logger.namespace` and `thread.*`
  on every exported log record (no `code.file.path` — a JUL `LogRecord` has no source file).
  Nothing to add app-side.

Span-level tests need the SDK on (the `%test` profile disables it — Tier 4 above); the fixture's
`TelemetrySpansTest` shows the dependency-free recipe: a `@TestProfile` re-enabling the SDK with
`quarkus.otel.exporter.otlp.enabled=false` + `quarkus.otel.bsp.schedule.delay=100ms`, and a
nested `@ApplicationScoped @Unremovable` in-memory `SpanExporter` bean — the default
`quarkus.otel.traces.exporter=cdi` composes every CDI `SpanExporter` bean.

**Verify:** post a greeting through the web view → the Telemetry tab's trace detail shows the
`POST /greetings` SERVER span with an INTERNAL child `GreetingService.compose`. The attributes
themselves (`code.function.name`, `code.file.path`, `greeting.name`, and Quarkus's own
`code.function.name`/`code.line.number` on log records) are on the spans/records but the tab
renders names/durations only — check them via the workspace `telemetry/traces/{traceId}` API or
the agent's `telemetryTrace` MCP tool
([known gap](../issues/2026-07-11_telemetry-trace-detail-omits-span-attributes.md)).

---

## Tier 5 — frontend OTEL through the backend gateway

The convention ([spa-observability](../features/2026-07-06_spa-observability.md)): the backend
acts as its SPA's telemetry gateway with two small resources, and the SPA exports base-relative
to its own backend. The SPA half ships as the **[`@qits/angular`
library](https://github.com/wohlben/qits-angular)**
([qits-angular-integration-library](../features/2026-07-13_qits-angular-integration-library.md))
— only the two backend resources are still copied from the fixture (they are app-agnostic;
adjust the package):

1. **`ConfigResource`** — `GET /api/config.json`, relays the injected OTEL identity
   (`otel.exporter.otlp.endpoint` / `otel.resource.attributes` / `otel.service.name` via
   MicroProfile Config); returns `"telemetry": null` when no endpoint is configured — the gate
   that keeps a standalone or otel-off run dark (the library stays inert dead weight).
2. **`OtelProxyResource`** — `POST /api/otel/v1/{traces|logs|metrics}`, byte-verbatim
   passthrough to `${endpoint}/v1/{signal}`; 404 when unconfigured, 502 on forward failure.

Fixture source of truth:
`domain/src/test/resources/fixtures/testing-repo-quarkus-angular` (`main`) — including unit
tests for both resources worth copying along. Its webui is the **reference consumer** of the
library (SHA-pinned git dependency, two-line wiring).

Frontend side — install the library (git-only distribution, SHA-pinned; the fixture's
`package.json` carries the current known-good pin):

```bash
pnpm add "git+https://github.com/wohlben/qits-angular.git#<sha>"
```

plus two pnpm entries in the consumer's `package.json` (both required, both documented in the
[library README](https://github.com/wohlben/qits-angular)):

```jsonc
"pnpm": {
  // pnpm 10 gates lifecycle scripts; without this the git dep's prepare build is refused
  // (ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED) and nothing installs.
  "onlyBuiltDependencies": ["@qits/angular"],
  // The (now transitive) user-interaction instrumentation declares a hard zone.js peer it
  // doesn't need in a zoneless app — keep the lockfile zone-free.
  "packageExtensions": {
    "@opentelemetry/instrumentation-user-interaction": {
      "peerDependenciesMeta": { "zone.js": { "optional": true } }
    }
  }
}
```

Then the two-line wiring. `main.ts`:

```ts
initQitsIntegration()
  .catch(() => undefined)
  .then(() => bootstrapApplication(App, appConfig))
  .catch((err) => console.error(err));
```

`app.config.ts`:

```ts
providers: [
  provideBrowserGlobalErrorListeners(),
  provideRouter(routes),
  provideQitsIntegration(), // telemetry ErrorHandler + navigation spans + app.route.* stamping
  provideHttpClient(withFetch()),
],
```

And one more property (`application.properties`):

```properties
quarkus.otel.traces.suppress-application-uris=${quarkus.http.root-path:/}api/otel/v1/*
```

The traps that remain **app-side**, each one load-bearing (the rest — verbatim exporter URLs
composed from `document.baseURI`, the `ignoreUrls` exclusion of the passthrough so exports don't
instrument themselves, the 1 s flush that survives web-view iframe removal — moved *into* the
library; details in the [feature doc](../features/2026-07-06_spa-observability.md)):

- **`provideHttpClient(withFetch())`** — Angular's default XHR backend is invisible to
  the fetch instrumentation: without it, no client span and no `traceparent`, so no full-stack
  traces.
- **`initQitsIntegration()` must complete before `bootstrapApplication`** — `FetchBackend`
  captures `window.fetch` on first use, so the instrumentation has to patch it first. The
  library cannot hide this inside a provider; it is the one-line `main.ts` contract.
- **Keep the scaffold's `provideBrowserGlobalErrorListeners()`** — zoneless Angular funnels
  handler exceptions through `ErrorHandler` (which the library provides), and this is what
  forwards the genuinely-global errors and unhandled rejections there too. (Zoneless also means
  no `zone.js` and no `@opentelemetry/context-zone` — the library uses the default stack context
  manager.)
- **`suppress-application-uris`** (root-path-aware, same reason as the Quinoa prefix) — without
  it the backend mints a `POST /otel/v1/…` server span for every browser export batch.

### Meta-enrichment: route context, interactions, caller attribution

The convention's second layer ([spa-telemetry-meta-enrichment](../features/2026-07-11_spa-telemetry-meta-enrichment.md)),
now entirely inside the library — three attribute families answering *where in the app*
telemetry happened, all for free once wired:

- **`app.route.*` on every span and log record** — `app.route.path` (the matched route
  *pattern*, `greeting/:name` — groups without cardinality explosions) and `app.route.url` (the
  concrete URL). Route changes are their own `Navigation` spans (`app.navigation.result` =
  `success`/`cancel`/`error`/`skipped`). They root, except that a `router.navigate` fired
  synchronously from a handler nests under that interaction span — cause and effect in one trace.
- **Interaction spans** — clicks/submits become spans (`interaction save-greeting`,
  `app.interaction.name`/`app.interaction.target`, plus `app.component` under `ng serve`).
- **`code.*` caller attribution on fetch spans** (stable semconv: `code.function.name`,
  `code.file.path`, `code.line.number`, `code.stacktrace` capped at 10 filtered frames) — which
  file/method issued the request.

The one thing the app still *does* for this: name interactions with the framework-free DOM
attribute — put `data-track-event="<name>"` **on the event target or an ancestor** — a submit
event's target is the *form*, so name forms, not their buttons.

Honest limits: the app is zoneless, so only *synchronous* handler work nests under an
interaction span (fire the request before you `await`; a fetch behind a timer surfaces as its
own route-stamped root) and interaction spans last microseconds; `code.file.path` is a
served-bundle URL — the function name (`Greeting.submit`) is the reliable signal; and
`app.component` exists only under a dev server.

**Verify:** open the web view and interact → the Telemetry tab shows **one trace per
interaction with the interaction span as root** (`interaction save-greeting`) **wrapping the
browser CLIENT span, which wraps the Quarkus SERVER span** (service `<name>-browser` vs the
backend's); the CLIENT span carries `app.route.path` and `code.function.name`; navigations
(including the initial redirect hop) appear as `Navigation` spans; a provoked SPA error (e.g. a
`throw` from a button handler) appears in *Recent errors* as an ERROR log record under
`<name>-browser` carrying `app.route.*`; *no* `POST /otel/v1/…` spans appear in Traces.

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

1. Daemon starts → `READY` (Tier 1); the Quarkus and Angular health dots go green, and killing
   the frontend in-container flips its dot red while the chip stays READY (Tier 1b).
2. Web view renders the SPA through the proxy prefix; an API round trip works; HMR live; DOM
   picker picks (Tier 2).
3. A provoked backend error → Events tab + chat note (Tier 3).
4. Interactions → full-stack traces (browser CLIENT rooting Quarkus SERVER) + metrics in the
   Telemetry tab; a provoked SPA error → Recent errors; agent telemetry MCP tools attached
   (Tiers 4–5).

## Related documents

- Features: [daemons](../features/2026-07-04_daemons.md) ·
  [daemon healthchecks](../features/2026-07-10_daemon-healthchecks.md) ·
  [daemon web-view configuration](../features/2026-07-06_daemon-webview-configuration.md) ·
  [daemon log observation](../features/2026-07-04_daemon-log-observation-expansion.md) ·
  [observability](../features/2026-07-04_observability.md) ·
  [spa-observability](../features/2026-07-06_spa-observability.md) ·
  [spa-telemetry-meta-enrichment](../features/2026-07-11_spa-telemetry-meta-enrichment.md) ·
  [backend-telemetry-meta-enrichment](../features/2026-07-11_backend-telemetry-meta-enrichment.md) ·
  [framework-aware file browser](../features/2026-07-03_framework-aware-file-browser.md) ·
  [servable fixture](../features/2026-07-05_servable-quarkus-angular-fixture.md)
- Resolved issues distilled above:
  [OTEL endpoint not bridged in dev mode](../issues/resolved/2026-07-05_quarkus-otel-endpoint-not-bridged.md) ·
  [Quinoa ignored-prefix root-path loop](../issues/resolved/2026-07-06_quinoa-ignored-prefix-root-path-loop.md)
- Issues found while validating this guide:
  [stale daemon definition on relaunch](../issues/resolved/2026-07-06_daemon-relaunch-uses-stale-definition-after-webview-update.md) ·
  [ensure-container no-ops on exited containers](../issues/2026-07-07_ensure-container-noops-on-exited-container-after-host-restart.md) ·
  [daemons empty state references removed global library](../issues/2026-07-06_workspace-daemons-empty-state-references-removed-global-library.md)
