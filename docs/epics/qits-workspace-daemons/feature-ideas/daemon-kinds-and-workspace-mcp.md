# Daemon kinds (deployment by default, devserver optional) & workspace-scoped daemon MCP

## Introduction

Daemons today are framework-agnostic in code — a verbatim foreground script supervised in a tmux
session — but every shipped example, seed, and default assumes a **dev server** (`quarkus:dev`,
`ng serve`). That assumption is the root of the concept's worst behavior:

- **Memory.** The heavy residents of a workspace container are exactly the dev servers: the
  `quarkus:dev` launcher plus its forked JVM, `ng serve`/vite with their watch graphs. Workspaces
  have repeatedly struggled with memory pressure there.
- **A whole bug class is dev-mode-specific.** The forked JVM that escapes the process group,
  survives stops and wedges the port
  ([daemon stop orphans forked Quarkus JVM](../../../issues/resolved/2026-07-05_daemon-stop-orphans-forked-quarkus-jvm.md),
  hence the `QITS_DAEMON_ID` `/proc/*/environ` straggler reap), and the DEGRADED false positives
  from noisy dev-server output
  ([OTEL WARNING escalation](../../../issues/resolved/2026-07-05_degraded-false-positive-on-quarkus-dev-output.md),
  [webview boot race](../../../issues/2026-07-09_webview-boot-race-flips-daemon-degraded.md))
  all exist because a dev server is a forking, chattering, file-watching process.
- **Agents don't need what a dev server buys.** Hot reload / HMR is for a human iterating in a
  browser. A workspace whose primary worker is a coding agent is better served by a **built,
  locally deployed process**: build once, run the artifact.

The reimagining: a daemon gets a **kind**. `DEPLOYMENT` (build, then run the artifact) becomes the
default; `DEVSERVER` (watch-mode dev server) stays fully supported as an explicit, opt-in kind —
it is *fundamentally the same* long-running process, it just also watches the filesystem and
rebuilds, and that is exactly the part we don't need by default. Both kinds share the entire
existing execution model (tmux session, follower, observers, webview proxy, healthchecks, OTEL);
the kind drives **defaults and lifecycle sugar**, not a second implementation.

To make daemons operable by the agent that lives inside the workspace, the daemon MCP surface
moves **from admin-shaped tools to workspace-scoped tools**: the workspace identity is system-set
(from the MCP connection's scope), never an agent-supplied argument — only the `daemonId` is (a
workspace may run more than one daemon). The old admin-shaped `DaemonMcpTools` (repoId/workspaceId
as tool arguments, unused in practice) were **removed as the first step of this work**.

Related/dependent plans:

- **The daemon foundation this reshapes** — [daemons](../features/2026-07-04_daemons.md),
  [tmux-backed daemons](../features/2026-07-05_tmux-backed-daemons.md) (the execution model both
  kinds keep), [daemon web-view configuration](../features/2026-07-06_daemon-webview-configuration.md),
  [autostart on workspace start](../features/2026-07-09_daemon-autostart-on-workspace-start.md),
  [healthchecks](../features/2026-07-10_daemon-healthchecks.md).
- **Where the build lives** —
  [workspace bootstrap commands](../../qits-workspaces/features/2026-07-18_workspace-bootstrap-commands.md):
  the ordered one-shot steps that already run before daemon autostart are where a `DEPLOYMENT`
  daemon's build step goes.
- **The MCP scoping precedent** — [observability](../../qits-observability/features/2026-07-04_observability.md)
  (`telemetry*` tools) and
  [MCP task-prompt delivery](../../qits-coding-agents/feature-ideas/mcp-task-prompt-delivery.md)
  (`taskPrompt`): `WorkspaceScope` stamped into the MCP URL by `AgentLaunchService.derivedMcpUrl`,
  fail-closed `ToolFilter` hiding workspace-bound tools from broader sessions.
- **Framework presets** ride [framework detection](../../qits-workspaces/) and the
  [managed-app convention](../../qits-integration-quarkus/features/2026-07-18_qits-dogfooding-managed-app-convention.md).
- **Web view without HMR** — the proxy's base-path assumption
  ([daemon-proxy cross-origin mode](../../../backlog-ideas/daemon-proxy-cross-origin-mode.md))
  is unaffected; a built bundle served single-origin (Quinoa-style) or statically already fits.

## Design

### Daemon kinds

`RepositoryDaemon` gains a `kind` (`DEVSERVER` | `DEPLOYMENT`; migration with `DEVSERVER` as the
backfill so existing definitions behave as today). The kind is persisted metadata + defaults, not
a behavioral fork — the supervisor's execution path stays verbatim-script for both:

- **`DEPLOYMENT` (default)** — runs a built artifact: `java -jar target/quarkus-app/quarkus-run.jar`,
  a static serve of `ng build` output, a compiled binary. Defaults: `autoStart: true` (cheap,
  fast readiness — a fast-jar is up in about a second), no boot-race observer grace, restart on
  failure stays cheap (no rebuild on restart).
- **`DEVSERVER` (opt-in)** — today's shape: `quarkus:dev`, `ng serve`, watch-mode anything.
  Defaults: `autoStart: false` (heavy — start it when you actually iterate), the existing
  readiness grace and straggler reaping stay kind-scoped behavior where they aren't already
  generic.

`autoStart` remains a per-daemon setting (the column exists, V26) — the kind only changes its
**default** and how prominently creation UI presents it ("a devserver does not autostart unless
you say so" is the configuration the kinds must allow).

**Creation presets** from framework detection: for a Quarkus repo, offer `DEPLOYMENT`
(build `./mvnw package -DskipTests`, run `java -jar …/quarkus-run.jar`) and `DEVSERVER`
(`./mvnw quarkus:dev`); for Angular, `ng build` + static serve vs `ng serve`. Presets fill the
form; the stored definition stays a plain script.

**JVM vs native for `DEPLOYMENT`.** Native compilation is Quarkus's preferred deployment mode and
the better fit for this feature's motivation: ~50–100 MB RSS instead of several hundred,
millisecond startup (readiness detection becomes trivial), and the build cost is paid once per
workspace materialization, not per restart. Its price: minutes-long builds, several GB of
RAM/CPU during `native-image`, and the builder image (`-Dnative
-Dquarkus.native.container-build=true`) in the workspace. The JVM fast-jar builds in tens of
seconds with no extra toolchain. So: `DEPLOYMENT` presets come in both flavors (e.g. "Quarkus
(native)" / "Quarkus (JVM)"), native recommended where the workspace image carries the builder
and build time is acceptable, JVM as the lightweight default. The kind is identical either way —
this is a preset choice, not a third kind.

### The build step lives in the bootstrap chain

A `DEPLOYMENT` daemon's artifact is produced by the **workspace bootstrap chain** (ordered
one-shot commands that already run before daemon autostart), not by the supervisor:

- Build runs **once per workspace materialization** — correct for an immutable artifact. A
  daemon restart (crash, manual stop/start) never rebuilds.
- **Iterating = rebuild & restart**: re-run the build step (a plain action/`runAction`), then
  restart the daemon. First-class sugar for this pair (a "Rebuild & restart" button, and an MCP
  equivalent) is part of this feature — but it is *orchestration of existing pieces*, not new
  supervisor machinery. (Rejected alternative: a supervisor-owned `buildScript` re-run before
  every relaunch — wasteful on crash-restarts, and it conflates a workspace-level build output
  with daemon lifecycle.)

### Workspace-scoped daemon MCP

The in-workspace agent manages its daemons through new tools on the `repository` server that take
**only a `daemonId`** (or nothing) — repo and workspace come from the session scope
(`WorkspaceScope`, stamped `?workspaceId=` by `AgentLaunchService`), exactly like the `telemetry*`
tools; a `ToolFilter` hides them from sessions without workspace scope:

- `listDaemons()` — the workspace's daemons with status, restart count, live healthcheck states.
- `daemonStatus(daemonId)` — the cheap "is it up?": status, uptime/last state change, healthchecks,
  last event.
- `startDaemon(daemonId)` / `stopDaemon(daemonId)`.
- `daemonLog(daemonId, tailLines?)` — reads the follower command's log (the daemon's process
  output) — the missing read path today.
- `daemonEvents(daemonId?, severity?, sinceMinutes?)` — the persisted `daemon_event` feed
  (`DaemonEventService.query` already exists; today only reachable via REST).
- Optionally `rebuildDaemon(daemonId)` — the rebuild-&-restart sugar above.

Read tools join the agent pre-approved allowlist in `AgentLaunchService`; start/stop/rebuild stay
approval-gated. With pull tools in place, `DaemonAgentNotifier`'s push stays as the **alert**
channel only (ERROR_DETECTED etc.), no longer the only way an agent ever sees daemon news.

**Removed already:** the admin-shaped `DaemonMcpTools` (definition CRUD + start/stop/status with
`repoId`/`workspaceId` tool arguments) — unused, and the wrong signature for the only consumer
that matters. Daemon *definition* management stays on REST/UI and `.qits-config.yml`; if external
MCP definition management is ever wanted, it returns as a deliberate design, not a leftover.

### Web view without a dev server

Unchanged mechanism, different payload: a `DEPLOYMENT` webview points at the built app (Quinoa
single-origin, or a static bundle serve) — `QITS_PUBLIC_BASE` base-path serving applies as today.
HMR websockets simply don't exist on that path; the proxy's websocket passthrough stays for
`DEVSERVER`. The DOM picker works the same (same-origin frame either way).

## Out of scope

- Removing `DEVSERVER` support or the tmux/follower/straggler machinery it needs.
- Supervisor-owned build steps (rejected, see above).
- Changes to daemon definitions' `.qits-config.yml` schema beyond the `kind` field.

## Testing

- Kind defaults: `DEPLOYMENT` autostarts, `DEVSERVER` doesn't; explicit `autoStart` wins over the
  kind default both ways.
- Workspace-scoped MCP: tools hidden without workspace scope; scope-enforced (a session cannot
  reach another workspace's daemons); `daemonLog`/`daemonEvents` return the same content as their
  REST counterparts; start/stop drive the supervisor.
- Rebuild & restart: build action re-run + restart picks up the new artifact.
- Migration: existing definitions backfill to `DEVSERVER` and behave byte-identically.
