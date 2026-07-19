# Split the telemetry pipeline into its own Quarkus server

## Introduction

The [observability pipeline](../features/2026-07-04_observability.md) — the OTLP/HTTP receiver, the
`TelemetryDecoder`, the bounded in-memory `TelemetryStore`, the `TelemetryQueryService`, the REST
twins and the agent MCP tools — lives **entirely inside the `service` module** today, under
`eu.wohlben.qits.domain.telemetry.{control,dto,api,mcp}`. This draft pulls the whole pipeline out of
`service` into its **own Quarkus-app deployable**, so telemetry ingest, storage and query run as a
**separate process** the way the git host or a split artifacts would.

The honest framing up front: this is the **inverse of the**
[standalone-artifacts-service](../../qits-artifacts/feature-ideas/standalone-artifacts-service.md)
**split**. Artifacts was *built* split-ready (its own module, datasource, Flyway lineage; only the
REST boundary in `service`), so its split is a lift-and-wire. Telemetry was built **in-process on
purpose** ("Zero new processes; the data lands in the same JVM that serves the agents' MCP tools" —
the observability feature's explicit decision), so this split is a **refactor**, and it almost
certainly wants **two parts**: first extract a framework-light `telemetry/` **library module**
(mirroring the shape `artifacts/` already had *before* its own split idea), then stand up the
`telemetry-service/` app on top of it. The good news is the data model already has the property that
makes the module boundary clean — telemetry references workspaces and repositories purely by
**string resource attributes** (`qits.workspace.id` / `qits.repository.id`), never by FK — so a
`telemetry/` module can depend on **neither `domain` nor any `auth/*` module**, exactly like
`artifacts`.

Related / dependent plans:

- **Directly helps**
  [artifacts-global-max-body-size-widens-public-ingest-dos](../../../issues/2026-07-19_artifacts-global-max-body-size-widens-public-ingest-dos.md):
  `quarkus.http.limits.max-body-size` is a **hard global ceiling on every route** of qits' shared
  HTTP server (currently `64M`), and `/api/otel/*` is named in that issue as one of the two public
  unauthenticated ingest endpoints the ceiling is supposed to keep wire-size-bounded (the other is
  `/api/capture`). Moving the OTLP receiver to its **own** HTTP server lets that server pick a
  body limit sized for telemetry batches while qits' `service` drives its ceiling back down toward
  the 10 MB posture the issue wants — the same coupling the artifacts split severs, from the
  other public endpoint. The two splits are complementary: together they leave `service` hosting
  **no** large-body public ingest at all.
- **Delivery seam being re-pointed** — [observability](../features/2026-07-04_observability.md)'s
  env-var half: `domain/command/control/OtelEnvironment` composes
  `OTEL_EXPORTER_OTLP_ENDPOINT=http://<QitsHostResolver.qitsHost()>:<qits-port>/api/otel`. After the
  split, daemons export to the **telemetry service's** host:port instead. This is a one-line change
  to the endpoint composition (a dedicated resolver/alias, below), not a change to *who* gets
  pointed — the daemon `otel` toggle stays the one switch.
- **Agent consumer being re-homed** — the
  [coding-agent harness](../../qits-coding-agents/features/2026-07-01_coding-agent-harness.md): the
  five telemetry MCP tools currently **ride the existing `repository` MCP server** (scoped by
  `X-QITS-Workspace` + repository narrowing, gated by `TelemetryToolFilter`), and `AgentLaunchService`
  appends `&workspaceId=` to that server's URL and pre-approves them. The split forces a decision on
  where those tools live after the store moves out of `service` (see Open questions — the biggest
  wrinkle vs. artifacts, because *the agents are the primary consumer*).
- **UI consumer** — the Telemetry tab in
  [qits-workspace-detail](../../qits-workspace-detail/epic.md) renders the REST twins
  (`WorkspaceTelemetryController`). If telemetry moves to a different origin, the tab either calls it
  cross-origin (permissive CORS, like the parked artifacts diff UI) or qits proxies the read paths.
- **Networking** —
  [qits-net / devcontainer unification](../../qits-live-deployment/features/2026-07-07_qits-net-devcontainer-unification.md):
  the split adds a dedicated **`qits-telemetry`** alias on `qits-net` and its own compose/devcontainer
  service; workspace containers export to `http://qits-telemetry:<port>/api/otel` instead of the
  `qits` alias, nothing published to the host — exactly the git-host / artifacts-host pattern.
- **Deployment** — [deployment guide](../../../guides/deployment.md), `docker-compose.prod.yml`, the
  Dokploy overlay: a new telemetry service under the same self-contained-Dockerfile discipline
  (`docker/qits/Dockerfile` gains a telemetry-app stage). **No data volume needed** — the store is
  ephemeral by design (JVM restart = empty store), which is itself a payoff (below).
- **Auth** — [build-variant-auth](../../qits-authentication/features/2026-07-16_build-variant-auth.md):
  `/api/otel/*` is a `PublicPaths` entry today (public ingest, bypassing `QitsAuthPolicy`). A
  standalone telemetry server has **no `QitsAuthPolicy`** at all, so the `/api/otel/` `PublicPaths`
  entry in `auth-core` is removed once nothing hosts the receiver in `service`. The **read** surface
  (query twins) is currently open too; on its own server it stays open by default — revisit whether
  telemetry reads (which expose app internals: stack traces, log lines) deserve the static-token
  treatment artifacts writes get (Open questions).

## Motivation

Four things telemetry gets from its own process, roughly in order of how much they bite:

1. **Heap isolation.** The `TelemetryStore` holds up to `max-total-bytes` (64 MiB default) of spans,
   logs and metrics **in qits' own JVM heap**. A chatty daemon exporting a flood of telemetry
   therefore pressures qits' GC and working set directly — the store's two-tier eviction bounds the
   *bytes* but not the allocation churn on the ingest path. A separate process moves that entire
   buffer and its decode/eviction cost off qits' heap, so telemetry volume can never degrade the app
   that serves the UI and the git host.
2. **Ingest isolation.** OTLP export is high-frequency, bursty, protobuf-decoding traffic with a
   profile nothing like qits' small same-origin JSON API. Today both share one Quarkus HTTP server
   and one `max-body-size`; a burst of export batches competes with UI/API requests for the same
   event loop and worker pool. Its own server (and its own body limit, per the DoS issue above)
   severs that competition.
3. **Restart independence.** The store is ephemeral — a qits restart wipes all collected telemetry
   today, mid-investigation. With telemetry in its own process, qits can redeploy/restart without
   losing the buffer a daemon has been filling (and vice versa). Ephemerality stops being coupled to
   *qits'* lifecycle.
4. **Swap-out seam.** The observability feature names the **VictoriaMetrics trio** (first-party MCP
   servers) as "the escape hatch if in-memory ever stops being enough." A network boundary around the
   receiver + store + query API is precisely the seam that lets the store implementation vary —
   swapping the in-memory buffer for a real backend becomes a **deployment topology change, not a
   qits code change**. The split makes "telemetry is its own thing" true at the process boundary,
   which is where that swap has to happen.

## Sketch of the work

Two parts, sequenced.

**Part A — extract the `telemetry/` library module** (the prep artifacts already had):

- New `telemetry/` module (plain library jar, `eu.wohlben.qits.telemetry`), depending on **neither
  `domain` nor `auth/*`** — only `opentelemetry-proto` + its slim record dtos. Moves the
  framework-light core out of `service`: `control/{TelemetryDecoder,TelemetryStore,
  TelemetryQueryService,TelemetrySizeEstimator}`, `dto/*`, and a framework-free `error/` if any is
  needed. Keeping `opentelemetry-proto` in this module (as it is kept out of `domain` today) keeps it
  out of `cli`.
- `service` indexes it via `quarkus.index-dependency.telemetry.*` (as it does `artifacts`) and
  keeps hosting the boundary for now — so Part A is a pure, behavior-preserving reorg that leaves the
  in-process deployment identical. This de-risks Part B into a lift-and-wire.

**Part B — stand up `telemetry-service/`** (Quarkus app, `<packaging>quarkus</packaging>`) depending
on `telemetry` + `quarkus-rest-jackson` + `quarkus-vertx-http`:

- **Moves** the boundary out of `service`: `api/{OtelReceiverResource,WorkspaceTelemetryController}`
  and the `mcp/*` package (`TelemetryMcpTools`, `TelemetryToolFilter`, `WorkspaceScope`). Its
  `application.properties` sets a **large `max-body-size`** and its own `quarkus.http.port`.
- **`service` drops** the telemetry dependency's boundary, the `/api/otel/` `PublicPaths` entry, and
  can lower its own `max-body-size` toward 10 MB once artifacts' ingest is also gone.
- **`OtelEnvironment` re-points** to the telemetry host (a `qits-telemetry` alias / a resolver seam
  alongside `QitsHostResolver`). The daemon toggle and env-var shape are unchanged.
- **Compose/Dokploy**: a new `qits-telemetry` service; the guide documents it. No data volume.
- **Stays in `service` deliberately**: `ConfigResource` (`GET /api/config.json`) and `OtelForwarder`
  (the upstream tee) — these are about **qits observing *itself*** when qits runs as a managed daemon
  (relaying qits' own identity to qits' own SPA, forwarding qits' ingest to a parent). They are qits'
  frontend/identity concern, not the receiver/store pipeline, and should not migrate.

## Open questions

- **Where do the MCP tools live after the split?** The load-bearing question, because agents are the
  primary consumer. Two shapes:
  1. **Telemetry service hosts its own MCP server.** The standalone service owns its whole surface
     (ingest + query REST + agent MCP), and `AgentLaunchService` registers a **second** MCP server
     URL (the telemetry host, scoped by `workspaceId`) alongside the repository server. Cleanest
     deployment story; costs the agent one more MCP endpoint in its config and splits the
     workspace-scoped identity model across two servers.
  2. **`service` keeps the telemetry MCP tools as a thin remote client.** The tools stay on the
     existing `repository` MCP server but delegate to the telemetry service's query REST over HTTP
     instead of an in-JVM `TelemetryQueryService`. Preserves the agent surface exactly (one server,
     same tools, same `TelemetryToolFilter` gate); costs a network hop per tool call and leaves
     `service` depending on the telemetry service being up. Lean: start here (minimal agent-config
     churn), graduate to (1) if/when the telemetry service grows its own agent-facing story.
- **CORS / same-origin for the Telemetry tab.** With the query twins on a different origin than the
  qits SPA, the tab is cross-origin — permissive CORS on the read paths (mirroring the capture
  route's surgical precedent) or a qits-side read proxy. The reads are workspace-scoped app internals,
  not public immutable blobs, so this is a touch more sensitive than artifacts' `<img>` case.
- **Is the query surface still open?** Reads are open today (behind `QitsAuthPolicy`, but effectively
  ungated for the tab). On a standalone server with no policy, an open query surface exposes
  collected stack traces / log lines to anyone who can reach the port. On `qits-net` with nothing
  host-published that mirrors today's exposure; if the telemetry service is ever reachable more
  widely, the static-token pattern (as artifacts writes use) or the scoped-token direction
  (`docs/epics/qits-tokens/`, if pursued) applies to reads here.
- **One deployable or two by default?** Same tension as artifacts: a second (well, third) server is
  overhead for small self-hosted installs. Option: keep the boundary hostable in `service` behind a
  profile for combined dev mode, split only the prod topology. The heap-isolation payoff is the
  strongest argument for *always* splitting under real load; dev mode barely cares.
- **`_unscoped` bucket and multi-tenant reach.** Unchanged by the split, but a standalone receiver on
  a shared network is easier for stray exporters to hit — worth confirming the `_unscoped` quarantine
  still bounds junk the same way.

## Trigger

Not worth building until one of:

- the heap/GC pressure of the in-JVM store actually shows up against qits under a chatty daemon (the
  strongest, telemetry-specific trigger);
- the [shared `max-body-size` DoS issue](../../../issues/2026-07-19_artifacts-global-max-body-size-widens-public-ingest-dos.md)
  is driven to a real fix and `/api/otel/*` must leave `service`'s HTTP server to let the ceiling
  drop (best done alongside, or just after, the artifacts split for the same reason);
- the in-memory store hits its ceiling as a design and the VictoriaMetrics-trio swap becomes real —
  at which point the process boundary is a prerequisite, not an afterthought.
