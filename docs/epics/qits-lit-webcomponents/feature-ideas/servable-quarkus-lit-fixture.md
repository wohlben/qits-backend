# Servable Quarkus + Lit web-components fixture (`qits-fixture-quarkus-lit`), fully integrated

## Introduction

qits' servable fixture family currently demonstrates exactly one frontend stack: the Angular
SPA (standalone in `qits-fixture-angular`, full-stack under Quinoa in
`qits-fixture-quarkus-angular`). This idea adds the second stack: a minimal but **servable
Quarkus 3 + Lit web-components (TypeScript) app** — `wohlben/qits-fixture-quarkus-lit` — where
**one Quinoa build serves multiple self-contained web components** plus a demo page composing
them. The goal is the same bar the Angular fixture cleared in
[quarkus-angular-fixture-full-integration](../../qits-testing-fixtures/features/2026-07-05_quarkus-angular-fixture-full-integration.md):
**full integration configuration** — framework detection, dev-server daemon + web view, OTEL,
log observation, feature-flows, coding agent — not just "it serves".

The stack's distinguishing idea (vs. the Angular SPA): **each component is responsible for its
own components.** A top-level web component lives in its own folder with its sub-components,
styles, and tests, and builds to its **own entry bundle** that registers everything it needs —
so components are developed together in one repo but are individually consumable (a plain
`<script type="module">` + custom-element tag on any page), and Quinoa serves them all from one
Quarkus app.

Related / dependent plans:

- **[qits-lit-webcomponents epic](../epic.md)** — this is its part 1; the epic states what the
  stack is and what it deliberately excludes (no `@qits/lit` library yet, no Lit-only fixture
  split yet).
- **[servable-quarkus-angular-fixture](../../qits-testing-fixtures/features/2026-07-05_servable-quarkus-angular-fixture.md)**
  + **[quarkus-angular-fixture-full-integration](../../qits-testing-fixtures/features/2026-07-05_quarkus-angular-fixture-full-integration.md)**
  — the templates this mirrors: app shape, branch layout, seed shape, and the C1–C7
  per-feature integration checklist.
- **[fixture-repos-split-and-submodules](../../qits-testing-fixtures/features/2026-07-14_fixture-repos-split-and-submodules.md)**
  — the packaging model reused verbatim: standalone GitHub repo → in-tree submodule → derived
  classpath bare via `scripts/derive-fixture-bares.sh`.
- **[workspace containers](../../qits-workspaces/features/2026-07-04_workspace-containers.md)** /
  **[lazy provisioning](../../qits-workspaces/features/2026-07-08_lazy-workspace-container-provisioning.md)**
  — the execution model the daemon runs in; nothing here changes it.
- **[daemons](../../qits-workspace-services/features/2026-07-04_daemons.md)** +
  **[daemon web-view picker](../../qits-workspace-detail/features/2026-07-05_daemon-webview-picker.md)**
  — the web view is the main thing the base-path work below exists for.
- **[SPA observability](../../qits-observability/features/2026-07-06_spa-observability.md)** —
  the convention (`/api/config.json` relay, `/api/otel/v1/*` passthrough) is
  framework-agnostic; the fixture integrates it directly (no library).
- **Framework detection** — the server-side `FrameworkDetectionService` (open framework ids)
  and the client icon/landing mapping in
  `service/src/main/webui/src/app/shared/utils/detect-frameworks.ts` grow a `ts-lit` entry.

## The fixture app

Same skeleton as `qits-fixture-quarkus-angular` — a single-module Quarkus 3 app
(`maven.compiler.release=25`, committed `./mvnw`), `quarkus-rest-jackson` + `quarkus-quinoa` +
`quarkus-opentelemetry` + `quarkus-smallrye-health`, `quarkus.rest.path=/api` — but the webui
is a **Vite + Lit + TypeScript** workspace instead of Angular:

```
pom.xml                                     Quarkus app; "quarkus" in it → Java / Quarkus label
src/main/java/…/GreetingResource.java       POST /api/greetings {name} → {name, timestamp}
src/main/resources/application.properties   /api prefix, OTEL logs/metrics on, quarkus.log file
src/main/webui/
  package.json  pnpm-lock.yaml  vite.config.ts  tsconfig.json
  index.html                                the demo page composing all components
  src/components/
    greeting-form/                           each top-level component: a self-contained folder
      greeting-form.ts                       <qits-greeting-form> — posts to api/greetings
      greeting-form.test.ts                  test↔code linking target
      name-input.ts                          a sub-component ONLY this bundle registers
    greeting-history/
      greeting-history.ts                    <qits-greeting-history> — listens + renders history
      greeting-history.test.ts
      greeting-entry.ts                      its own sub-component
docs/README.md                              lights up the Docs framework kind
.claude/settings.json  CLAUDE.md            repo ships its own agent config
src/test/java/…/GreetingResourceTest.java   @QuarkusTest
```

- **Multi-entry build (the "multiple webcomponents through one Quinoa" part).** `vite.config.ts`
  declares one Rollup entry per top-level component (`src/components/*/<name>.ts`) **plus** the
  demo `index.html`. The production build emits stable, unhashed component bundles (e.g.
  `dist/components/greeting-form.js`) so a consumer page can hot-link one component without
  knowing the build; the demo page uses the same bundles. Quinoa builds the webui (pnpm) and
  serves `dist/` with the rest of the app — one origin for components, demo page, and `/api`.
- **Self-contained components.** Each entry imports and `customElements.define`s everything it
  needs (its sub-components included), and nothing outside its folder. Loading
  `components/greeting-form.js` on a blank page yields a working `<qits-greeting-form>`.
- **Composition via DOM events, not shared state.** `<qits-greeting-form>` POSTs to
  `api/greetings` and dispatches a bubbling `qits-greeting` CustomEvent with the response;
  `<qits-greeting-history>` listens on its host scope and renders the log. The demo page is
  plain HTML placing both tags side by side — demonstrating that the components compose without
  importing each other.
- **Base-relative API calls (the web-view crux).** Components resolve the API endpoint against
  `document.baseURI` (never a leading `/api`), with an optional `api-base` attribute override —
  so the same bundle works at `/`, under the daemon web-view prefix, and embedded in a foreign
  page. The daemon start script passes
  `-Dquarkus.http.root-path="${QITS_PUBLIC_BASE:-/}"` exactly like the Angular fixture; Vite's
  `base` is set relative (`base: ''`) so emitted asset URLs survive any prefix.

**Branch layout** (the family convention): `main`; `feature/greeting` — a clean **fast-forward**
adding a welcome note inside `greeting-form/`; `feature/diverged` — rewording the same line, a
**conflict** with `main`. Divergence is real text divergence in this repo (no submodule
indirection — the webui is in-tree; see Open questions).

**Packaging**: a new empty GitHub repo `wohlben/qits-fixture-quarkus-lit`, mounted as a
submodule at `domain/src/test/resources/fixtures/testing-repo-quarkus-lit`, added to
`scripts/derive-fixture-bares.sh` (no `--recurse-submodules` needed — no nested submodule) and
to the build-cache input/exclude config; tests/seeds resolve
`getResource("/fixtures/testing-repo-quarkus-lit.git")`.

## The qits side

- **`seed-lit` cli command** (`SeedLitService`, sibling of `SeedWebappService`, **idempotent by
  reset**): a "Quarkus + Lit Demo" project + repo cloned from the fixture, a `greeting`
  workspace off `feature/greeting`, a web-viewable OTEL-enabled `quarkus:dev` daemon
  (`httpPort=8080`, `otel=true`, `readyPattern`, `LOG_LEVEL` + `PATTERN` observers, `FILE`
  `LogSource` on `quarkus.log`), and a "Build & Verify" feature-flow configuration (Build
  PREREQUISITE `./mvnw package` / Lint parallelGroup with `./mvnw spotless:check` +
  `pnpm --dir src/main/webui lint` / Test QUALITY_GATE). Covered by a `SeedLitServiceTest`
  mirroring `SeedWebappServiceTest`, incl. the double-seed idempotency check. The fixture's
  committed `.qits-config.yml` is the workspace-scoped source of truth for the
  service/actions, per the current convention.
- **Framework detection**: `FrameworkDetectionService` grows a Lit detector — a
  `src/main/webui/package.json` whose dependencies include `lit` (and no `angular.json`) →
  **`TypeScript / Lit`**, open id `ts-lit`, project root at the webui dir. Client side,
  `detect-frameworks.ts` maps `ts-lit` to a Lit icon and `src` as the auto-expand landing;
  test↔code linking pairs `foo.ts` ↔ `foo.test.ts` (the Vitest/web-test-runner convention —
  note the Angular pairing is `.spec.ts`, so this is a second suffix rule, not a config tweak).
- **No new runtime capability is needed** — Quinoa, the daemon supervisor, OTEL injection, the
  proxy, and the agent all work per-workspace already; this is configuration + detection + a
  seed, which is the point of the exercise (the managed-app convention is stack-agnostic).

## Acceptance checklist (mirrors the Angular fixture's)

1. **Detection**: workspace detail shows `Quarkus` + `Lit` (+ `Docs`) toggles; opening
   `greeting-form.ts` offers the jump to `greeting-form.test.ts`.
2. **Dev server**: the `quarkus:dev` daemon reaches READY; the web view renders the demo page
   with **both components live** and `POST api/greetings` works through the proxy prefix; the
   individual component bundle URLs (`components/greeting-form.js`) serve through the prefix
   too.
3. **Observability**: spans/logs/metrics appear scoped by `qits.workspace.id`; agent telemetry
   MCP tools attach.
4. **Log observation**: an app error produces a `daemon_event` and a chat `[daemon:…]` note.
5. **Feature-flow**: the seeded configuration renders.
6. **Agent**: chat picks up the fixture's `.claude/` + `CLAUDE.md`.
7. **Reset**: re-running `seed-lit` returns to the known-good state.
8. **Fixture divergence**: `feature/greeting` fast-forwards, `feature/diverged` conflicts.
9. **Standalone**: `./mvnw package` in the fixture is green (Quinoa builds the Vite webui,
   `@QuarkusTest` passes) and the packaged jar serves the demo page + component bundles.

As with the Angular fixture, items 2–4 need docker + the `qits/workspace` image
(`-Pextended`/manual); 1, 5, 7, 8 are deterministic.

## Open questions

- **Quinoa × Vite detection.** Does Quinoa's framework auto-detection recognize the Vite
  project (deriving dev-server port and build dir), or does the fixture pin
  `quarkus.quinoa.build-dir=dist` + an explicit dev-server port for the proxy? First thing to
  verify when scaffolding; the fallback config is small either way.
- **Vite dev server under the web-view prefix.** Production is easy (relative `base`), but in
  `quarkus:dev` Quinoa proxies Vite — confirm HMR websockets and the relative base survive the
  `/daemon/{…}/` prefix, the same class of question the Angular fixture's `ng serve` base-href
  raised (see the full-integration doc's open questions; the Vite answer may be simpler since
  there is no router and all URLs are relative).
- **Unhashed vs. hashed component bundles.** Stable names make components hot-linkable (the
  showcase) but defeat caching; hashed names need a manifest. Start unhashed — it is a demo
  fixture, and "a consumer can script-tag one component" is the property being demonstrated.
- **Frontend tests in the fixture.** Ship runnable component tests (Vitest +
  `@web/test-runner`-style browser env) or, like the Angular fixture's `greeting.spec.ts`,
  minimal not-executed files purely for test↔code linking? Lean runnable-but-tiny: the
  feature-flow's Test action then has something real to name.
- **`seed-lit` vs. extending `seed-webapp`.** A separate command keeps each seed's reset scope
  (delete-by-project-name) independent and mirrors the `seed`/`seed-webapp` precedent; extending
  `seed-webapp` would couple two demos' lifecycles. Separate is the recommended default.
- **Later split.** If a Lit-only fixture (framework detection without a backend, embedding
  showcase) earns its place, the webui would be extracted to a `qits-fixture-lit` repo and
  recomposed as a submodule — exactly the Angular split. Deliberately **not** in this cut:
  start in-tree, split when a consumer exists (that promotion is the epic's candidate part 2).
