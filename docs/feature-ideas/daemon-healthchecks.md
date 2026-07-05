# Daemon healthchecks: multiple probes per daemon, visible up/down status

## Introduction

A [daemon](../features/2026-07-04_daemons.md)'s lifecycle status today collapses everything about
"is it up?" into a **single boolean flip**: `STARTING → READY` when the one `readyPattern` regex
matches the output stream (or a grace period elapses), and process-liveness afterwards (`tmux
has-session`, the [tmux-backed-daemons](../features/2026-07-05_tmux-backed-daemons.md) poll). That
model has two gaps this idea closes:

1. **One daemon can stand up several network services.** The motivating case is the
   quarkus-angular fixture's dev server: `./mvnw quarkus:dev` with Quinoa spawns **two** servers —
   Quarkus on `:8080` and the Angular dev server on `:4200` — inside one process group, one tmux
   session, one `startScript`. A single `readyPattern` can say "Quarkus is listening" and be
   completely silent about Angular. If Angular's compile wedges or its dev server dies while
   Quarkus stays up, the daemon still reads **READY** and the app is half-broken with no signal.
2. **Process-alive ≠ serving-correctly.** `readyPattern` is a *one-shot* boot signal and
   `has-session` only proves the leader process exists. Neither is an *ongoing, positive* check
   that the thing actually answers requests right now. A hung event loop, a 500-ing endpoint, a
   port that stopped accepting connections — all invisible until a human opens the app.

> **Naming, to disambiguate:** these are **daemon** healthchecks — qits probing the dev servers a
> workspace runs. They are unrelated to [health-checks](../features/2026-05-01_health-checks.md),
> which adds SmallRye Kubernetes probes (`/q/health`) for the **qits service itself**. The fixture
> below reuses *its own* `/q/health` endpoint as a probe target — that's a convenient coincidence,
> not a coupling.

This feature adds **healthchecks** as a first-class, **repeated, list-valued** probe on a daemon:
each daemon carries an ordered list of named checks (HTTP / TCP / command), the supervisor runs
them on an interval inside the workspace container, and each check has its own **healthy /
unhealthy / unknown** state surfaced as an **easily visible row of status dots** next to the
daemon's lifecycle chip. "Is my dev server up?" becomes "Quarkus ●green, Angular ●red" at a glance
instead of a single conflated READY.

Related/dependent plans:

- **Hard dependency on [daemons](../features/2026-07-04_daemons.md).** Healthchecks are a new
  ordered `@Embeddable` list on `RepositoryDaemon` — exactly the shape of the existing `observers`
  (`LogObserver`) and `sources` (`LogSource`) lists — and the supervisor drives them from the same
  per-instance runtime state and `DaemonEventService` feed. They are **orthogonal to the observer
  mechanism**: observers watch the *log stream* for errors (a symptom read off text); healthchecks
  actively *probe the running service* (a cause read off the network). Both can flag trouble; they
  are complementary, not a replacement.
- **Runs through the container seam** ([workspace containers](../features/2026-07-04_workspace-containers.md)).
  Probes execute *inside* the workspace container via `ContainerRuntime.execArgv(...)` (`docker
  exec`) so `127.0.0.1:<port>` means the daemon's own loopback — the address the app reaches
  itself on — with **no port publishing required** and no host/WSL2 network reachability caveats
  (see [WSL2 git-host unreachable](../../CLAUDE.md) / the webview picker's Docker-Desktop notes).
- **Generalises the webview picker's `httpPort`**
  ([daemon-webview-picker](../features/2026-07-05_daemon-webview-picker.md)). That feature added a
  single nullable `httpPort` to declare "this daemon is web-viewable through the proxy." A
  healthcheck is a richer, plural version of the same "the daemon serves HTTP here" fact — the two
  ports of the mvn+quinoa case are precisely why one `httpPort` isn't enough. A natural
  convergence (Open questions): the web-view button could light up per-port off healthchecks.
- **Fixes the auto-recovery gap in `DEGRADED`.** `daemons.md` notes DEGRADED "does *not*
  auto-recover — reset only by restart or stop (simplest defensible rule; revisit with real
  usage)." Healthchecks give a principled, **auto-recovering** DEGRADED: a previously-healthy check
  going unhealthy while the process is alive → DEGRADED; the check recovering → back to READY. This
  idea is where that revisit happens.
- **Orthogonal to [observability](../features/2026-07-04_observability.md).** OTEL exports the
  app's *own* self-reported telemetry; a healthcheck is qits' *external* black-box probe. Neither
  requires the other; both are "qits obtaining a view into a running app."
- **Deferred hook for [feature-flows](../features/2026-05-01_feature-flows.md).** "Gate this phase
  on the dev server being healthy" was a deferred item in `daemons.md`; a healthcheck is the
  concrete predicate that gate would read.

## The problem, concretely

The [servable quarkus-angular fixture](../features/2026-07-05_servable-quarkus-angular-fixture.md)
seeded by `seed-webapp` runs its dev server as one daemon. Today:

```
Daemon "quarkus:dev"   status: READY        ← readyPattern matched "Listening on ...:8080"
```

What's actually true behind that single chip:

```
  Quarkus  :8080  → 200  ✓   (readyPattern saw this)
  Angular  :4200  → ECONNREFUSED  ✗   (still compiling, or died — invisible)
```

The daemon is "READY" and the app doesn't load. There is no place in qits that distinguishes these
two services, because the daemon abstraction has exactly one readiness bit.

## The model: a list of healthchecks on the daemon definition

A new `@Embeddable HealthCheck` (mirroring `LogObserver`/`LogSource`), collected on
`RepositoryDaemon` as an ordered `healthChecks` list, cascade-persisted the same way:

```java
@ElementCollection(fetch = FetchType.EAGER)
@CollectionTable(name = "repository_daemon_healthcheck",
    joinColumns = @JoinColumn(name = "repository_daemon_id"))
@OrderColumn(name = "healthcheck_index")
public List<HealthCheck> healthChecks = new ArrayList<>();
```

Each `HealthCheck` (validated at definition time by extending `DaemonDefinitionValidator`, the same
place the ready pattern and stop signal are checked so a broken check fails the *request*, not the
prober thread):

| Field | Meaning |
|---|---|
| `name` | Human label shown on the dot, e.g. `Quarkus`, `Angular`. Unique within the daemon. |
| `kind` | `HTTP` \| `TCP` \| `COMMAND` (new enum `HealthCheckKind`). |
| `port` | Container-loopback port for `HTTP`/`TCP` (e.g. `8080`, `4200`). |
| `path` | HTTP path, default `/` (`HTTP` only), e.g. `/q/health`. |
| `expectStatus` | Acceptable HTTP status(es), default `2xx`/`3xx` (`HTTP` only). |
| `command` | Script run in the container; exit 0 = healthy (`COMMAND` only — the escape hatch). |
| `intervalMs` | Poll cadence; falls back to `qits.daemons.health-poll-ms`. |
| `timeoutMs` | Per-probe timeout before it counts as a failure. |
| `healthyThreshold` / `unhealthyThreshold` | Consecutive results before flipping state (debounce flapping); defaults `1` / `3`. |
| `gatesReady` | If true, the daemon does not reach READY until this check is healthy (see below). |
| `initialDelayMs` | Grace before the first probe, so boot-time refusals aren't counted (defaults to the daemon's ready grace). |

**Probe kinds, deliberately ordered by dependency weight:**

- **`TCP`** — dependency-free. `docker exec` a bash one-liner using the `/dev/tcp/127.0.0.1/<port>`
  builtin; connect succeeds = healthy. Proves the port accepts connections. Works on the base
  image with zero extra tooling.
- **`HTTP`** — `curl -fsS -o /dev/null -m <timeout> -w '%{http_code}' http://127.0.0.1:<port><path>`,
  match against `expectStatus`. Richer (status + reachability), but needs `curl` (or `wget`) in the
  image — see Open questions on the `qits/workspace` image. Falls back to TCP semantics if the tool
  is absent (logged once).
- **`COMMAND`** — arbitrary script in the container, exit code is the verdict. Covers everything
  the built-ins don't: `pg_isready`, a `grpc_health_probe`, a bespoke `curl | jq` assertion.

## Execution: an in-container prober driven by the supervisor

A new `HealthProbeService` (`domain.daemon.control`) owned by the `DaemonSupervisor`, reusing the
supervisor's existing `ScheduledExecutorService` and per-`Instance` runtime state:

- When an instance enters `STARTING`, the supervisor schedules each check on its interval (after
  `initialDelayMs`). Each tick builds the probe command and runs it through
  `ContainerRuntime.execArgv(container, false, "/workspace", env)` + the runtime's exec — the same
  `docker exec` seam workspace-local git verbs already use. **No port publishing**, because the
  probe runs in the container's own network namespace where `127.0.0.1:<port>` is the live service.
- Each check keeps a small runtime state: `HEALTHY` / `UNHEALTHY` / `UNKNOWN` (pre-first-result or
  probe error), last result timestamp, last latency, consecutive-count for threshold debouncing.
- On stop/crash the checks are cancelled with the instance; on `adoptIfRunning` (post-restart
  re-adoption) they are rescheduled — health state is runtime-only, exactly like `DaemonStatus`.
- Config keys follow the `qits.daemons.*` family: `qits.daemons.health-poll-ms` (default e.g.
  `5000`), a global `health-timeout-ms`, and a kill-switch `qits.daemons.health-enabled`.

### How healthchecks relate to `DaemonStatus`

Healthchecks are **per-check** and orthogonal to the daemon's single lifecycle status, but the
supervisor **aggregates** them into two lifecycle effects (both opt-in via check flags so existing
daemons are unchanged):

- **Readiness gating (`gatesReady`).** If any check sets `gatesReady`, the daemon reaches `READY`
  only once **all** ready-gating checks are healthy — replacing/augmenting the single
  `readyPattern` for multi-service daemons. The mvn+quinoa daemon declares two HTTP checks, both
  `gatesReady=true`, and only turns READY when *both* Quarkus and Angular answer. This is the
  direct fix for the motivating problem: readiness stops being a lie.
- **Auto-recovering DEGRADED.** While the process is alive and READY, a non-gating (or gating)
  check going `UNHEALTHY` moves the daemon `READY → DEGRADED` (emitting a `DEGRADED` event with the
  failing check's name/evidence); the check recovering moves it back `DEGRADED → READY`. This is
  the auto-recovery `daemons.md` deferred — driven by an objective probe rather than a log finding,
  so it's safe to auto-clear.

Both remain **advisory**: healthchecks never *kill* or *restart* a daemon on their own in iteration
one (restart-on-unhealthy is deferred — see below). They report; the restart policy still keys off
process exit only.

### Events and agent notification (reuse, no new plumbing)

Health transitions publish `DaemonEventDto`s through the existing `DaemonEventService` — a new
`DaemonEventKind.HEALTH_CHANGED` (alongside the current lifecycle/finding kinds), severity mapped
like the rest (unhealthy → WARNING/ERROR, recovered → INFO). That means health changes ride the
**same** paths daemon events already do for free: the UI events feed, durable `daemon_event` rows
([daemon-log-observation-expansion](../features/2026-07-04_daemon-log-observation-expansion.md)),
and — for above-INFO severity — the `DaemonAgentNotifier` injection into the workspace's running
chat ("`[daemon:quarkus:dev]` Angular healthcheck went unhealthy: connection refused on :4200").
The agent learns its dev server is half-down without any new wiring.

## DTO / REST / MCP surface

- **DTO.** `DaemonInstanceDto` gains a `List<HealthCheckStatusDto> health` — `{name, kind,
  state, lastLatencyMs, lastChangedAt, detail}` — one entry per declared check with its live state.
  `RepositoryDaemonDto` gains the `List<HealthCheckDto>` definition list (mapped by
  `RepositoryDaemonMapper`, MapStruct — never hand-written).
- **REST.** No new endpoints: the definition list rides `RepositoryDaemonController`'s existing
  CRUD (new nested-record input `HealthCheckInput`, sibling of `LogObserverInput`/`LogSourceInput`),
  and live health rides the existing `WorkspaceDaemonController` GET that already returns
  `DaemonInstanceDto`. Regenerate `docs/openapi.yml` (the export test) + `pnpm generate:api`.
- **MCP.** `DaemonMcpTools` `createDaemon`/`updateDaemon` gain a structured `healthChecks` argument
  (like the existing `observers`/`sources`); `listWorkspaceDaemons` returns live health so the
  agent can read "is my dev server healthy?" as a tool call. `RepositoryMcpToolsTest`'s tool-surface
  pin updates.

## UI: the visible part

The whole point is *glanceable*. In `WorkspaceDaemonsComponent` (`pattern/daemon/workspace-daemons`),
under each daemon's `DaemonStatusChipComponent`, render a **health row**: one small dot per check
(green `HEALTHY` / red `UNHEALTHY` / grey `UNKNOWN`, matching the chip's existing Tailwind palette),
each labelled with the check `name`, with the latency/detail in a tooltip and the failing evidence
on click. A new presentational `DaemonHealthChecksComponent` (`ui/components/daemon/`, sibling of
`daemon-status-chip.component.ts`), pure `input()`s, OnPush — fed by the `health` array the workspace
poll already fetches (3s/5s), so no new query.

```
● quarkus:dev  READY      Quarkus ●   Angular ●        ← both green: genuinely up
● quarkus:dev  DEGRADED   Quarkus ●   Angular ●        ← Quarkus green, Angular red at a glance
```

The daemon **management form** (`repository-daemon-create-update-form.component.ts` /
`ui/forms/daemon/daemon-form.component.ts`) gains a repeatable health-check editor next to the
existing observer/source editors: name, kind dropdown, port/path/command by kind, thresholds,
`gatesReady` toggle. The `repository-daemon-card.component.ts` summary shows the check count.

## Seed / fixture

`seed-webapp`'s quarkus-angular daemon becomes the reference example — two HTTP checks,
`gatesReady=true` on both:

- `Quarkus` → `HTTP :8080 /q/health` (the fixture is Quarkus 3; `smallrye-health` is already the
  qits convention, see [health-checks](../features/2026-05-01_health-checks.md)).
- `Angular` → `HTTP :4200 /` expecting `200`.

So the seeded demo *shows* the feature: start the daemon, watch Angular sit red (compiling) while
Quarkus goes green, then both green → READY. `seed` (the tiny testing-repo Python daemon) gets one
`TCP :8000` check to exercise the dependency-free path.

## Explicitly deferred

- **Restart/kill on unhealthy.** Iteration one is report-only; healthchecks don't feed the restart
  policy. A `restartOnUnhealthy` action policy (with its own threshold/backoff, distinct from the
  process-exit policy) is the obvious follow-up once real usage shows whether a hung-but-alive
  process is common enough to auto-recycle.
- **Feature-flow phase gate** on "all daemons healthy" — the concrete predicate for the deferred
  `daemons.md` feature-flow integration.
- **Per-port web-view.** Converging `httpPort` and healthchecks so the webview picker offers one
  frame per healthy HTTP check (Quarkus vs Angular), instead of a single `httpPort`.
- **Human push/desktop notifications** on health flips (the UI feed + agent injection cover
  iteration one), pending the general daemon push-notification item.
- **Dependency (log-pattern) healthchecks** — "unhealthy if this log line appears" overlaps the
  existing observers; keep the two mechanisms separate for now.
- **History / uptime %** — health state is live-only; a durable timeline (SLO-style "up 97% this
  session") builds on the `daemon_event` rows but isn't iteration one.

## Open questions

- **`curl` in `qits/workspace`.** The `HTTP` kind needs `curl`/`wget` in the fat default image
  (`docker/workspace`). Confirm it's present; if not, either add it (small, high value) or make
  `HTTP` degrade to a `/dev/tcp` connect + note the loss of status matching. `TCP`/`COMMAND` have no
  such dependency.
- **In-container exec vs host-side HTTP via the proxy's channel.** The webview proxy
  (`DaemonProxyRoute`) *already* does exactly a host-side HTTP round-trip to the daemon — a Vert.x
  `HttpClient` to `127.0.0.1:<hostPort>` off `ContainerRuntime.hostPort` — so reusing that channel
  for `HTTP` checks is tempting: zero image tooling, no `docker exec` per probe. But it only works
  for **published** ports (docker can't add ports to a live container, so a check on a not-declared
  port needs a container recreate — the webview picker's known limitation), and only for HTTP.
  Recommendation: **in-container `docker exec`** as the primary channel — it decouples check ports
  from the create-time publish set (add a check without recreating the container), covers `TCP` and
  `COMMAND` too, and probes the app's own loopback. Keep the proxy's host-side Vert.x client as an
  optional fast path for checks whose port is already published (the `httpPort` case), if the extra
  `docker exec` per tick ever measures as too costly.
- **`gatesReady` vs `readyPattern` coexistence.** When a daemon has *both* a `readyPattern` and
  `gatesReady` checks — READY on both, or checks win? Lean: if any check gates, checks are
  authoritative and the pattern is ignored for readiness (still usable as an observer signal);
  document it rather than silently AND-ing two different mechanisms.
- **Probe cost / cadence.** A `docker exec` per check per interval is cheap but non-zero; default
  `5s` and let per-check `intervalMs` tune. Cap concurrent probes to avoid a many-daemon workspace
  hammering `docker exec`.
- **Threshold defaults.** `unhealthyThreshold=3` debounces a single transient refusal; validate
  against real dev-server boot flapping (Angular's first compile can take >10s — hence
  `initialDelayMs`).

## Testing sketch

- **`HealthProbeServiceTest`** (domain, `FakeContainerRuntime`): a check flips HEALTHY→UNHEALTHY
  after `unhealthyThreshold` consecutive failures and back after `healthyThreshold`; UNKNOWN before
  the first result; `initialDelayMs` suppresses boot-time failures; probe command is built
  correctly per kind (HTTP path/status, TCP connect, COMMAND exit code). `FakeContainerRuntime`'s
  exec is scripted to return healthy/unhealthy on demand.
- **`DaemonSupervisorTest` additions:** two `gatesReady` checks hold the daemon in STARTING until
  both healthy, then READY; a check going unhealthy while alive → DEGRADED event with the check
  name, recovery → READY (the auto-recover path); checks cancelled on stop, rescheduled on
  `adoptIfRunning`.
- **`DaemonEvent` / notifier:** a health flip publishes a `HEALTH_CHANGED` event, persists a
  `daemon_event` row, and (above INFO) lands as a `[daemon:…]` chat injection.
- **Controller/MCP:** CRUD round-trip incl. `healthChecks` with validation (bad port/regex/kind →
  400, duplicate check name → 400, cross-repo ownership); `DaemonMcpToolsTest` define→list health;
  `RepositoryMcpToolsTest` surface pin; `OpenApiSchemaExportTest` regenerates `openapi.yml`.
- **Frontend:** `daemon-health-checks.component.spec.ts` renders green/red/grey dots + tooltips;
  `workspace-daemons.component.spec.ts` shows the health row under the status chip; the form editor
  adds/removes checks.
- **Manual (packaged app, docker):** `seed-webapp`, start the quarkus:dev daemon → Angular dot red
  while compiling, Quarkus dot green, both green → READY; `kill` the Angular process inside the
  container → Angular dot red, daemon DEGRADED, agent chat gets the notification; Angular back →
  green, daemon READY.
```