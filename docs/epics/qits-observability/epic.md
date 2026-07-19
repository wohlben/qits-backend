# Epic: qits-observability — the OpenTelemetry pipeline

## Introduction

The **tracing/OTEL data pipeline**: qits' in-process OTLP receiver, the browser-telemetry
proxying that extends it to SPAs, and the span/log/metric enrichment that gives that data an
interior and `code.*` attribution. The point is not dashboards — it is making a workspace
app's telemetry **structured, correlated, and available to the coding agents** (via the MCP
tools they already carry) and to the Telemetry tab. This is a **retroactive umbrella epic**
(same flavor as [qits-workspace-detail](../qits-workspace-detail/epic.md)): it gathers
already-implemented pipeline features so the domain has one home, and future OTEL work lands
here.

**Scope rule** — this epic owns the **data pipeline**: the OTLP receiver and its bounded
buffers, browser→backend OTLP passthrough + identity relay, and the semantic conventions /
enrichment of the spans, logs and metrics themselves. It deliberately does **not** own the
surfaces that *produce for* or *consume* the pipeline:

- **Delivery** stays in the [daemon domain](../qits-workspace-daemons/features/2026-07-04_daemons.md): a daemon's
  `otel` toggle injects `OTEL_EXPORTER_OTLP_*` at launch. This epic defines the endpoint those
  env vars point at; the daemon feature decides who gets pointed.
- **Agent access** stays with the [coding-agent harness](../qits-coding-agents/features/2026-07-01_coding-agent-harness.md):
  the telemetry MCP tools ride that server. This epic produces the data they read.
- **The Telemetry tab UI** stays in [qits-workspace-detail](../qits-workspace-detail/epic.md)
  (`telemetry-sub-tabs`, `telemetry-page-load-span-hiding`, `workspace-observation-tabs`) —
  it *renders* this pipeline. Frontend surface there, data pipeline here.
- **SPA library packaging** stays in
  [qits-integration-angular](../qits-integration-angular/epic.md): the browser instrumentation
  this epic's SPA parts define is distributed as `@qits/angular`. This epic owns the
  *convention*; that epic owns its *reusable packaging*.

## Parts (implemented)

The base receiver first; the SPA extension and the two enrichment siblings build on it.

- **[observability](features/2026-07-04_observability.md)** (07-04) — the foundation: a minimal
  in-process **OTLP/HTTP receiver** holding recent traces/logs/metrics in bounded in-memory
  buffers (no DB, ephemeral), exposed to agents through the MCP server. Everything else here
  extends this endpoint.
- **[spa-observability](features/2026-07-06_spa-observability.md)** (07-06) — the **browser
  half**: the backend proxies browser OTLP (`POST /api/otel/v1/*`) and relays identity via
  `/api/config.json`, so a workspace app's SPA — invisible to env-var injection — exports
  document-load, client fetch timing, and JS errors into the same pipeline.
- **[backend-telemetry-meta-enrichment](features/2026-07-11_backend-telemetry-meta-enrichment.md)**
  (07-11) — server spans gain `code.*` handler attribution (a JAX-RS filter stamps FQCN /
  method / workspace-relative filepath) and an **interior** via `@WithSpan` on business seams.
- **[spa-telemetry-meta-enrichment](features/2026-07-11_spa-telemetry-meta-enrichment.md)**
  (07-11) — the browser sibling: route context (`app.route.path`), named **interaction spans**
  (`data-track-event`, owning component), and caller attribution (`code.*`) on fetch spans.

## Parts (ideas)

- **[standalone-telemetry-service](feature-ideas/standalone-telemetry-service.md)** *(idea)* — pull
  the whole pipeline (receiver, decoder, store, query, REST twins, MCP tools) out of `service` into
  its **own Quarkus-app deployable**, so telemetry runs as a separate process — for heap/ingest
  isolation, restart independence, and the VictoriaMetrics swap-out seam. The **inverse** of the
  [standalone-artifacts-service](../qits-artifacts/feature-ideas/standalone-artifacts-service.md)
  split (telemetry was built in-process on purpose, so this is a refactor: extract a `telemetry/`
  library module first, then the app on top). Also helps drive `/api/otel/*` off `service`'s shared
  `max-body-size`.

## Done when

Rolling, like any umbrella epic: current when its `feature-ideas/` is empty and every
tracing/OTEL feature since this epic's creation has landed here. New pipeline work starts as a
draft in this epic's `feature-ideas/`, not in the flat `docs/feature-ideas/`. **Currently one open
idea** (standalone-telemetry-service), so the epic is not at rest.

## Status

4 parts implemented (everything under [features/](features/)); 1 open idea.

| Part | Status |
|---|---|
| [observability](features/2026-07-04_observability.md) | implemented |
| [spa-observability](features/2026-07-06_spa-observability.md) | implemented |
| [backend-telemetry-meta-enrichment](features/2026-07-11_backend-telemetry-meta-enrichment.md) | implemented |
| [spa-telemetry-meta-enrichment](features/2026-07-11_spa-telemetry-meta-enrichment.md) | implemented |
| [standalone-telemetry-service](feature-ideas/standalone-telemetry-service.md) | idea |
