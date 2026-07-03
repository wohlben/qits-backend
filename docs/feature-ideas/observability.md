# Observability: in-process OTLP receiver, telemetry for agents

## Introduction

Dev servers started by qits can be launched with OpenTelemetry instrumentation — qits controls
their environment, so pointing them at an OTLP endpoint is one env var. This idea makes qits
itself that endpoint: a **minimal in-process OTLP/HTTP receiver** holding recent traces, logs and
metrics in **bounded in-memory buffers — no database**, ephemeral by design, like otel-tui but
with an API. The point is not dashboards; it's making telemetry **available to the coding
agents** through the MCP server they already carry ("show me error spans from the last 5
minutes", "logs for trace X"), which beats regex/LLM log scraping because exceptions arrive
structured, stack traces attached, correlated by trace id.

Related/dependent plans:

- Delivery vehicle is [daemons](daemons.md): daemon definitions grow an `otel` toggle that
  injects `OTEL_EXPORTER_OTLP_*` env vars at launch, and the observability data upgrades the
  daemons idea's error detection (structured exception events instead of log-regex guesses).
  Works without daemons too — anything run in a qits terminal can export to the endpoint.
- Agent access rides the MCP server from the
  [coding-agent harness](../features/2026-07-01_coding-agent-harness.md)
  (`RepositoryScope`, per-scope tool filtering) — telemetry tools join the action tools there.
- Resource attributes stamped at launch reuse the identity model of the
  [command registry](../features/2026-06-30_command-registry.md) (worktree id, command id).

## Build vs buy (researched 2026-07-03)

Surveyed the landscape with the constraints *no Docker, no real DB, agent-queryable*:

- **Ephemeral viewers** — `otel-tui` (terminal, fixed 1000-span/1000-log ring, data trapped in
  the TUI) and `otel-front` (young, in-memory DuckDB + web UI, no public API) are agent-useless.
  **`otel-desktop-viewer` is the honorable mention**: single Go binary, all three signals,
  in-memory DuckDB, and — verified in its source — a JSON-RPC 2.0 API at `POST /rpc`
  (`searchSpans`, `searchLogs`, `getMetric`, `clearTraces`, …) that agents could curl. Rejected
  anyway: the RPC surface is internal/unversioned, it's a single-maintainer project, there's no
  MCP, and qits would run one more managed binary only to adapt its agents to someone else's
  RPC instead of its own scoped MCP tools. It's the fallback if the in-process receiver stalls.
- **Real backends** are all disqualified on footprint or dependencies: SigNoz (ClickHouse +
  Docker, ~2 GB), grafana/otel-lgtm and the Quarkus LGTM Dev Service (container-only),
  OpenObserve (nice SQL-over-HTTP API but ~0.5–1 GiB and its own storage), Jaeger v2
  (traces-only), Quickwit (frozen since the Datadog acquisition). The closest fit is the
  **VictoriaMetrics/Logs/Traces trio** — small static binaries, embedded storage, and the only
  candidates with **first-party MCP servers** — but that's three processes, three query
  dialects, and on-disk state: a real backend after all. Noted as the escape hatch if in-memory
  ever stops being enough.
- **JVM-side receiving**: no library or Quarkus extension implements the OTLP server side
  (`quarkus-opentelemetry` only exports; the only official receive-side story is the
  Docker-based LGTM Dev Service). But the protocol is deliberately receivable: OTLP/HTTP is
  **three POST endpoints** (`/v1/traces`, `/v1/logs`, `/v1/metrics`), success = `200` with an
  empty `Export…ServiceResponse` (body content-type must mirror the request; `partialSuccess`
  for partial rejection). Two encodings — and the choice matters: OTLP/**JSON** *deviates* from
  standard proto3 JSON (trace/span ids are hex not base64, enums must be integers), so
  protobuf-java's stock `JsonFormat` parser can't read it and JSON means a hand-mapped Jackson
  parser. OTLP/**protobuf** has zero quirks: Maven bindings exist
  (`io.opentelemetry.proto:opentelemetry-proto:1.7.0-alpha` — alpha names an unstable Java API,
  the wire format itself is Stable) and decoding is ~5 lines per signal. Since qits sets the
  child environment, it can pin every exporter to `http/protobuf` — which the Java agent 2.x
  and Node default to anyway — and skip both gRPC and JSON entirely.

**Decision: implement it ourselves.** Zero new processes, and the data lands in the same JVM
that already serves the agents' MCP tools.

## New base concepts

1. **Telemetry receiver** — a JAX-RS resource in `service` at `@Path("otel/v1")` (so
   `POST /api/otel/v1/{traces,logs,metrics}` — already SPA-excluded under `/api`; SDKs append
   `/v1/<signal>` to the endpoint base URL *including its path prefix*, so this needs no
   port or root-path tricks). **Protobuf-only**: consume `application/x-protobuf` as `byte[]`,
   decode with the `opentelemetry-proto` bindings into slim internal records (resource attrs,
   scope, spans with status/events, log records, number data points; drop what we don't use).
   Handle `Content-Encoding: gzip` defensively; respond `200` with an empty protobuf body.
2. **Telemetry store** — `@ApplicationScoped` in-memory store, same philosophy as the command
   ring buffer: per-signal bounded deques (e.g. last N spans / log records / metric points,
   plus a byte cap), indexed by trace id and by the `qits.*` resource attributes. Eviction =
   drop oldest. JVM restart = empty store. **No entity, no migration, no H2 table.**
3. **Agent query surface** — MCP tools (and thin REST twins for the UI), scoped like action
   tools so an agent only sees its worktree's telemetry:
   - `telemetry_errors(sinceMinutes)` — error-status spans + `exception` span events + ERROR
     logs, deduped by trace
   - `telemetry_trace(traceId)` — full span tree + correlated logs (OTLP logs carry traceId)
   - `telemetry_slow_spans(thresholdMs, sinceMinutes)`
   - `telemetry_search_logs(query, sinceMinutes)`
   - `telemetry_metrics(name?)` — latest value per metric (gauges/counters flattened; no
     time-series math)

## Wiring (where daemons meet telemetry)

At daemon/command launch with `otel` enabled, qits injects:

- `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:<qits-port>/api/otel`
  (SDKs append `/v1/<signal>` themselves)
- `OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf` (Java agent 2.x and Node default to it; this
  normalizes Python and anything else that still defaults to gRPC)
- `OTEL_SERVICE_NAME=<daemon name>`
- `OTEL_RESOURCE_ATTRIBUTES=qits.worktree.id=…,qits.repository.id=…,qits.command.id=…`

That last line is the correlation backbone: every span/log/metric arrives pre-tagged with the
worktree, so MCP scope filtering is an attribute match, and a daemon `ERROR_DETECTED` event can
carry `traceId`s from the same time window as richer evidence than a log excerpt.

Instrumentation itself stays the target app's business, with zero-code defaults documented per
ecosystem (Quarkus: `quarkus-opentelemetry` honors the env vars; plain Java:
`JAVA_TOOL_OPTIONS=-javaagent:…` — pure env; Node:
`NODE_OPTIONS="--require @opentelemetry/auto-instrumentations-node/register"` — pure env;
Python: `opentelemetry-instrument python app.py` — wraps the command, so it goes in
`startScript`, not `environment`). A daemon definition bakes these in per stack.

## UI sketch (deliberately thin)

The agents are the primary consumer. For humans, iteration one is a small "telemetry" tab on the
worktree detail: recent errors feed (span status + exception events), click-through to a flat
span list for a trace, and a live log tail filtered by service. No waterfall, no charts — if
that itch grows, revisit the VictoriaMetrics trio rather than building Grafana into qits.

## Explicitly deferred

- JSON ingestion (`application/json`) — OTLP/JSON's deviations from proto3 JSON (hex ids,
  integer enums) make it a hand-written Jackson parser, and no SDK needs it once the env var
  pins `http/protobuf`. Only relevant for telemetry sources qits doesn't launch itself.
- gRPC/OTLP (port 4317) — same reason: the env var makes it unnecessary.
- Any persistence (H2 spill, retention on disk) — ephemerality is the feature.
- Metrics beyond latest-value flattening (histograms, rate math, PromQL-ish queries).
- Trace waterfall / flame graph UI.
- The daemon MODEL log observer consuming telemetry instead of raw stdout (they coexist:
  telemetry for instrumented apps, log observation for everything else).

## Open questions

- Buffer sizing: global caps vs per-worktree caps so one chatty daemon can't evict a quieter
  worktree's telemetry? Lean: per-worktree deques, global byte ceiling.
- Do ERROR-severity telemetry events flow into the daemons idea's event/sink pipeline (agent
  notification on exception spikes), or stay pull-only in iteration one? Lean: pull-only first;
  the sink integration is the natural follow-up once both exist.
- Pin the `opentelemetry-proto` alpha artifact, or vendor the `.proto` files and generate only
  the messages we need via `protobuf-maven-plugin`? Lean: the artifact — it's a dev tool, the
  alpha label is about Java API stability, and one dependency beats a codegen build step.

## Testing sketch

- Receiver test (`@QuarkusTest`, REST Assured): POST protobuf-encoded `Export…ServiceRequest`
  fixtures (built with the same proto bindings) for all three signals → `200`, empty protobuf
  body, matching content type; gzipped body accepted; garbage bytes → `400`; store contains
  the decoded spans/logs with resource attributes intact.
- Store test: cap enforcement (oldest evicted), trace-id index, worktree-attribute filtering.
- Query-tool tests: error span + exception event + ERROR log across two traces →
  `telemetry_errors` groups by trace; `telemetry_trace` returns spans + correlated logs;
  scope filtering hides other worktrees' data.
- Manual: seeded repo, daemon = a Quarkus sample with `quarkus-opentelemetry`, hit an endpoint
  that throws, then in the worktree chat ask the agent to investigate — it should pull the
  exception span through MCP without touching log files.
