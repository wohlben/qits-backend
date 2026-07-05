# Fully integrate the Quarkus+Angular fixture with every qits feature

## Introduction

The [servable Quarkus + Angular fixture](../features/2026-07-05_servable-quarkus-angular-fixture.md)
and its [`seed-webapp` command](../features/2026-07-05_servable-quarkus-angular-fixture.md#consumed-by-the-seed-webapp-cli-command)
exist and are servable, but they only lightly touch qits's feature surface. This idea makes the
fixture the **Quarkus/Angular-specific test-and-demo substrate** — the counterpart to `testing-repo`,
which owns the *git-mechanics* side (clone/pull/branch/**merge**/divergence).

**Scope boundary (why this exists):** `testing-repo` is for merge/divergence flows. This fixture is
*not* — it should exercise the **stack-specific** logic that `hello.txt` can't: framework detection in
the worktree detail view, a real dev-server daemon and its web view, observability/OTEL, daemon log
observation, actions/feature-flows shaped for a Java+node build, and the coding agent against a real
app. Concretely, this means **dropping the merge branch tree** (`mainline`/`behind-ff`/`feeder` +
`mergeWorktree`, `SeedWebappService.java:132-139`) that `seed-webapp` currently manufactures — that's
`testing-repo`'s job and adds nothing here.

Related/dependent plans (each is a target this integrates with):
[framework-aware file browser](../features/2026-07-03_framework-aware-file-browser.md),
[smart file display](../features/2026-07-03_worktree-smart-file-display.md),
[daemons](../features/2026-07-04_daemons.md),
[daemon web-view picker](../features/2026-07-05_daemon-webview-picker.md),
[daemon log observation](../features/2026-07-04_daemon-log-observation-expansion.md),
[observability](../features/2026-07-04_observability.md),
[actions](../features/2026-05-01_actions.md) / [feature-flows](../features/2026-05-01_feature-flows.md),
[coding-agent harness](../features/2026-07-01_coding-agent-harness.md) /
[container agent sessions](../features/2026-07-04_container-agent-sessions.md),
[health checks](../features/2026-05-01_health-checks.md), and the
[workspace containers](../features/2026-07-04_workspace-containers.md) execution model.

## The shape of the integration

Two sides have to line up: **the fixture app** (what the cloned repo contains and how it's
configured to serve/build/export) and **the qits seed** (what `SeedWebappService` provisions so those
capabilities are wired and visible). The sections below pair them per feature.

---

## A. The fixture app — what to configure per stack part

### Quarkus backend (`pom.xml`, `application.properties`)

Extensions to add on top of today's `quarkus-rest-jackson` + `quarkus-quinoa`:

- **`quarkus-opentelemetry`** — zero-code OTLP export. It honors the `OTEL_EXPORTER_OTLP_*` env vars
  qits injects (§C3), so *no* `application.properties` OTEL keys are strictly required; if pinned
  anyway, `quarkus.otel.exporter.otlp.protocol=http/protobuf` (the qits receiver is protobuf-only) and
  leave the endpoint to the injected env. Enable logs+metrics export, not just traces
  (`quarkus.otel.logs.enabled=true`, `quarkus.otel.metrics.enabled=true`).
- **`quarkus-smallrye-health`** — gives `/q/health` so the health-checks feature and daemon
  readiness have a real endpoint to hit.

`application.properties` additions/decisions:

- Keep `quarkus.rest.path=/api`, `quarkus.quinoa.enable-spa-routing=true`,
  `quarkus.quinoa.ignored-path-prefixes=/api`.
- **Web-view base path (the crux).** For the daemon web view to work, the whole app must serve under
  `$QITS_PUBLIC_BASE` (§C2). Drive `quarkus.http.root-path` from it at launch (the daemon start script
  passes `-Dquarkus.http.root-path="${QITS_PUBLIC_BASE:-/}"`). This prefixes both `/api` and the
  Quinoa-served SPA. See Angular below and Open questions for the Quinoa-managed `ng serve` base-href
  wrinkle.

### Angular frontend (`src/main/webui/`)

- **Base-relative API calls.** The SPA currently fetches the absolute `/api/greetings`
  (`greeting.ts`), which breaks the moment the app is served under a `/daemon/{…}/` prefix. Change it
  to a **base-relative** `api/greetings` and rely on `<base href>` — correct both at root (`/`) and
  under the web-view prefix. This is the single change that makes the existing app web-viewable.
- **Dev-server flags for the web view.** Angular's contract is
  `ng serve --host 0.0.0.0 --serve-path "$QITS_PUBLIC_BASE" --base-href "$QITS_PUBLIC_BASE"`. Under
  Quinoa-managed dev mode this is Quinoa's `ng serve` child — confirm Quinoa forwards the base (Open
  questions).
- **A `*.spec.ts` beside a component.** The framework-aware browser's test↔code tabs link Angular
  `foo.ts` ↔ `foo.spec.ts`. The fixture was generated `--skip-tests`, so add one spec (e.g.
  `greeting.spec.ts`) purely so the test↔code linking has something to resolve.
- *(Parked, per [no-outbound-API-calls](../../CLAUDE.md))*: browser→qits OTEL for the SPA is local
  (the receiver is in-process), so Node/browser OpenTelemetry auto-instrumentation is a *possible*
  add, but keep it out of the first cut — backend traces already prove the observability path.

### Repo content (so detection/agent have signals)

- **A `docs/` dir with a `*.md`** — lights up the `Docs` framework kind in the detail view (the
  fixture's README alone, at repo root, doesn't count; the detector wants a `docs/` directory).
- **A repo-local `.claude/` + `CLAUDE.md`** — arrives with the clone and gives the coding agent
  real project context and (optionally) repo-configured MCP servers, exercising the "repo ships its
  own agent config" path with zero qits involvement.
- Keep the committed `./mvnw` wrapper and `pom.xml` mentioning "quarkus" (drives the `Java / Quarkus`
  label, not just `Java / Maven`).

### Maven / build

- Wrapper is committed. Consider a `test` split (unit vs. an `*IT`) only if an action/daemon demo
  needs it; otherwise leave the single `@QuarkusTest`.

---

## B. The qits seed (`SeedWebappService`) — what to provision

Reshape the seed away from merge demos toward stack demos. Keep: reset-idempotency, the project +
repo clone, the main worktree (auto at clone). Change:

- **Drop** the `mainline`/`behind-ff`/`feeder` worktrees and both `mergeWorktree` calls.
- **Keep one or two plain feature worktrees** off the fixture's branches (e.g. a `greeting` worktree
  from `feature/greeting`) so the detail view has more than one worktree to browse and run daemons in
  — no divergence manufacturing.
- **The dev-server daemon, fully configured** (§C2/C3/C4): `httpPort=8080`, `otel=true`,
  `readyPattern` matching Quarkus startup, a `LOG_LEVEL` observer, optionally a `FILE` `LogSource`,
  `startScript` running `quarkus:dev` bound to `0.0.0.0` under `$QITS_PUBLIC_BASE`.
- **A feature-flow configuration** (§C5) expressing build/lint/test actions for the stack (blueprint
  only — qits doesn't execute these).

---

## C. Per-feature integration & configuration

### C1. Framework detection in the worktree detail view

**How it works:** detection is pure-frontend (`shared/utils/detect-frameworks.ts`) over the loaded
path list — `pom.xml` (+ `/quarkus/i` in it) → **`Java / Quarkus`**; `angular.json` → **`TypeScript /
Angular`**; a `docs/` dir with `*.md` → **`Docs`**. Surfaced as quick-access footer toggles and
"Dynamic filter" picker entries in `worktree-file-browser.component.ts`, plus test↔code tabs.

**Config needed:** essentially free — the fixture already has root `pom.xml` (quarkus) +
`src/main/webui/angular.json`. Add the `docs/*.md` and a `*.spec.ts` (§A) to exercise the `Docs` kind
and the Angular test↔code linking. **Verify:** seed → open a worktree detail → the browser footer
shows `Quarkus`, `Angular` (and `Docs`); the advanced dialog lists `Java / Quarkus (root)` and
`TypeScript / Angular (src/main/webui)`; opening `greeting.ts` offers a jump to `greeting.spec.ts`.

### C2. Dev-server daemon + web view

**How it works:** `RepositoryDaemon` runs `startScript` in the worktree container; `httpPort` (set →
web-viewable) is published at container creation and proxied at `/daemon/{worktreeId}/{daemonId}/*`;
the supervisor injects `QITS_PUBLIC_BASE=/daemon/{…}/{…}/` and the dev server must bind `0.0.0.0` and
serve under it. `readyPattern` flips STARTING→READY.

**Config needed:** the daemon `startScript`
`./mvnw quarkus:dev -Dquarkus.http.host=0.0.0.0 -Dquarkus.http.port=8080 -Dquarkus.http.root-path="${QITS_PUBLIC_BASE:-/}"`,
`readyPattern` `Listening on` (or `Installed features`), `httpPort=8080`; plus the Angular
base-relative fetch (§A). Because Quinoa serves SPA + `/api` on one origin, one prefix covers both.
**Verify (docker/`-Pextended`):** launch the daemon in a worktree, open the web view, see the Angular
page render and `POST /api/greetings` succeed *through the proxy prefix*.

### C3. Observability / OTEL

**How it works:** set `otel=true` on the daemon and the supervisor injects
`OTEL_EXPORTER_OTLP_ENDPOINT=http://<git-host>:<qits-port>/api/otel`,
`OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf`, `OTEL_SERVICE_NAME=<daemon name>`, and
`OTEL_RESOURCE_ATTRIBUTES=qits.worktree.id=…,qits.repository.id=…,qits.command.id=…` (the correlation
keys the in-process receiver at `POST /api/otel/v1/{traces,logs,metrics}` and `TelemetryStore` bucket
by). Injected *before* the daemon's own env, so app-set `OTEL_*` wins.

**Config needed:** add `quarkus-opentelemetry` to the fixture (§A) and set **`otel=true`** on the
seeded daemon (today it's `null`). No app endpoint config — qits pins it via env. **Verify:** hit a
few `/api/greetings`, then confirm the worktree's telemetry view shows spans/logs/metrics scoped to
`qits.worktree.id`/`qits.repository.id`; confirm the agent's telemetry MCP tools attach (they do when
a daemon has `otel` on and the chat session is worktree+repository-scoped).

### C4. Daemon log observation

**How it works:** `LogObserverKind.LOG_LEVEL` (zero-config exception/severity classification) and
`PATTERN` (a regex → `ERROR_DETECTED` at a chosen `severity`); `LogSource` of kind FILE tails a
worktree-relative file into the same observers. Findings persist as `daemon_event` and inject into the
newest running CHAT (`[daemon:<name>]`).

**Config needed:** on the dev-server daemon, a `LOG_LEVEL` observer (catches Java stack traces /
`*Exception` out of the box); optionally a `PATTERN` observer for a Quarkus-specific line; optionally
a `FILE` `LogSource` if the app writes a logback file under the worktree. **Verify:** trigger an error
in the app (or a failing reload), see a `daemon_event` and the `[daemon:Quarkus dev server]` note in a
running chat.

### C5. Actions / feature-flows

**How it works:** definition-only blueprint —
`FeatureFlowConfiguration → FeatureFlowPhase → FeatureFlowPhaseStep → FeatureFlowPhaseAction (join) →
ActionConfiguration`. Each `ActionConfiguration` has an `executeScript` and a `checkScript` (self-
reports `required|suggested|optional|unnecessary`); the join carries `actionType`
(`PREREQUISITE|QUALITY_GATE`), `sortOrder`, `parallelGroup`. qits **does not execute** these — the
actual run happens via daemons/commands.

**Config needed (seed a configuration):** e.g. a "Development" phase with
`build-project` (`./mvnw package`, PREREQUISITE); a "Lint" step with `lint-backend`
(`./mvnw spotless:check` or similar) and `lint-frontend` (`pnpm --dir src/main/webui lint`) sharing
`parallelGroup:"lint"`; a "Test" step `run-unit-tests` (`./mvnw test`, QUALITY_GATE). **Verify:** the
configuration renders in the project's feature-flow view with phases/steps/actions in order.

### C6. Coding agent / chat

**How it works:** launched per-worktree (`POST …/worktrees/{id}/agents`), runs `claude` via
`docker exec` in the container; the `claude` CLI + a shared auth volume
(`qits.workspace.claude-volume` → `qits.workspace.claude-mount`) are global; **repo-specific config is
whatever `.claude/` + `CLAUDE.md` the clone ships**.

**Config needed:** nothing qits-side beyond the one-time operator `claude auth login`; add a repo-local
`.claude/`+`CLAUDE.md` to the fixture (§A) so the agent has real context and to exercise the
repo-ships-its-config path. **Verify:** open a chat in a worktree, agent sees the fixture's CLAUDE.md;
with the dev-server daemon's `otel` on, telemetry MCP tools are available to it.

### C7. Health checks (bonus)

Adding `quarkus-smallrye-health` gives `/q/health`; a daemon `readyPattern`/`LogSource` or an action
`checkScript` can lean on it, and it demonstrates the [health-checks](../features/2026-05-01_health-checks.md)
surface against a real app.

---

## Acceptance checklist

1. **Detection:** worktree detail shows `Quarkus` + `Angular` (+ `Docs`) toggles; test↔code tabs link
   `greeting.ts` ↔ `greeting.spec.ts`.
2. **Dev server:** the `quarkus:dev` daemon reaches READY; its web view renders the SPA and
   `POST /api/greetings` works *through the proxy prefix*.
3. **Observability:** `otel=true` → spans/logs/metrics appear in the worktree telemetry view scoped by
   `qits.*` attributes; agent telemetry MCP tools attach.
4. **Log observation:** an app error produces a `daemon_event` and a chat `[daemon:…]` note.
5. **Feature-flow:** the seeded build/lint/test configuration renders correctly.
6. **Agent:** chat in a worktree picks up the repo's `.claude/`/`CLAUDE.md`.
7. **Reset:** re-running `seed-webapp` returns all of the above to the same known-good state.

Items 2–4 need docker + the `qits/workspace` image, so their automated coverage belongs under the
**`-Pextended`** profile (self-skips without docker); 1, 5, 7 are unit/UI-testable without docker.

## Open questions

- **Quinoa-managed `ng serve` base-href.** In `quarkus:dev`, Quinoa spawns `ng serve` and proxies the
  UI. Does it propagate `quarkus.http.root-path` / `$QITS_PUBLIC_BASE` to the child as
  `--base-href`/`--serve-path`? If not, the web view needs either a Quinoa dev-server option, an
  explicit base-href in `index.html`, or running the Angular dev server as its own daemon with the
  backend behind it. This is the main thing to verify on real docker before calling the web view done.
  (Note the pre-existing "dev-mode SPA deep-links 404" issue in `docs/issues/2026-07-05_*`.)
- **First-run cost in the container.** `quarkus:dev` + Quinoa's `pnpm install` + Maven downloads on
  first launch can exceed the daemon ready-grace window; may need a warm-up action or a longer
  `qits.daemons.ready-grace-ms` for the demo.
- **How much frontend OTEL.** Backend traces are enough to prove observability; browser/Node SPA
  instrumentation is a possible later add (local receiver, so not an outbound-call violation) but not
  needed for the first cut.
- **Seed vs. UI-authored config.** Should the feature-flow configuration and extra observers be baked
  into `seed-webapp` (reset-owned, deterministic) or left for manual authoring? Baking them keeps the
  regression fixture self-describing; that's the recommended default.
