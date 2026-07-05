# Observability: in-process OTLP receiver, telemetry for agents

## Introduction

Dev servers started by qits can be launched with OpenTelemetry instrumentation — qits controls
their environment, so pointing them at an OTLP endpoint is one env var. qits itself is that
endpoint: a **minimal in-process OTLP/HTTP receiver** holding recent traces, logs and metrics in
**bounded in-memory buffers — no database**, ephemeral by design, like otel-tui but with an API.
The point is not dashboards; it's making telemetry **available to the coding agents** through the
MCP server they already carry ("show me error spans from the last 5 minutes", "logs for trace X"),
which beats regex/LLM log scraping because exceptions arrive structured, stack traces attached,
correlated by trace id.

Related/dependent plans:

- Delivery vehicle is [daemons](2026-07-04_daemons.md): daemon definitions have an `otel` toggle
  that injects `OTEL_EXPORTER_OTLP_*` env vars at launch. Works without daemons too — anything
  run in a qits terminal can export to the endpoint (it lands in the bounded `_unscoped` bucket
  unless it carries the `qits.*` resource attributes).
- Agent access rides the MCP server from the
  [coding-agent harness](2026-07-01_coding-agent-harness.md): the telemetry tools join the
  `repository` MCP server behind a new **workspace scope dimension** (`X-QITS-Workspace` /
  `?workspaceId=`), added by this feature.
- Resource attributes stamped at launch reuse the identity model of the
  [command registry](2026-06-30_command-registry.md) (workspace id, repository id, command id).
- Deferred follow-up: ERROR-severity telemetry flowing into the daemons event/sink pipeline
  (agent notification on exception spikes). Iteration one is pull-only.

## Build vs buy (researched 2026-07-03)

Surveyed with the constraints *no Docker, no real DB, agent-queryable*: ephemeral viewers
(otel-tui, otel-front, otel-desktop-viewer) are agent-useless or someone else's unversioned RPC;
real backends (SigNoz, LGTM, OpenObserve, Jaeger v2, Quickwit, the VictoriaMetrics trio) all fail
on footprint, containers, or on-disk state. The VictoriaMetrics trio (first-party MCP servers)
stays the escape hatch if in-memory ever stops being enough. No JVM library implements the OTLP
server side, but OTLP/HTTP is three POST endpoints, and OTLP/**protobuf** has zero wire quirks
(unlike OTLP/JSON, which deviates from proto3 JSON). Since qits sets the child environment, it
pins every exporter to `http/protobuf` and skips gRPC and JSON entirely.

**Decision: implemented in-process.** Zero new processes; the data lands in the same JVM that
serves the agents' MCP tools.

## As built

Everything telemetry lives in the **`service` module** under
`eu.wohlben.qits.domain.telemetry.{control,dto,api,mcp}` (BCE package shape without the module
split: there is no entity/persistence/migration, no domain-module consumer, and keeping
`opentelemetry-proto` out of `domain` keeps it out of `cli`). The only domain-module pieces are
the daemon `otel` column (V22) and `command.control.OtelEnvironment` + the `CommandService`
injection seam.

1. **Telemetry receiver** — `api/OtelReceiverResource`, `POST /api/otel/v1/{traces,logs,metrics}`
   (SDKs append `/v1/<signal>` to the endpoint base themselves). **Protobuf-only**: consumes
   `application/x-protobuf` as `byte[]`, decodes with
   `io.opentelemetry.proto:opentelemetry-proto:1.7.0-alpha` (pinned; "alpha" = Java API
   stability, the wire format is Stable). Gzip is handled defensively **by magic bytes**
   (`1f 8b`), not the `Content-Encoding` header. Success = `200` with an empty
   `Export…ServiceResponse`; garbage = `400`. Hidden from OpenAPI (`@Operation(hidden=true)`) so
   the generated Angular client never sees byte[] endpoints.
2. **Telemetry decoder + store** — `control/TelemetryDecoder` (the only class touching
   `io.opentelemetry.proto.*`) produces slim records (`dto/StoredSpan`, `StoredLog`,
   `MetricPoint`); span links, dropped counts, flags, trace state, schema URLs, scope
   attrs/version, exemplars and all metric types except Gauge/Sum are discarded.
   `control/TelemetryStore` is `@ApplicationScoped`, per-workspace buckets keyed
   `repoId/workspaceId` from the `qits.*` resource attributes (missing → `_unscoped`, bounded but
   unqueryable), with a trace-id index per bucket. Two-tier bounding: per-workspace count caps and
   a global byte ceiling that evicts oldest-first from the **fattest** bucket, so a chatty daemon
   pays for its own volume. Config (`qits.telemetry.*`): `max-spans-per-workspace` 5000,
   `max-logs-per-workspace` 10000, `max-metric-series-per-workspace` 500,
   `max-total-bytes` 64 MiB. All windowing uses `receivedAtMillis` (server clock), never
   exporter timestamps. JVM restart = empty store. **No entity, no migration, no H2 table.**
3. **Agent query surface** — `mcp/TelemetryMcpTools` on the existing `repository` MCP server
   (camelCase per codebase convention): `telemetryErrors(sinceMinutes?)` (error spans +
   `exception` events + ERROR logs ≥ severity 17, grouped by trace), `telemetryTrace(traceId)`
   (flat span list + correlated logs), `telemetrySlowSpans(thresholdMs, sinceMinutes?)`,
   `telemetrySearchLogs(query, sinceMinutes?)`, `telemetryMetrics(name?)` (latest value per
   series). Identity comes from the connection only: the new `mcp/WorkspaceScope`
   (`X-QITS-Workspace` / `?workspaceId=`) plus the existing repository narrowing;
   `mcp/TelemetryToolFilter` hides the tools from any session not scoped to both (fails closed).
   `AgentLaunchService` appends `&workspaceId=` to the narrowed repository-server URL and
   pre-approves the five tools as read-only. PROJECT-scoped sessions have no repository
   narrowing, so they intentionally don't see telemetry tools.
4. **REST twins** — `api/WorkspaceTelemetryController` under
   `/api/repositories/{repoId}/workspaces/{workspaceId}/telemetry/{errors,traces/{id},slow-spans,logs,metrics}`,
   JSON, sharing `control/TelemetryQueryService` with the MCP tools so humans and agents see the
   same answers.

## Wiring (where daemons meet telemetry)

`RepositoryDaemon.otel` (V22, surfaced in the REST controller, `DaemonMcpTools` and the daemon
form's checkbox) flows through `DaemonSupervisor.launch` →
`CommandService.launchDaemon(…, otel)` → `prepare()`, which injects — *after* `TERM`, *before*
the definition's own environment, so *an explicit user `OTEL_*` var wins*:

- `OTEL_EXPORTER_OTLP_ENDPOINT=http://<git-host>:<qits-port>/api/otel` — composed via
  `QitsHostResolver` + `qits.workspace.qits-port` exactly like the git clone URL, because the
  process runs in a workspace container where `localhost` would silently miss (the original
  idea's `localhost` was wrong).
- `OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf` (normalizes SDKs that still default to gRPC)
- `OTEL_SERVICE_NAME=<daemon name>`
- `OTEL_RESOURCE_ATTRIBUTES=qits.workspace.id=…,qits.repository.id=…,qits.command.id=…`

The injection happens inside `prepare()` because the persisted command row already exists there —
so `qits.command.id` is real, and every supervisor relaunch re-derives the overlay with the fresh
command id. That last line is the correlation backbone: every span/log/metric arrives pre-tagged
with the workspace, so MCP scope filtering is an attribute match.

Instrumentation itself stays the target app's business, zero-code per ecosystem (Quarkus:
`quarkus-opentelemetry` honors the env vars; plain Java: `JAVA_TOOL_OPTIONS=-javaagent:…`; Node:
`NODE_OPTIONS="--require @opentelemetry/auto-instrumentations-node/register"`; Python:
`opentelemetry-instrument python app.py` — wraps the command, so it goes in `startScript`).

## UI (deliberately thin)

The agents are the primary consumer. For humans, the workspace detail page gained tabs
(`Files` / `Telemetry`): `pattern/telemetry/workspace-telemetry.component.ts` polls (5s) a recent
errors feed (`ui/components/telemetry/telemetry-error-feed`, exception events expanded with stack
traces), click-through to a flat span list per trace (`telemetry-span-list`, no waterfall), and a
log tail filterable by service (`telemetry-log-tail`). If the dashboard itch grows, revisit the
VictoriaMetrics trio rather than building Grafana into qits.

## Explicitly deferred

- JSON ingestion (`application/json`) — OTLP/JSON's deviations (hex ids, integer enums) mean a
  hand-written parser, and no SDK needs it once the env var pins `http/protobuf`.
- gRPC/OTLP (port 4317) — same reason.
- Any persistence (H2 spill, retention on disk) — ephemerality is the feature.
- Metrics beyond latest-value flattening (histograms, rate math, PromQL-ish queries).
- Trace waterfall / flame graph UI.
- ERROR-telemetry → daemon event/sink pipeline (agent push notification); pull-only for now.
- A query surface for the `_unscoped` bucket.

## Testing

- `TelemetryStoreTest` (plain JUnit): cap eviction + trace-index pruning, byte accounting,
  global ceiling evicting the fattest bucket, span-vs-log oldest-first, metric latest-wins +
  series cap, workspace bucket isolation, `_unscoped` quarantine.
- `TelemetryDecoderTest`: error span + exception event + resource attrs, observed-time fallback,
  Gauge/Sum decoding + histogram drop, attribute flattening.
- `OtelReceiverResourceTest` (`@QuarkusTest`, REST Assured, proto-built fixtures from
  `TelemetryFixtures`): 200 + empty protobuf + mirrored content type per signal, gzip by magic
  bytes, garbage → 400, store contents.
- `TelemetryMcpToolsTest` (`quarkus-mcp-server-test`): trace grouping, correlated logs, workspace
  isolation, tool filter (hidden without workspace scope).
- `WorkspaceTelemetryControllerTest`: the JSON twins against a seeded store.
- `OtelEnvironmentTest` + `CommandServiceTest` daemon-launch tests: exact env composition against
  pinned git-host/port, injected overlay carries the persisted command id, user overrides win,
  no injection without the toggle.
- `workspace-telemetry.component.spec.ts`: error feed with exception evidence, trace
  click-through, service filter options.
- Manual E2E (per the idea's sketch): seeded repo, daemon = a Quarkus sample with
  `quarkus-opentelemetry` and `otel` on, hit a throwing endpoint, ask the workspace chat agent to
  investigate — it pulls the exception span through MCP without touching log files. On WSL2 the
  endpoint host resolves to the distro's eth0 IP (see `QitsHostResolver`).
