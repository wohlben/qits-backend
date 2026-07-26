# Servable Quarkus + Lit web-components fixture (`qits-fixture-quarkus-lit`), fully integrated

## Introduction

qits' servable fixture family demonstrated exactly one frontend stack: the Angular SPA
(standalone in `qits-fixture-angular`, full-stack under Quinoa in `qits-fixture-quarkus-angular`).
This feature adds the second stack: a minimal but **servable Quarkus 3 + Lit web-components
(TypeScript) app** — `wohlben/qits-fixture-quarkus-lit` — where **one Quinoa build serves multiple
self-contained web components** plus a demo page composing them, cleared to the same bar the
Angular fixture set in
[quarkus-angular-fixture-full-integration](../../qits-testing-fixtures/features/2026-07-05_quarkus-angular-fixture-full-integration.md):
**full integration configuration** — framework detection, dev-server daemon + web view, OTEL, log
observation, feature-flows, coding agent — not just "it serves".

The stack's distinguishing idea (vs. the Angular SPA): **each component is responsible for its own
components.** A top-level web component lives in its own folder with its sub-components and tests,
and builds to its **own entry bundle** that registers everything it needs — so components are
developed together in one repo but are individually consumable (a plain `<script type="module">` +
custom-element tag on any page), and Quinoa serves them all from one Quarkus app.

Related / dependent plans:

- **[qits-lit-webcomponents epic](../epic.md)** — this is its part 1; the epic states what the
  stack is and what it deliberately excludes (no `@qits/lit` library yet, no Lit-only fixture
  split yet). Note: the GitHub repo `wohlben/qits-integration-lit` exists but is **reserved for
  the future `@qits/lit` integration library** — it is not this fixture.
- **[servable-quarkus-angular-fixture](../../qits-testing-fixtures/features/2026-07-05_servable-quarkus-angular-fixture.md)**
  + **[quarkus-angular-fixture-full-integration](../../qits-testing-fixtures/features/2026-07-05_quarkus-angular-fixture-full-integration.md)**
  — the templates this mirrors: app shape, branch layout, seed shape, and the C1–C7 per-feature
  integration checklist.
- **[fixture-repos-split-and-submodules](../../qits-testing-fixtures/features/2026-07-14_fixture-repos-split-and-submodules.md)**
  — the packaging model reused verbatim: standalone GitHub repo → in-tree submodule → derived
  classpath bare via `scripts/derive-fixture-bares.sh`.
- **[submodule-backend-onboarding](../../qits-project-repository-submodules/features/2026-07-25_submodule-backend-onboarding.md)**
  — how the brand-new fixture repo was mounted from inside a qits-in-qits workspace: the empty
  GitHub repo was pre-served as a sibling (`prepareSubmoduleBackend`), the fixture branches were
  authored in the submodule checkout and pushed to the served sibling, and a **Push on the sibling
  repository** sends them to GitHub (required before the superproject's gitlink lands upstream).
- **[workspace containers](../../qits-workspaces/features/2026-07-04_workspace-containers.md)** /
  **[lazy provisioning](../../qits-workspaces/features/2026-07-08_lazy-workspace-container-provisioning.md)**
  — the execution model the daemon runs in; nothing here changes it.
- **[daemons](../../qits-workspace-services/features/2026-07-04_daemons.md)** +
  **[daemon web-view picker](../../qits-workspace-detail/features/2026-07-05_daemon-webview-picker.md)**
  — the web view is the main thing the base-path work exists for.
- **[SPA observability](../../qits-observability/features/2026-07-06_spa-observability.md)** — the
  convention (`/api/config.json` relay, `/api/otel/v1/*` passthrough) is framework-agnostic; the
  fixture implements the backend half directly (no frontend library — the components export no
  browser telemetry yet).
- **[backend framework detection](../../qits-workspaces/features/2026-07-12_backend-framework-detection.md)**
  — the registry this feature extends with its fourth descriptor (`ts-lit`).

## The fixture app

Same skeleton as `qits-fixture-quarkus-angular` — a single-module Quarkus 3 app
(`maven.compiler.release=25`, committed `./mvnw`), `quarkus-rest-jackson` + `quarkus-quinoa` +
`quarkus-opentelemetry` + `quarkus-smallrye-health`, `quarkus.rest.path=/api`, the identical
backend classes (`GreetingResource`/`GreetingService`, `ConfigResource`, `OtelProxyResource`,
`TelemetryMetaFilter`) and backend test suite — but the webui is a **Vite + Lit + TypeScript**
workspace (in-tree, no nested submodule):

```
pom.xml                                     Quarkus app; "quarkus" in it → Java / Quarkus label
src/main/java/…/GreetingResource.java       POST /api/greetings {name} → {name, timestamp}
src/main/resources/application.properties   /api prefix, pinned Quinoa Vite config, OTEL, quarkus.log
src/main/webui/
  package.json  pnpm-lock.yaml  vite.config.ts  vitest.config.ts  tsconfig.json
  index.html                                the demo page composing all components
  src/components/
    greeting-form/                          each top-level component: a self-contained folder
      greeting-form.ts                      <qits-greeting-form> — posts to api/greetings
      greeting-form.test.ts                 runnable vitest test; test↔code linking target
      name-input.ts                         a sub-component ONLY this bundle registers
    greeting-history/
      greeting-history.ts                   <qits-greeting-history> — listens + renders history
      greeting-history.test.ts
      greeting-entry.ts                     its own sub-component
docs/README.md                              lights up the Docs framework kind
.claude/settings.json  CLAUDE.md → AGENTS.md   repo ships its own agent config
.qits-config.yml                            daemon + actions + bootstrap + ts-lit declaration
src/test/java/…/GreetingResourceTest.java   @QuarkusTest (full suite copied from the Angular fixture)
```

- **Multi-entry build (the "multiple webcomponents through one Quinoa" part).** `vite.config.ts`
  declares one Rollup entry per top-level component plus the demo `index.html`. Component entries
  emit **stable, unhashed** bundles (`dist/components/greeting-form.js`) so a consumer page can
  hot-link one component without knowing the build; the demo page's own entry stays hashed.
  Shared modules (the lit runtime) dedupe into `dist/components/chunks/` and are imported
  **relatively** by the entries — "self-contained" means *one script tag per component*, with the
  served `dist/` tree intact, not a single-file bundle (per-component lib-mode builds were
  rejected as complexity a fixture doesn't need). Quinoa builds the webui (pnpm) and serves
  `dist/` with the rest of the app — one origin for components, demo page, and `/api`.
- **Self-contained components.** Each entry imports and `customElements.define`s everything it
  needs (its sub-components included), and nothing outside its folder. Loading
  `components/greeting-form.js` on a blank page yields a working `<qits-greeting-form>`.
- **Composition via DOM events, not shared state.** `<qits-greeting-form>` POSTs to
  `api/greetings` and dispatches a bubbling, composed `qits-greeting` CustomEvent with the
  response; `<qits-greeting-history>` listens on its root node (captured at subscribe time) and
  renders the log. The demo page is plain HTML placing both tags side by side — the components
  never import each other.
- **Base-relative API calls (the web-view crux).** Components resolve the API endpoint against
  `document.baseURI` (never a leading `/api`), with an optional `api-base` attribute override —
  so the same bundle works at `/`, under the daemon web-view prefix, and embedded in a foreign
  page. The daemon start script passes `-Dquarkus.http.root-path="${QITS_PUBLIC_BASE:-/}"` and
  the webui `start` script passes `--base "${QITS_PUBLIC_BASE:-/}"` to Vite, exactly like the
  Angular fixture's `ng serve --serve-path`; Vite's build `base` is `''` (relative) so emitted
  asset URLs survive any prefix.
- **Quinoa × Vite: pinned, not auto-detected.** `quarkus.quinoa.build-dir=dist` +
  `quarkus.quinoa.dev-server.port=5173` are set explicitly (resolving the draft's open question:
  don't couple the fixture to Quinoa's package.json-script heuristics). No SPA routing — the demo
  page is one `index.html`, there is no client router.
- **Runnable frontend tests.** `vitest` + `happy-dom` (no browser runner), `pnpm --dir
  src/main/webui test` — resolving the draft's open question toward runnable-but-tiny, so the
  feature-flow's Test action names something real. `vitest.config.ts` is deliberately a separate
  file: qits' `DetectionService.detectRunner` probes for it to classify the runner. The
  TypeScript config uses **no decorators** (vanilla `static properties` +
  `customElements.define`) and `useDefineForClassFields: false` — the standard non-decorator Lit
  setup (class fields would shadow the reactive accessors).
- **`.qits-config.yml`** mirrors the Angular fixture's: the web-viewable OTEL-enabled
  `quarkus:dev` daemon (web-view on Vite's `:5173`, `ready-pattern` on the Vite banner, LOG_LEVEL
  + PATTERN observers, FILE source on `quarkus.log`, Quarkus COMMAND + Vite HTTP health checks),
  the bootstrap-chain regression carrier, and honest actions (`./mvnw package`, `pnpm … lint`,
  `./mvnw test`, `pnpm … test`, `quarkus:info`) — **no `lint-backend`/spotless action** (the pom
  carries no spotless; the Angular fixture's copy of that action is a latent inconsistency this
  fixture doesn't repeat). It also declares `frameworks: [{kind: ts-lit, root: src/main/webui}]`
  as the belt-and-braces authoritative classification.

**Branch layout** (the family convention): `main`; `feature/greeting` — a clean **fast-forward**
adding a welcome note inside `greeting-form/`; `feature/diverged` — rewording the same
greeting-form heading line off an earlier base, a real text **conflict** with `main` (no submodule
indirection — the webui is in-tree).

**Packaging**: the GitHub repo `wohlben/qits-fixture-quarkus-lit`, mounted as a submodule at
`domain/src/test/resources/fixtures/testing-repo-quarkus-lit`, one `derive` line in
`scripts/derive-fixture-bares.sh` (no `--recurse-submodules` needed — no nested submodule),
testResource excludes in the domain/cli/service poms, and build-cache input excludes for
`target`/`node_modules`/`dist`; tests/seeds resolve
`getResource("/fixtures/testing-repo-quarkus-lit.git")`.

## The qits side

- **`seed-lit` cli command** (`SeedLitService`, sibling of `SeedWebappService`, **idempotent by
  reset**): a "Quarkus + Lit Demo" project + repo cloned from the fixture, a `greeting` workspace
  off `feature/greeting`, and a "Build & Verify" feature-flow blueprint (Build PREREQUISITE /
  Lint QUALITY_GATE in the `lint` parallel group / Test QUALITY_GATE — all binding the
  code-seeded global `Bash` action, the current bindability rule). The daemon and actions come
  from the fixture's committed `.qits-config.yml`, read in-container per workspace — no host-side
  ingestion. Unlike `seed-webapp` there is no stale-global cleanup (`seed-lit` never had a
  version that created globals). Covered by `SeedLitServiceTest`, incl. the double-seed
  idempotency check. A separate command (not an extension of `seed-webapp`) keeps each seed's
  reset scope independent — the draft's recommended default.
- **Framework detection**: `FrameworkDetectionService` grows the fourth descriptor **`ts-lit`**
  (label `TypeScript / Lit`). The structural rule stays content-free: a `vite.config.{ts,mts,js,mjs}`
  marks a candidate root, minus roots that are Angular workspaces (`angular.json`). The
  "package.json actually depends on `lit`" confirmation is a content peek in `DetectionService`
  (`filterLitCandidates`), mirroring the `java-quarkus` → "Java / Quarkus" pom peek — so a
  React/Vue Vite root is never mislabeled, and a declared `.qits-config.yml` `ts-lit` entry
  bypasses the peek (the authoritative override). Test↔code linking pairs `foo.ts` ↔
  `foo.test.ts` (the Vitest convention — a second suffix rule beside Angular's `.spec.ts`;
  collisions resolve structurally by deepest-root ownership, and each rule ignores the other's
  suffix). `testKinds`/`detectRunner` reuse the existing per-root runner detection — a Lit root
  falls through the absent `angular.json` to the `vitest.config` probe. Client side,
  `detect-frameworks.ts` maps `ts-lit` to `/lit.svg` (a new minimal flame mark, an original
  drawing) with `src` as the auto-expand landing, and the TypeScript LSP agent plugin entry
  covers `ts-lit` too.
- **No new runtime capability was needed** — Quinoa, the daemon supervisor, OTEL injection, the
  proxy, and the agent all work per-workspace already; this is configuration + detection + a
  seed, which is the point of the exercise (the managed-app convention is stack-agnostic).

## Acceptance checklist (mirrors the Angular fixture's)

1. **Detection**: workspace detail shows `Quarkus` + `Lit` (+ `Docs`) toggles; opening
   `greeting-form.ts` offers the jump to `greeting-form.test.ts`. ✅ deterministic
   (`FrameworkDetectionServiceTest`, `WorkspaceControllerTest`).
2. **Dev server**: the `quarkus:dev` daemon reaches READY; the web view renders the demo page
   with **both components live** and `POST api/greetings` works through the proxy prefix; the
   individual component bundle URLs (`components/greeting-form.js`) serve through the prefix too.
   (docker/`-Pextended`/manual.)
3. **Observability**: spans/logs/metrics appear scoped by `qits.workspace.id`; agent telemetry
   MCP tools attach. (docker/manual.)
4. **Log observation**: an app error produces a `daemon_event` and a chat `[daemon:…]` note.
   (docker/manual.)
5. **Feature-flow**: the seeded configuration renders. ✅ deterministic (`SeedLitServiceTest`).
6. **Agent**: chat picks up the fixture's `.claude/` + `CLAUDE.md`. (docker/manual.)
7. **Reset**: re-running `seed-lit` returns to the known-good state. ✅ deterministic
   (double-seed in `SeedLitServiceTest`).
8. **Fixture divergence**: `feature/greeting` fast-forwards, `feature/diverged` conflicts. ✅
   verified on the authored branches and the derived bare.
9. **Standalone**: `./mvnw package` in the fixture is green (Quinoa builds the Vite webui, the
   `@QuarkusTest` suite passes) and the packaged jar serves the demo page + component bundles +
   `POST /api/greetings`; `pnpm --dir src/main/webui test` (5 vitest tests) and `lint` pass. ✅
   verified.
