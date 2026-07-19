# Epic: qits-integration-angular — the `@qits/angular` library

## Introduction

The **SPA-side integration library**: `@qits/angular`, a distributable Angular library
(`github.com/wohlben/qits-angular-integration`) that an app opts into with two lines instead of
~400 copied ones. It packages the browser half of qits' managed-app convention so an integrated
app **gains features by upgrading a dependency**, not by re-copying files: OTEL instrumentation,
the always-on feature-capture button, and app-state snapshotting.

**Cross-cutting integration epic**, not part of the projects → repositories → workspaces
aggregate chain. Its own repository (like the Java sibling
[qits-java-testing-integration](../qits-userflows/feature-ideas/qits-java-testing-integration-library.md),
named by the same `qits-<surface>-integration` scheme), with the
[testing-repo-quarkus-angular fixture](../qits-testing-fixtures/epic.md) as its reference
consumer.

**Scope rule** — this epic owns **the library and what physically ships in it**: the repo
bootstrap, the `provideQitsIntegration()` packaging, and the two capture surfaces that ride
inside it (button + state feature). Related but *not* here:

- **The observability *convention*** the library instruments against —
  [qits-observability](../qits-observability/epic.md) (SPA observability, telemetry
  meta-enrichment). This epic owns the library *packaging* of that convention; observability
  owns the convention itself.
- **The Quarkus/backend half** of the same managed-app convention —
  [qits-integration-quarkus](../qits-integration-quarkus/epic.md).
- **The capture *backend*** — the `POST /api/capture` receiver that turns a snapshot into a
  branch + workspace, and the rendered-view screenshot idea, live in
  [qits-feature-intake](../qits-feature-intake/epic.md); the two capture parts here are included
  because they are library-resident SPA *producers*, not because this epic owns capture
  end-to-end (that epic owns the qits-side intake).

## Parts (implemented)

- **[angular-lib-repo-bootstrap](features/2026-07-13_angular-lib-repo-bootstrap.md)** (07-13) —
  the walking skeleton: the `@qits/angular` repository stood up.
- **[qits-angular-integration-library](features/2026-07-13_qits-angular-integration-library.md)**
  (07-13) — the foundation: `provideQitsIntegration()` / `initQitsIntegration()` packaging the
  copy-paste integration convention into a two-line opt-in.
- **[spa-feature-capture](features/2026-07-14_spa-feature-capture.md)** (07-14) — the always-on
  floaty capture button the library renders inside the integrated app, snapshotting the running
  SPA (frozen DOM + route + environment).
- **[capture-state-snapshot](features/2026-07-14_capture-state-snapshot.md)** (07-14) — the
  state dimension: a `withQitsSnapshot('name')` `@ngrx/signals` feature so a capture carries
  *what the app knew*, not just what it rendered.

## Done when

Rolling: current when its `feature-ideas/` is empty and every `@qits/angular` feature since this
epic's creation has landed here.

## Status

| Part | Status |
|---|---|
| [angular-lib-repo-bootstrap](features/2026-07-13_angular-lib-repo-bootstrap.md) | implemented |
| [qits-angular-integration-library](features/2026-07-13_qits-angular-integration-library.md) | implemented |
| [spa-feature-capture](features/2026-07-14_spa-feature-capture.md) | implemented |
| [capture-state-snapshot](features/2026-07-14_capture-state-snapshot.md) | implemented |
