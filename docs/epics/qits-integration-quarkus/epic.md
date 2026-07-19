# Epic: qits-integration-quarkus — the managed-app integration contract

## Introduction

The **Quarkus/backend side of qits' managed-app integration convention**: the contract a
Quarkus/Quinoa/Angular app fulfils to become fully qits-managed — the `GET /api/config.json`
identity relay, the `POST /api/otel/v1/*` OTLP passthrough, the dev-server daemon and web-view
proxy prefix, log observation — captured as one durable **integration guide** rather than as
the scattered sum of feature diffs, and **dogfooded** by qits conforming to its own convention.

**Cross-cutting integration epic**, not part of the projects → repositories → workspaces
aggregate chain, and the backend counterpart to
[qits-integration-angular](../qits-integration-angular/epic.md) (the SPA library). Together they
are the two halves of "make an app qits-manageable"; the concrete mechanisms live in the domains
that own them (below), while this epic owns the **contract and its documentation**.

**Scope rule** — this epic owns the **integration contract as a whole**: the guide that walks a
fresh Quarkus starter to a managed app, and qits' dogfooding of it. The individual mechanisms it
composes live in their own domains and are only *referenced* here:

- **The OTEL half** — [qits-observability](../qits-observability/epic.md) (SPA-observability's
  `config.json` relay + OTLP passthrough).
- **The SPA library** — [qits-integration-angular](../qits-integration-angular/epic.md).
- **The dev-server / web-view mechanics** — [qits-workspace-daemons](../qits-workspace-daemons/epic.md)
  (web-view configuration) and the [qits-workspace-detail](../qits-workspace-detail/epic.md)
  web-view picker.

The durable, updated-in-place how-to lives in `docs/guides/quarkus-angular-integration.md`; the
part below is the *feature* that created and shaped that guide.

## Parts (implemented)

- **[quarkus-angular-integration-guide](features/2026-07-07_quarkus-angular-integration-guide.md)**
  (07-07) — turn the integration contract (scattered across feature docs as the fixture's diffs)
  into a single tiered guide: from a fresh Quarkus/Quinoa/Angular starter to a fully qits-managed
  app.
- **[qits-dogfooding-managed-app-convention](features/2026-07-18_qits-dogfooding-managed-app-convention.md)**
  (07-18) — qits conforms to its *own* managed-app convention (config.json relay, OTLP path,
  `@qits/angular`), so qits-in-qits is a real managed app and the convention is proven by use.

## Done when

Rolling: current when its `feature-ideas/` is empty and every managed-app-contract feature since
this epic's creation has landed here.

## Status

| Part | Status |
|---|---|
| [quarkus-angular-integration-guide](features/2026-07-07_quarkus-angular-integration-guide.md) | implemented |
| [qits-dogfooding-managed-app-convention](features/2026-07-18_qits-dogfooding-managed-app-convention.md) | implemented |
