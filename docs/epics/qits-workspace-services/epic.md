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
> `/services` — removing the collision the earlier note tolerated. The Part-5-doomed
> `RepositoryDaemon*` config store keeps its "daemon" name until that store is deleted; the
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
| [daemons](features/2026-07-04_daemons.md) | implemented |
| [daemon-log-observation-expansion](features/2026-07-04_daemon-log-observation-expansion.md) | implemented |
| [tmux-backed-daemons](features/2026-07-05_tmux-backed-daemons.md) | implemented |
| [daemon-healthchecks](features/2026-07-10_daemon-healthchecks.md) | implemented |
| [daemon-webview-configuration](features/2026-07-06_daemon-webview-configuration.md) | implemented |
| [daemon-autostart-on-workspace-start](features/2026-07-09_daemon-autostart-on-workspace-start.md) | implemented |
| [daemon-settling-on-workspace-stop](features/2026-07-09_daemon-settling-on-workspace-stop.md) | implemented |
