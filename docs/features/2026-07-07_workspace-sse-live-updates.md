# Workspace SSE live updates: replace the detail route's polling with a push channel

## Status: implemented (2026-07-07)

Shipped as designed below, with these decisions locked in:

- **One `telemetry` topic** (not split per-signal): a single hint invalidates all four telemetry
  views, keeping one debounce state per workspace. The per-signal split in *Open questions* stays a
  future optimization — the ≤1/s debounce already bounds the fan-out.
- **Pure push, no safety-net poll**: all eight `refetchInterval`s are removed; the on-reconnect
  invalidate-all covers any missed hint. Idle workspace = zero requests.
- **CDI async event bus**: `WorkspaceChangeHint` + `WorkspaceChangePublisher`
  (`domain.workspace.control`, `fireAsync`) → `@ObservesAsync` in `WorkspaceEventBroadcaster`
  (`service`, `domain.workspace.api`) → per-workspace `BroadcastProcessor` → SSE at
  `GET /api/repositories/{repoId}/workspaces/{workspaceId}/events` (`WorkspaceEventsController`,
  hidden from OpenAPI). Debounce is leading-edge + trailing, `qits.events.debounce-ms` (default
  1000). Wire frame is the hyphenated topic name (`daemons`, `daemon-events`, `telemetry`,
  `commands`); a 25s `ping` heartbeat keeps idle connections alive.
- **Producers wired at the existing choke-points**: `DaemonSupervisor.transition()` → `DAEMONS`
  (the single `instance.status` assignment site — resolves the "funnel through one setStatus"
  open question), `DaemonEventService.publish()` → `DAEMON_EVENTS`, `CommandLifecycleService`
  create/finish → `COMMANDS`, `TelemetryStore.add{Spans,Logs,Metrics}` → `TELEMETRY` (deduped per
  batch; unscoped telemetry fires nothing).
- **Frontend**: `WorkspaceLiveService` (`pattern/workspace/`) provided on the detail page, opens one
  `EventSource`, maps each topic to `queryClient.invalidateQueries(...)`, invalidates everything on
  `open`/reconnect, and closes on `DestroyRef`.

Remaining open question deferred as noted: splitting the telemetry topic per-signal. Backpressure
resolved to `onOverflow().drop()`; `fireAsync` needs no context (the observer only touches in-memory
maps).

## Introduction

The workspace detail route (`/repositories/:repoId/workspaces/:workspaceId`,
`workspace-detail.page.ts`) keeps itself fresh today by **polling**: eight TanStack queries with
`refetchInterval`s of 3–5s re-fetch daemon status, daemon events, four telemetry views, and the
global command list — roughly **90 requests/minute per open tab**, almost all of which return
unchanged data. This idea replaces that with **one Server-Sent-Events channel per workspace** that
pushes lightweight *invalidation hints*; the frontend maps each hint to a TanStack Query
invalidation, so data still flows through the exact same REST endpoints, DTOs, and query keys —
polling becomes fetch-on-signal.

**Deliberately SSE, not WebSockets.** Everything the polls watch is strictly server→client; nothing
on this route needs to send data upstream over the live channel. The three existing WebSockets
([stream-json chat](../features/2026-07-01_stream-json-chat.md)'s `ChatCommandSocket`, and the two
terminal sockets) genuinely carry client input (user turns, keystrokes) and **stay WebSockets,
untouched**. For the one-way case SSE is the lighter tool: plain HTTP (works through the Quinoa/
Angular dev proxies), built-in auto-reconnect in `EventSource`, and native Quarkus REST support
(`@Produces(SERVER_SENT_EVENTS)` + `Multi<…>`) — no new extension needed.

Related/dependent plans:

- **[daemons](../features/2026-07-04_daemons.md) / [daemon-log-observation-expansion](../features/2026-07-04_daemon-log-observation-expansion.md)**
  — the two biggest poll consumers. `DaemonSupervisor` flips in-memory instance status;
  `DaemonEventService.publish()` persists event rows ("the DB is the feed"). Both get a one-line
  hint-fire added at their existing mutation points; the DB stays the feed — hints only say
  *"re-read it now"*.
- **[observability](../features/2026-07-04_observability.md) / [spa-observability](../features/2026-07-06_spa-observability.md)**
  — telemetry ingest (`OtelReceiverResource` → `TelemetryStore` ring buffers) is the highest-churn
  hint source; with the SPA flushing OTLP every 1s, hints **must be debounced** server-side or push
  would be busier than the 5s poll it replaces (see Coalescing).
- **[workspace-observation-tabs](../features/2026-07-06_workspace-observation-tabs.md)** — the tabs
  (Files / Events / Telemetry) are where most polled data renders; nothing about the tab layout
  changes, the queries behind it just stop free-running.
- **[stream-json-chat](../features/2026-07-01_stream-json-chat.md) /
  [command-registry](../features/2026-06-30_command-registry.md)** — the chat *content* already
  streams over WebSocket; what polls is the **discovery** query (`['commands']` @5s in
  `workspace-chat.component.ts`) that finds the newest running chat session to attach to. A
  command-lifecycle hint replaces that poll.
- **[daemon-healthchecks](daemon-healthchecks.md)** (idea) — plans to ride "the workspace poll
  (3s/5s)" for its health dots. If this lands first, healthcheck state flips become another hint
  topic and the dots go live-on-change instead.
- **[mutiny-reactive-programming](../features/2026-05-01_mutiny-reactive-programming.md)** — the
  `eu.wohlben.qits.mutiny` package is demo-only today; this feature is the first real production
  use of Mutiny streaming in `service`.

## Current polling inventory (what gets replaced)

All polling on the route is TanStack `refetchInterval` (no `setInterval`/rxjs timers anywhere):

| Component | Query key | Endpoint | Interval |
|---|---|---|---|
| `workspace-daemons.component.ts` + `daemon-webview.component.ts` (shared key) | `['workspace-daemons', repoId, workspaceId]` | `GET …/workspaces/{id}/daemons` | 3s |
| `workspace-daemon-events.component.ts` | `['workspace-daemon-events', …]` | `GET /api/daemon-events?…` | 5s |
| `workspace-telemetry.component.ts` (×4: errors, spans, metrics, logs) | `['telemetry-errors'\|'telemetry-spans'\|'telemetry-metrics'\|'telemetry-logs', …]` | `GET …/telemetry/*` | 5s |
| `workspace-chat.component.ts` | `['commands']` | `GET /api/commands` | 5s |

Not polled (and unaffected): the page's own `workspacesQuery`, the file browser, the trace-detail
query, `telemetry-log-tail` (presentational). `commands-list.component.ts` @5s is on the
`/commands` route, not this one — but it can trivially adopt the same hint (see Deferred).

## Design

### The hint model: invalidate, don't stream data

The SSE channel carries **no payloads** — each event is just a topic name:

```
event: daemons          ← something about this workspace's daemon instances changed
event: daemon-events    ← a new daemon event row was persisted
event: telemetry        ← the workspace's telemetry buffer got new data
event: commands         ← a command's lifecycle changed (started/exited/terminated)
```

The frontend reacts to a hint by `queryClient.invalidateQueries({queryKey: […]})` for the mapped
key(s); TanStack refetches through the **unchanged** REST endpoints. Why this shape and not
streaming the DTOs themselves:

- **Zero DTO/mapper churn.** The REST reads, their DTOs, and every query key keep working exactly
  as today — including the deliberately-shared `['workspace-daemons']` key between the daemons list
  and the webview button (components sharing a key must return identical shapes; hints sidestep
  that whole class of bug because the *fetch* stays singular).
- **Self-healing.** A missed hint (reconnect gap, dropped frame) degrades to "slightly stale until
  the next hint", and the reconnect handler invalidates everything once — no replay protocol,
  no `Last-Event-ID` bookkeeping, no server-side event history.
- **Cheap on the wire and in the JVM.** One `ConcurrentHashMap<workspaceKey, BroadcastProcessor>`
  and a few bytes per change beat re-serializing telemetry pages every 5s for every open tab.

### Backend: a hint bus in `domain`, the SSE boundary in `service`

`domain` is web-framework-free, so the notification seam is **CDI events** (plain
`jakarta.enterprise.event.Event`, already on `domain`'s classpath — no new dependency):

- New `domain.workspace`-adjacent record, e.g.
  `WorkspaceChangeHint(String repoId, String workspaceId, Topic topic)` with
  `enum Topic { DAEMONS, DAEMON_EVENTS, TELEMETRY, COMMANDS }`, plus a tiny
  `WorkspaceChangePublisher` (`@ApplicationScoped`, `control/`) wrapping `Event<WorkspaceChangeHint>.fireAsync()`
  so producers stay one-liners and firing never blocks or fails the mutating transaction.
- **Producers** (each an injected publisher + one call at the existing mutation point):
  - `DaemonSupervisor` — wherever `Instance.status` flips (start, ready, exit/crash callbacks,
    restart) and on instance create/remove → `DAEMONS`.
  - `DaemonEventService.publish()` — after the row is persisted → `DAEMON_EVENTS`. (Observer
    findings also flip daemon status via the supervisor, which fires `DAEMONS` on its own.)
  - `TelemetryStore` — on buffer append → `TELEMETRY` (debounced, below).
  - `CommandRegistry` — on command start/exit/termination → `COMMANDS`.
- **Boundary** (`service`, new `eu.wohlben.qits.domain.workspace.api.WorkspaceEventsController` or
  a sibling under the existing area layout):

  ```java
  @GET
  @Path("/repositories/{repoId}/workspaces/{workspaceId}/events")
  @Produces(MediaType.SERVER_SENT_EVENTS)
  public Multi<String> events(...) { … }
  ```

  backed by a per-workspace `BroadcastProcessor<Topic>` registry; a CDI
  `@ObservesAsync WorkspaceChangeHint` observer routes hints into the right processor.
  `COMMANDS` hints carry a workspace where known and broadcast to all channels otherwise (the
  `['commands']` query is global anyway). Processors are created on first subscriber and dropped on
  last cancellation.
- **Heartbeat:** merge in a ~25s `Multi.createFrom().ticks()` comment/ping frame so idle
  connections survive proxies and dead ones are detected. `EventSource` reconnects automatically.

### Coalescing (the telemetry problem)

The SPA-observability fixture flushes browser OTLP **every 1s**; naive per-append hints would make
push chattier than the 5s poll it replaces. Debounce **server-side, per (workspace, topic)**: after
emitting a hint, suppress further hints for that pair for a window (default ~1s, config
`qits.events.debounce-ms`), emitting one trailing hint if changes arrived during the window. Result:
a busy workspace converges to ≤1 refetch/s per topic (still 5× fresher than today), and an idle
workspace produces **zero** traffic — the actual win over polling.

### Frontend: one small service, delete eight `refetchInterval`s

A new `WorkspaceLiveService` (Angular, `pattern/workspace/` or `ui/`):

- Opens `new EventSource(`/api/repositories/${repoId}/workspaces/${workspaceId}/events`)` while the
  detail route is active (page-level `inject` + `DestroyRef` teardown).
- Maps topics → invalidations:
  `daemons → ['workspace-daemons', repoId, workspaceId]`;
  `daemon-events → ['workspace-daemon-events', …]`;
  `telemetry → ['telemetry-errors'|'telemetry-spans'|'telemetry-metrics'|'telemetry-logs', …]`;
  `commands → ['commands']`.
- On `open` (including every reconnect): invalidate **all** mapped keys once — this closes any gap
  from the disconnected window and makes the reconnect story trivially correct.
- The eight `refetchInterval`s are **removed**, and the queries keep
  `refetchOnWindowFocus`/`staleTime` defaults. Optionally keep a long safety-net interval (60s)
  during a shake-out period; lean **no** — the on-reconnect invalidation already covers the failure
  mode, and a lingering poll hides push bugs instead of surfacing them.

Browser connection budget: one `EventSource` per open workspace tab. Fine on HTTP/2 (dev mode and
packaged Quarkus both speak it); on HTTP/1.1 the 6-connections-per-origin cap only bites with many
tabs of the *same* origin open — acceptable for a prototype, noted as a caveat.

### Dev-mode proxies (this box's known traps)

Two proxy hops can sit between `EventSource` and Quarkus, both must not buffer:

- Browsing `:4200` directly: the Angular dev server's `proxy.conf.json` forwards `/api` →
  `:8080` (http-proxy-middleware streams responses by default, but **verify** — a buffered proxy
  turns SSE into "nothing arrives until close", which looks exactly like a silent failure). Same
  file already needed a `/daemon` forward for the webview; `/api` is already covered.
- Browsing `:8080` (Quinoa): `/api` is excluded from the SPA proxying entirely, so SSE hits Quarkus
  directly — no issue.

Verify both entry points explicitly in the manual test (see Testing).

## Explicitly deferred

- **Streaming payloads** (e.g. pushing new daemon events or log lines in the SSE body). The hint
  model is deliberately payload-free; revisit per-topic only if refetch-on-hint measurably lags
  (candidate: telemetry log tail, which the [daemon-log-observation-expansion] work already reads
  incrementally).
- **The `/commands` route** — `commands-list.component.ts` @5s can adopt the `commands` topic via a
  global (non-workspace) SSE channel or by reusing any open workspace channel; small follow-up,
  kept out to keep this scoped to the detail route.
- **Repository-detail route** (branch list / divergence polling, if/when it polls) — same bus, new
  topics; nothing in the design is workspace-specific except the channel path.
- **Multi-instance / CLI writers.** Hints are in-process (CDI events + in-memory processors). The
  `cli` writing to the shared H2 (seeding) while `service` runs will not produce hints — the
  affected lists refresh on the next navigation/focus/reconnect. Acceptable for a single-instance
  prototype; a DB-polling change-detector or listen/notify (Postgres) is the eventual answer if
  this ever multi-instances.
- **Auth/tenancy on the channel** — same posture as every other unauthenticated `/api` endpoint
  today; SSE adds nothing new (`SameOriginUpgradeCheck` has no SSE equivalent needed since SSE is
  same-origin `fetch` semantics under CORS defaults).

## Open questions

- **Hint granularity for telemetry.** One `telemetry` topic invalidates four queries (errors,
  spans, metrics, logs) per hint. Splitting per-signal (`telemetry-logs`, `telemetry-spans`, …)
  quarters the refetch fan-out on busy workspaces at the cost of four debounce states; lean
  **split**, since `TelemetryStore` knows which buffer it appended to anyway.
- **`DaemonSupervisor` fire points.** Status mutation is spread across start/exit/adopt/restart
  paths; worth funneling through a single `setStatus(instance, status)` helper first so the hint
  fires from exactly one place (small refactor, also improves the code independent of this
  feature).
- **Does `fireAsync` need context?** CDI async observers run on a different thread — the observer
  only touches the in-memory processor map, so no request/transaction context is needed; confirm
  no Arc context-propagation surprises under `quarkus-smallrye-context-propagation`.
- **Backpressure strategy** on the `BroadcastProcessor` — hints are tiny and coalesced, so
  `onOverflow().drop()` is safe (a dropped hint is recovered by the next one or by reconnect).

## Testing sketch

- **Backend (`service`)**: a test that opens the SSE endpoint (Vert.x/REST-assured streaming
  client), fires a `WorkspaceChangeHint` via CDI, and asserts the frame arrives with the right
  event name; debounce test (N rapid hints → ≤2 frames: leading + trailing); per-workspace routing
  (hint for workspace A does not reach B's channel); heartbeat frame appears within the interval;
  processor cleanup after last unsubscribe.
- **Producers (`domain`)**: extend `DaemonSupervisorTest` / `DaemonEventServiceTest` /
  `TelemetryStore` tests with an in-test `@Observes` collector asserting each mutation path fires
  the right topic exactly once.
- **Frontend**: `workspace-live.service.spec.ts` — a fake `EventSource` emitting topics asserts the
  right `invalidateQueries` calls, and `open` invalidates everything; component specs updated to
  assert `refetchInterval` is gone.
- **Manual (`/verify` with seed-webapp)**: open the workspace route on both `:8080` and `:4200`,
  start the daemon → status chip flips without waiting a poll tick; interact with the fixture SPA →
  telemetry tab updates ~1s later; kill the SSE connection (devtools offline toggle) and restore →
  everything re-syncs on reconnect. Watch the network panel: idle workspace = zero requests.
