# Registering qits itself as a repository (qits-in-qits)

## Introduction

qits now conforms to its own managed-app convention
([feature doc](../epics/qits-integration-quarkus/features/2026-07-18_qits-dogfooding-managed-app-convention.md)): the real
`wohlben/qits-backend` repository can be registered on a qits deployment (dev or prod) and managed
like any other Quarkus+Angular app — framed web view, health dots, full-stack
telemetry into the parent's Telemetry tab, and the SPA capture button. This guide is the exact
registration recipe; the general walk it specializes is
[quarkus-angular-integration.md](quarkus-angular-integration.md).

This is a *current-state contract* document: when a feature changes the contract, update this
guide in place.

Related: [workspace submodule support](../epics/qits-project-repository-submodules/features/2026-07-14_workspace-submodule-support.md) ·
[daemon web-view configuration](../epics/qits-workspace-services/features/2026-07-06_daemon-webview-configuration.md) ·
[daemon healthchecks](../epics/qits-workspace-services/features/2026-07-10_daemon-healthchecks.md) ·
[spa-feature-capture](../epics/qits-integration-angular/features/2026-07-14_spa-feature-capture.md) ·
[workspace bootstrap commands](../epics/qits-workspaces/features/2026-07-18_workspace-bootstrap-commands.md).

## Prerequisites

- The parent qits runs with docker and the `qits/workspace` image built (the toolchain already
  carries JDK 25, Node 22 + pnpm, git, unzip — everything a qits build needs).
- Network reach to GitHub from the workspace container (the webui's `@qits/angular` git
  dependency and the submodule fetches need it).
- Patience and memory for the first build: the full reactor + pnpm install is heavy, and the
  parent's dev servers run alongside the child's.

## 1. Register the repository

**On a packaged deployment this step is automatic.** A `NORMAL`-launch-mode qits (jar / native /
prod image) self-seeds at startup
([startup self-seed feature](../epics/qits-live-deployment/features/2026-07-19_startup-qits-self-seed.md)): it boots into a
`"qits"` project with `wohlben/qits-backend` and `wohlben/qits-angular-integration` already
registered, and the qits-backend submodules imported (including the one second-level import on the
`testing-repo-quarkus-angular` child). Each repo's committed `.qits-config.yml` is **not ingested**
anywhere — it is the single, workspace-scoped source of truth, read in-container per workspace
(see step 3). Nothing below is
needed there — pick up at step 2 (the workspace / first-build walk). The seed is reconciled
additively on every boot and can be turned off with `qits.startup-seed.enabled=false` or redirected
with `qits.startup-seed.repo-url` (mirror/fork/air-gap).

**On a dev instance (`quarkus:dev`), or to register it by hand,** do the manual walk — submodule
import is REQUIRED. *Projects → New project* ("qits") *→ Add repository*:

- URL: `https://github.com/wohlben/qits-backend.git`
- Archetype: `SERVICE`
- **Import submodules: ON** — non-negotiable. `scripts/derive-fixture-bares.sh` runs on every
  build (`runAlways`, domain `process-test-resources`) and hard-fails when the fixture submodules
  aren't checked out, so a submodule-less clone cannot even compile.

Then run **“import submodules” once on the `testing-repo-quarkus-angular` child’s detail page**:
the creation-time import covers `testing-repo`, `qits-fixture-angular` and
`testing-repo-quarkus-angular`, but the quarkus-angular fixture nests `qits-fixture-angular` as its
`webui` gitlink. Import is **one level per repository, no descent**, so re-running it on the
qits-backend parent is a no-op — the nested edge must be imported on the child that declares it, and
it links back to the already-imported `qits-fixture-angular` sibling rather than adding a new row.
(This is exactly the walk the packaged deployment automates at startup.)

## 2. The bootstrap chain — the child self-bootstraps

`.qits-config.yml` also declares a **`bootstrap:` chain**
([feature doc](../epics/qits-workspaces/features/2026-07-18_workspace-bootstrap-commands.md)) that the **workspace-daemon runs
in-container** in a freshly provisioned workspace container **before the dev-server service
auto-starts** (the chain is read from the workspace's own checkout — no host-side ingestion):

1. `install` — `./mvnw install -DskipTests -Dqits.variant=forwardauth` (so the cli jar exists; this
   is the heavy first build the prerequisites warn about).
2. `seed-demo-data` — `./mvnw -pl cli quarkus:run -Dcli.args=seed` (check-guarded on the shared H2
   file; the seed itself is also skip-if-exists).
3. `seed-webapp-demo` — `./mvnw -pl cli quarkus:run -Dcli.args=seed-webapp` (idempotent by reset).

So opening the child's first workspace yields a child qits with the demo fixtures **already
seeded** — there are no manual install/seed steps in this walk. The ordering is load-bearing: qits'
own build guard fails any lifecycle build once something listens on `:8080`, so the install could
never run after the daemon is up. Watch the chain as `bootstrap:*` segments of the workspace Start
process (or on the workspace's **Bootstrap** tab, which also offers re-runs); a failed chain skips
daemon auto-start by design — fix, then "Run all" from the Bootstrap tab, and on success the
daemons come up.

## 3. The dev-server daemon

**qits-backend commits a root [`.qits-config.yml`](../../.qits-config.yml) that declares this service
(and the build/test/lint actions) — and that file is the only place the service exists**
([config-as-single-source-of-truth](../epics/qits-workspace-daemon/features/2026-07-24_config-as-single-source-of-truth.md)):
config is **workspace-scoped, file-only, read in-container** by the workspace-daemon from its own
checkout. There is no DB copy, no ingestion on clone, and no UI editor — the service shows up on a
workspace's **Services** tab because the workspace's branch declares it. You do **not** create it by
hand; the fields below document what the file declares (and what to verify). To change any of them,
edit `.qits-config.yml` in a workspace (that workspace then sees its own branch's version; merge it
to change every future workspace).

**Name**: `qits dev server` — the service's identity is its config `id:` (absent, so it defaults to
the name). Becomes `OTEL_SERVICE_NAME`; the browser side reports `qits dev server-browser`
and the backend reports its artifact name `qits-forwardauth`.

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

**Health checks**:

- `Quarkus` — COMMAND: `curl -fsS -m 2 "http://127.0.0.1:8080${QITS_PUBLIC_BASE%/}/q/health"`
  (COMMAND, not HTTP: the path needs the env-expanded root path).
- `Angular` — HTTP on port `4200`, path `/` (any HTTP answer means ng serve is up; it may 302/404
  bare paths under the serve path — connection-refused-while-compiling is the red-then-green).

(Log observers and log sources no longer exist — that subsystem was removed with the daemon-backed
service supervision, 2026-07-24; `readyPattern`, health checks and crash excerpts are the surviving
surface.)

Remember the two standing rules: daemon-definition changes apply on the next (re)launch, and
`webView.port` changes need a container recreate (stop-container → ensure-container → start).

## 4. Acceptance walk

0. **Packaged deployment only** — boot a packaged image (with outbound HTTPS to GitHub): with no UI
   steps, a `"qits"` project appears holding `qits-backend` + `qits-angular-integration`, the
   qits-backend submodule siblings imported (incl. the second-level `webui` edge). The
   `qits dev server` service + build/test/lint actions + `bootstrap:` chain live only in the
   committed `.qits-config.yml`, read in-container per workspace — nothing is ingested at this
   point. No workspace is provisioned (lazy by design). A second boot is a fast
   all-present no-op. (On a dev instance you did steps 1–3 by hand instead.)
1. First workspace Start: the `bootstrap:*` segments run (install → seeds) and settle green, then
   the daemon phase begins; the Bootstrap tab shows `SUCCEEDED`/`SKIPPED` per command.
2. Daemon → `READY`; both health dots green.
3. Web view renders the qits UI under `/daemon/{ws}/{d}/` — navigate, open a project, watch the
   child's own SSE-driven pages work in the frame.
4. Parent workspace Telemetry tab: full-stack traces from the child — browser CLIENT spans
   (`qits dev server-browser`, `app.route.*`, `code.function.name`) rooting the child's
   Quarkus SERVER spans (service `qits-forwardauth`); no `/otel/v1/*`, `/daemon/*`, `/git/*` or
   `/mcp/*` self-spans (suppressed).
5. Capture: in the framed child UI, use the floaty capture button → a new workspace appears in
   the **parent** whose goal carries the child UI snapshot (DOM + selected component). The
   `promptContext` **state** entry rides along only if `PromptContextStore` was instantiated in the
   session (a lazy `providedIn: 'root'` store — only the file-browser / command-chat /
   speak-to-prompt / daemon-webview routes inject it), so it is absent from a capture off the fresh
   Projects route — see
   [`../issues/2026-07-18_capture-promptcontext-absent-on-lazy-store.md`](../issues/2026-07-18_capture-promptcontext-absent-on-lazy-store.md).

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
