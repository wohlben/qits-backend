# Epic: qits-lit-webcomponents — Lit web components as a second frontend stack

## Introduction

The **Lit web-components stack**: establishing Lit (TypeScript) web components as a second
frontend technology qits fully understands and demos, alongside Angular — packaged and served
through **Quinoa** just like the Angular SPA, but with a different composition model. Where the
Angular fixture is *one* SPA, the Lit stack is **many self-contained components served by one
Quarkus app**: each web component owns its own sub-components, styles, and tests in its own
folder and builds to its own entry bundle, so components can be developed side by side in one
repo and consumed independently (`<script type="module">` + a custom element tag), with Quinoa
responsible for building and serving all of them.

**Cross-cutting stack epic**, not part of the projects → repositories → workspaces aggregate
chain. It builds on:

- **[qits-testing-fixtures](../qits-testing-fixtures/epic.md)** — the fixture packaging
  machinery this epic reuses verbatim: a standalone `wohlben/qits-fixture-*` GitHub repo,
  mounted as a submodule under `domain/src/test/resources/fixtures/`, with the classpath bare
  derived offline by `scripts/derive-fixture-bares.sh`. That epic keeps owning the
  Angular-family fixtures; the Lit fixture is owned here (it is the stack's reference
  implementation, not just another fixture).
- **[qits-integration-quarkus](../qits-integration-quarkus/epic.md)** — the backend half of
  the managed-app convention the Lit fixture fulfils, unchanged (the convention is
  frontend-framework-agnostic).
- **[qits-observability](../qits-observability/epic.md)** — the SPA-observability convention
  (`GET /api/config.json` identity relay, `POST /api/otel/v1/*` OTLP passthrough) the stack
  instruments against.

**Scope rule** — this epic owns **the Lit stack end-to-end**: the multi-component webui layout
convention (one folder + one build entry per component), its Quinoa build/serve wiring, the
`qits-fixture-quarkus-lit` fixture repo, its seed command, and the qits-side touches that make
the stack first-class (a Lit framework detector, test↔code linking). It does **not** own:

- The **Angular stack** — [qits-integration-angular](../qits-integration-angular/epic.md) and
  the existing fixtures stay untouched; nothing here replaces Angular in qits' own UI.
- **Framework detection as a mechanism** — the server-side `FrameworkDetectionService` and its
  open-id seam exist already; this epic only contributes a detector to it.
- A future **`@qits/lit` integration library** (the sibling of `@qits/angular`, per the
  `qits-<surface>-integration` scheme) — a natural later part, but not drafted yet; the fixture
  starts by integrating the observability convention directly.

## Parts, in implementation order

1. **[servable-quarkus-lit-fixture](feature-ideas/servable-quarkus-lit-fixture.md)** — the
   foundation and first cut of everything: a minimal but **servable** Quarkus 3 + Lit
   web-components fixture (`qits-fixture-quarkus-lit`, multiple self-contained components
   built and served through one Quinoa), wired to the **full qits integration surface**
   (framework detection, dev-server daemon + web view, OTEL, log observation, feature-flows,
   coding agent) the way the quarkus-angular fixture is, plus its `seed-lit` command.

Candidate later parts (not drafted): a Lit-only frontend fixture split (the `qits-fixture-lit`
sibling of `qits-fixture-angular`, composed back via submodule), and the `@qits/lit`
integration library once the convention's Lit packaging stabilizes.

## Done when

Rolling: current when its `feature-ideas/` is empty and every Lit-stack feature since this
epic's creation has landed here. The first milestone is part 1 end-to-end: `seed-lit` produces
a demo project whose workspace detects the Lit stack, serves the multi-component demo page
through the daemon web view, and exports telemetry — the same acceptance walk the
quarkus-angular fixture passes today.

## Status

| Part | Status |
|---|---|
| [servable-quarkus-lit-fixture](feature-ideas/servable-quarkus-lit-fixture.md) | idea |
