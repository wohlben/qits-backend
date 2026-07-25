# Epic: qits-workspace-services — managed long-running processes

## Introduction

The **daemon domain**: an action runs to completion, a **daemon** is the sibling that is
*supposed to keep running* (dev server, compile watcher, watch-mode test runner). Its result is
not an exit code but a **status over time**. This epic owns daemon definitions, the supervised
runtime, log observation, and the daemon↔workspace lifecycle coupling.

> **Renamed from `qits-workspace-daemons`** to avoid collision with the singular
> [qits-workspace-daemon](../qits-workspace-daemon/epic.md) — the in-container `workspace-daemon`
> control-plane binary (PID 1), a different concept. **As of the daemon-supervised-dev-daemons work
> ([qits-workspace-daemon](../qits-workspace-daemon/epic.md) Part 4, 2026-07-24) the code domain was
> renamed too**: the runtime-supervision packages moved `eu.wohlben.qits.domain.daemon.*` →
> `eu.wohlben.qits.domain.service.*` (`ServiceSupervisor`, `ServiceProxyRoute`, `ServiceStatus`,
> `ServiceEvent*`), `qits.daemons.*` → `qits.services.*`, and the REST/UI surface became
> `/services` — removing the collision the earlier note tolerated. The `RepositoryDaemon*` config
> store was then **deleted in Part 5** (2026-07-24,
> [config-as-single-source-of-truth](../qits-workspace-daemon/features/2026-07-24_config-as-single-source-of-truth.md)):
> service definitions now live only in `.qits-config.yml`, read in-container per workspace. The
> `.qits-config.yml` `daemons:` key rename is a tracked follow-up (it needs the fixture repos'
> two-level submodule round-trip).

**Builds on [qits-workspaces](../qits-workspaces/epic.md)**:
a daemon runs inside a workspace container, and its lifecycle is coupled to the workspace's
(auto-start on workspace start, settle on workspace stop). Retroactive umbrella epic; future
daemon work lands here.

Related epics / cross-cutting concerns:

- **Runs on the command substrate** — a running daemon *is* a `CommandSession` in
  [qits-workspace-commands](../qits-workspace-commands/epic.md); the tmux-backed reshaping
  decouples daemon lifetime from the qits JVM.
- **The web-view surface is split** — the daemon **web-view picker** (the proxy + iframe + DOM
  picker) is a frontend tab in
  [qits-workspace-detail](../qits-workspace-detail/epic.md); this epic owns
  daemon **web-view configuration** (the definition knobs: target + entry path).
- **Feeds** [qits-observability](../qits-observability/epic.md): a daemon's `otel` toggle
  injects `OTEL_EXPORTER_OTLP_*` at launch — delivery lives here, the endpoint there.

## Parts (implemented)

### The daemon runtime & observation

- **[daemons](features/2026-07-04_daemons.md)** (07-04) — the foundation: declarative daemon
  definitions, a supervised runtime, and **log observers** (per-line regex / severity
  classification) that turn output into durable status.
- **[daemon-log-observation-expansion](features/2026-07-04_daemon-log-observation-expansion.md)**
  (07-04) — observe more than merged PTY output: file-appender sources, split logs, durable
  events, correlation.
- **[tmux-backed-daemons](features/2026-07-05_tmux-backed-daemons.md)** (07-05) — reshape how a
  daemon *runs* so its lifetime and logs are decoupled from the qits JVM (survive a restart).
- **[daemon-healthchecks](features/2026-07-10_daemon-healthchecks.md)** (07-10) — multiple
  probes per daemon, replacing the single ready-boolean with visible up/down status.

### Web-view configuration

- **[daemon-webview-configuration](features/2026-07-06_daemon-webview-configuration.md)**
  (07-06) — an explicit, overrideable web-view target + entry path on the daemon definition
  (the picker UI itself is a qits-workspace-detail tab).

### Workspace lifecycle coupling

- **[daemon-autostart-on-workspace-start](features/2026-07-09_daemon-autostart-on-workspace-start.md)**
  (07-09) — starting a workspace starts its daemons.
- **[daemon-settling-on-workspace-stop](features/2026-07-09_daemon-settling-on-workspace-stop.md)**
  (07-09) — stopping a workspace settles its daemons (a deliberate container stop is not a
  crash).

## Done when

Rolling: current when its `feature-ideas/` is empty and every daemon feature since this epic's
creation has landed here.

## Status

| Part | Status |
|---|---|
| [daemons](features/2026-07-04_daemons.md) | implemented (log-observation part **removed** 2026-07-24) |
| [daemon-log-observation-expansion](features/2026-07-04_daemon-log-observation-expansion.md) | **removed** 2026-07-24 |
| [tmux-backed-daemons](features/2026-07-05_tmux-backed-daemons.md) | implemented (host path **retired** 2026-07-25 — see below) |
| [daemon-healthchecks](features/2026-07-10_daemon-healthchecks.md) | implemented (host **probing removed** 2026-07-25; health is the daemon's to report — pending) |
| [daemon-webview-configuration](features/2026-07-06_daemon-webview-configuration.md) | implemented |
| [daemon-autostart-on-workspace-start](features/2026-07-09_daemon-autostart-on-workspace-start.md) | implemented (host is now a projection) |
| [daemon-settling-on-workspace-stop](features/2026-07-09_daemon-settling-on-workspace-stop.md) | implemented (host is now a projection) |

> **Log observation / `DEGRADED` removed (2026-07-24).** The per-line log **observers** (PATTERN /
> LOG_LEVEL → `ERROR_DETECTED` events), FILE **log sources**, and the `DEGRADED` service status were
> removed: they were anchored to the host tmux follower's command audit-log line sequence, which the
> in-container [workspace-daemon supervision](../qits-workspace-daemon/features/2026-07-24_daemon-supervised-dev-daemons.md)
> (Part 4) bypasses — so rather than re-home them onto the socket they were dropped. A service now
> reports only STARTING/READY/RESTARTING/CRASHED/STOPPED plus its **health-check** status;
> `readyPattern`, health checks, and crash-excerpt evidence to the agent stay.

> **Host `ServiceSupervisor` collapsed to a pure projection (2026-07-25).** The tmux/host-exec
> supervision half — the launcher, host liveness poll, second restart policy with backoff, the
> `/proc`-marker straggler reaper, boot re-adoption, and the scheduler — was **deleted**; the host now
> only *projects* the in-container daemon's `DaemonEvent`s (state machine, process segments, web-view
> proxy origin) and issues manual start/stop over the socket. This retires the tmux fallback the
> [Part 4 handover](../qits-workspace-daemon/features/2026-07-24_daemon-supervised-dev-daemons.md) had
> kept, ending the double-supervision hazard (a socket blip could put host and daemon in a port
> fight). Host-side **health probing** (`HealthProbeService`) went with it — health is now the
> daemon's to report (reads UNKNOWN until the daemon does; the recovery loop is
> [wedged-service](../../issues/2026-07-25_wedged-workspace-service-not-recovered.md) prong 1). See
> [docs/issues/resolved/2026-07-25_host-side-service-supervision-should-move-to-daemon.md](../../issues/resolved/2026-07-25_host-side-service-supervision-should-move-to-daemon.md).
