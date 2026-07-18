# Registering qits itself as a repository (qits-in-qits)

## Introduction

qits now conforms to its own managed-app convention
([feature doc](../features/2026-07-18_qits-dogfooding-managed-app-convention.md)): the real
`wohlben/qits-backend` repository can be registered on a qits deployment (dev or prod) and managed
like any other Quarkus+Angular app — framed web view, health dots, log observation, full-stack
telemetry into the parent's Telemetry tab, and the SPA capture button. This guide is the exact
registration recipe; the general walk it specializes is
[quarkus-angular-integration.md](quarkus-angular-integration.md).

This is a *current-state contract* document: when a feature changes the contract, update this
guide in place.

Related: [workspace submodule support](../features/2026-07-14_workspace-submodule-support.md) ·
[daemon web-view configuration](../features/2026-07-06_daemon-webview-configuration.md) ·
[daemon healthchecks](../features/2026-07-10_daemon-healthchecks.md) ·
[spa-feature-capture](../features/2026-07-14_spa-feature-capture.md).

## Prerequisites

- The parent qits runs with docker and the `qits/workspace` image built (the toolchain already
  carries JDK 25, Node 22 + pnpm, git, unzip — everything a qits build needs).
- Network reach to GitHub from the workspace container (the webui's `@qits/angular` git
  dependency and the submodule fetches need it).
- Patience and memory for the first build: the full reactor + pnpm install is heavy, and the
  parent's dev servers run alongside the child's.

## 1. Register the repository — submodule import is REQUIRED

*Projects → New project* ("qits") *→ Add repository*:

- URL: `https://github.com/wohlben/qits-backend.git`
- Archetype: `SERVICE`
- **Import submodules: ON** — non-negotiable. `scripts/derive-fixture-bares.sh` runs on every
  build (`runAlways`, domain `process-test-resources`) and hard-fails when the fixture submodules
  aren't checked out, so a submodule-less clone cannot even compile.

Then, on the repository detail page, run **“import submodules” once more**: the direct import
covers `testing-repo`, `qits-fixture-angular` and `testing-repo-quarkus-angular`, but the
quarkus-angular fixture nests `qits-fixture-angular` as its `webui` gitlink — the second pass
imports that edge so workspace containers materialize the full closure.

## 2. The dev-server daemon

Create a daemon on the repository (UI: *Daemons → New*), fields as follows.

**Name**: `qits dev server` — becomes `OTEL_SERVICE_NAME`; the browser side reports
`qits dev server-browser`.

**Start script** (one line; shown wrapped):

```bash
./mvnw -q -pl service -am quarkus:dev \
  -Dquarkus.bootstrap.workspace-discovery=true \
  -Dqits.variant=forwardauth \
  -Dquarkus.http.host=0.0.0.0 \
  -Dquarkus.http.port=8080 \
  -Dquarkus.http.root-path="${QITS_PUBLIC_BASE:-/}" \
  -Dquarkus.otel.sdk.disabled=false \
  -Dquarkus.otel.exporter.otlp.endpoint="${OTEL_EXPORTER_OTLP_ENDPOINT:-http://localhost:4317}" \
  -Dqits.speech.warmup-on-start=false
```

Why each flag:

- `-Dqits.variant=forwardauth` — every service build must name an auth variant (enforcer). In the
  container the child sees no forward-auth proxy headers; `%dev`'s fallback identity `dev` keeps
  the child usable, and the child is only reachable through the parent's authenticated proxy.
- `-Dquarkus.http.root-path="${QITS_PUBLIC_BASE:-/}"` — serve under the web-view prefix (build-time
  property, hence bridged at launch; `:-/` keeps a standalone run at root). The trailing slash in
  `QITS_PUBLIC_BASE` is load-bearing (`${quarkus.http.root-path:/}api`-style expansions).
- `-Dquarkus.otel.sdk.disabled=false` + endpoint bridge — qits' own telemetry is dark by default;
  this lights it and bridges the injected endpoint into the Quarkus key (dev mode ignores the
  plain env var — [resolved issue](../issues/resolved/2026-07-05_quarkus-otel-endpoint-not-bridged.md)).
- `-Dqits.speech.warmup-on-start=false` — don't pull the ~700 MB Parakeet model in a demo child.

**Ready pattern**: `(?i)Listening on: http`
(with the Quinoa `check-path` fix, Quarkus only prints this after the Angular dev server answered
Quinoa's readiness probe — so READY implies the SPA is servable).

**Restart policy**: `ON_FAILURE`, autoStart on.

**otel**: `true` — injects `OTEL_EXPORTER_OTLP_*` + `qits.*` resource attributes; also what the
child's `config.json` relays so the child's *browser* telemetry flows to the parent.

**Web view**: port **8080**, entryPath `projects` (frame Quarkus, not `:4200`: qits' UI is
SSE/websocket-heavy on `/api`; Quarkus serves those natively and Quinoa dev-proxies the SPA).

**Log observers**:

- `LOG_LEVEL` (defaults) — classifies Java stack traces / `*Exception`s.
- `PATTERN`, severity `ERROR`: `(?i)(BUILD FAILURE|Failed to start Quarkus|Live reload failed)`

**Log source** (FILE): path `service/quarkus.log`, label `Quarkus dev log`
(`quarkus.log.file.path=quarkus.log` is CWD-relative; verify the location on first run and adjust
to `quarkus.log` if the dev JVM ran from the repo root).

**Health checks**:

- `Quarkus` — COMMAND: `curl -fsS -m 2 "http://127.0.0.1:8080${QITS_PUBLIC_BASE%/}/q/health"`
  (COMMAND, not HTTP: the path needs the env-expanded root path).
- `Angular` — HTTP on port `4200`, path `/` (any HTTP answer means ng serve is up; it may 302/404
  bare paths under the serve path — connection-refused-while-compiling is the red-then-green).

Remember the two standing rules: daemon-definition changes apply on the next (re)launch, and
`webView.port` changes need a container recreate (stop-container → ensure-container → start).

## 3. Acceptance walk

1. Daemon → `READY`; both health dots green.
2. Web view renders the qits UI under `/daemon/{ws}/{d}/` — navigate, open a project, watch the
   child's own SSE-driven pages work in the frame.
3. Parent workspace Telemetry tab: full-stack traces from the child — browser CLIENT spans
   (`qits dev server-browser`, `app.route.*`, `code.function.name`) rooting the child's Quarkus
   SERVER spans; no `/otel/v1/*`, `/daemon/*`, `/git/*` or `/mcp/*` self-spans (suppressed).
4. Events tab: provoke a build failure (edit a `.java` file to junk via the file browser) → the
   PATTERN observer flags it; the FILE source tails the dev log.
5. Capture: in the framed child UI, use the floaty capture button → a new workspace appears in
   the **parent** whose goal carries the child UI snapshot including the `promptContext` state.

## Known limitations

- **No docker in the child**: its own workspace-container features fail lazily on first use
  (browsing, API, telemetry, agent-free flows all work — anything needing a container does not).
  Nested web views can't materialize either, so the child's own `/daemon` frames stay splash.
- **Build-time root path**: only the `quarkus:dev` daemon form can serve under the prefix; a
  packaged child jar cannot be rebased at runtime.
- **Captures land in the parent** (framed capture posts same-origin `/api/capture`); unframed the
  button hides by design (container-internal ingest URL fails the OPTIONS probe).
- The child's own telemetry *receiver* also tees upward, so telemetry the child receives (e.g.
  from its seeded fixture app, if you run one) surfaces in the grandparent view too — a feature,
  but worth knowing.
