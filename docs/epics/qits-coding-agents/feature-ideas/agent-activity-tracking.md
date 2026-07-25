# Agent activity tracking: the daemon hears Claude Code's hooks and the host learns when an agent is cooking

## Introduction

An interactive agent session is a black box to qits. Once `AgentLaunchService.launchInteractive`
spawns `exec claude …` inside the workspace container as a `TERMINAL` command, the only thing qits
knows about it is that a `RUNNING` command exists — the binary running/not-running signal that drives
the Agents-tab indicator dot (`workspace-detail.page.ts` `agentsIndicator()` → `running-chat.ts`
`newestRunningInteractiveAgent`). Whether Claude is *right now* generating a response, sitting idle
waiting for the next prompt, or blocked on a permission prompt is invisible. Chat-mode sessions do a
little better — `ClaudeCodeAgent.chat()` sets `--include-hook-events` and the stream carries a `Stop`
line — but nothing parses it into an activity state, and the interactive TUI (the session shape most
worth observing) emits nothing to qits at all.

Claude Code already exposes the exact lifecycle signals we want as **hooks**: `UserPromptSubmit`
fires the instant a prompt is submitted (Claude starts working), `Stop` fires when it finishes the
turn, and `Notification` fires when it's blocked waiting on the user. qits even has a working
precedent for consuming a Claude hook: `ClaudeCodeAgent.sessionReportSettings()` injects a
`--settings '{…}'` layer whose `SessionStart` hook `curl`-POSTs the hook's stdin JSON to
`POST /api/commands/{id}/agent-session`, which `CommandService.reportAgentSession` uses to confirm
session lineage. That path proves the mechanism; it just reports identity, once, and it `curl`s the
qits-host directly (baking host address/port into the settings JSON).

This idea generalizes that precedent into a first-class **agent activity** signal, and in doing so
**folds the existing session hook into the same route**. qits injects a single set of hooks
(`SessionStart`/`UserPromptSubmit`/`Stop`/`Notification`/`SessionEnd`) that POST to a **new local
webhook the workspace-daemon exposes inside the container**; the daemon maps each hook to an activity
state and relays it to the host over its existing dial-home WebSocket; the host caches it in the live
`WorkspaceDaemonRegistry` and nudges the UI over SSE. A new item on the Agents tab configures the
tracking and shows the live "cooking / idle / waiting" state. Routing through the daemon (rather than
a direct host `curl`) means the hook command is host-agnostic — it targets `localhost` — and rides
the daemon's already-authenticated, multiplexed channel, exactly like git-status monitoring does.

Crucially, this **removes the current second hook**: the direct-to-host `SessionStart` `curl` and the
`POST /api/commands/{id}/agent-session` endpoint it targets go away. Session-identity reporting keeps
working unchanged where it matters — the same consumer, `CommandService.reportAgentSession`, still
persists the session-lineage row to the DB — but it is now driven from the daemon→host WS message
instead of a separate direct `curl`. One hook path, one route, into two sinks on the host (the in-mem
activity cache and the existing DB lineage write).

Related / dependent plans:

- **Hard dependency — the transport pattern this copies wholesale**: [daemon git-status monitoring](../../qits-workspace-daemon/features/2026-07-24_daemon-git-status-monitoring.md) established the shape — the daemon detects in-container state, sends an *unsolicited* status event over the control socket, `WorkspaceDaemonRegistry` caches it in an in-mem map behind a framework-free SPI, and fires a `WorkspaceChangeHint` topic to the UI on a flip. Agent activity is the same pipeline with a different signal source (Claude hooks instead of `inotifywait`). Also depends on the daemon control plane itself ([workspace-daemon epic](../../qits-workspace-daemon/epic.md)) — this feature adds the **first inbound HTTP listener** the daemon has ever had (it is otherwise a pure WS client).
- **Extends and retires — the existing Claude hook precedent**: [container agent sessions](../features/2026-07-04_container-agent-sessions.md) and the coding-agent harness ([harness](../features/2026-07-01_coding-agent-harness.md)) already inject a `SessionStart` hook via `--settings` that `curl`s the host directly. This feature **subsumes** it: `SessionStart` becomes one of the daemon-routed activity hooks, the direct `curl` + `POST /api/commands/{id}/agent-session` endpoint are removed, and `CommandService.reportAgentSession` (the DB session-lineage consumer) is re-fed from the WS message.
- **Consumer surface — the Agents tab**: [embedded workspace agent session](../../qits-workspace-detail/features/2026-07-10_embedded-workspace-agent-session.md) owns the tab's three stacked sections and the indicator-dot rules; the new activity config/status item is a fourth section there.
- **Config store**: rides the generic instance key/value store from [qits-settings](../../qits-settings/epic.md) for the enable/disable toggle (`SettingController` / `SettingsService`), the same store `agent.default-type` uses.
- **Relates — run tracking**: [MCP task-prompt delivery](mcp-task-prompt-delivery.md) records that a prompt was *launched* (`WorkspacePromptDraft.last_run_at`); activity tracking is the natural complement — whether that launched agent is *currently working*.
- **Deliberately does NOT touch** [qits-observability](../../qits-observability/epic.md) — that epic is the OTLP telemetry pipeline (spans/logs/metrics), not agent-lifecycle status. Activity is a control-plane signal, not telemetry.

## Design

### Daemon: a local hook webhook listener

Add a small HTTP listener to the workspace-daemon, bound to **loopback inside the container only**
(`127.0.0.1:<port>`, `qits.workspace-daemon.hooks.port`, or better a unix-domain socket at a fixed
path — see Open questions). Implemented as a raw **Vert.x `HttpServer`** (the daemon already uses
Vert.x for its `WebSocketClient`; no servlet stack, consistent with the git host staying off servlets).

- Route: `POST /hooks/claude-code` — body is the hook's stdin JSON verbatim
  (`hook_event_name`, `session_id`, `transcript_path`, `cwd`, …). Respond `200` immediately and
  cheaply; the hook must never add latency to a turn.
- The daemon maps `hook_event_name` → an `AgentActivityState` (table below), stamps it with its own
  identity (the daemon *is* one workspace), and relays it over the existing `ControlSocket.send` as a
  new outbound message. Unknown/uninteresting events are dropped, not relayed.
- Like every other daemon signal, activity buffers in `pendingOutbound` when the socket is down and
  the daemon re-reports the current state on reconnect (`ControlSocket.onConnected`), so a restarted
  host rebuilds the projection.

### Hook injection: which hooks, and where they're configured

qits injects the activity hooks the same way it injects the session hook today — a single
`--settings '{…}'` layer rendered by `ClaudeCodeAgent` at launch (generalize
`sessionReportSettings()` into an `activityHookSettings()` covering all the events below), so every
qits-launched session reports without touching the user's own config. The hook command is a plain
`curl` to the daemon's loopback endpoint — no host address, port, or token in the JSON.

Because the host must still tie a hook to the right agent command (that's what the current direct
hook's `/commands/{commandId}/` URL does), qits renders the **`commandId` it already knows at launch**
into the hook `curl` (query param or added body field); the daemon forwards it opaquely. So the
posted payload the daemon relays is the hook's stdin JSON (`hook_event_name`, `session_id`,
`transcript_path`, `source`) **plus** the qits-injected `commandId`.

| Hook event | Activity state | Meaning | Also drives |
|---|---|---|---|
| `SessionStart` | `IDLE` (session begins) | session established / identity known | **`reportAgentSession` DB lineage write** (replaces today's direct hook) |
| `UserPromptSubmit` | `BUSY` | prompt submitted — Claude started cooking | |
| `Stop` | `IDLE` | turn finished, yielded control back | |
| `Notification` | `WAITING` | blocked on the user (permission / idle input) | |
| `SessionEnd` | `ENDED` | session over | |
| `SubagentStop` | *(ignored for main state)* | subagent finished; main agent still busy | |

`Stop` also fires when Claude pauses to ask the user something, so `WAITING` from a subsequent
`Notification` should win over the preceding `IDLE` — the daemon resolves this with last-event-wins
plus the `Notification` override, and the host stores whatever the daemon sends.

Because qits-launched sessions get the hooks via `--settings`, the toggle primarily controls
*whether qits injects them*. Optionally the same config can be written into the shared claude-home
`settings.json` (`qits.workspace.claude-mount`, default `/claude-home`) so that **manual** in-container
`claude` runs also report activity — a follow-up, noted as an open question.

### Protocol + host registry: sync into the in-mem workspace state

- **Protocol** (`workspace-daemon-protocol`): a new `AgentActivity` message —
  `{ commandId, sessionId, state, hookEvent, source, transcriptPath, at }` — with its `Type`/`Field`
  tags in `DaemonProtocol` and a `DaemonMessageCodec` case. Bump `CAPABILITY_VERSION`. It carries the
  session-identity fields (`sessionId`, `source`, `transcriptPath`) precisely so the DB lineage write
  can be driven from it, not just the activity chip.
- **Host** (`WorkspaceDaemonRegistry.onMessage`): handle `AgentActivity` into **two sinks**:
  1. *In-mem activity cache* — store in a new map `agentActivity: ConcurrentHashMap<String, AgentActivityState>`
     keyed by `commandId` (cleared on `unregister`, re-populated on reconnect — identical lifecycle to
     `gitClean`), with a per-workspace "any RUNNING agent BUSY" rollup for the indicator. On a state
     flip, fire `WorkspaceChangePublisher.fire(repoId, workspaceId, Topic.AGENT_ACTIVITY)` (new topic)
     so the Angular live service invalidates the relevant queries.
  2. *DB session lineage* — on `SessionStart`, call the **existing** `CommandService.reportAgentSession(commandId, …)`
     with a `ReportAgentSessionRequest` rebuilt from the message fields. This is the behaviour-preserving
     half: the same method still writes the same lineage row; it's just invoked from the registry now
     instead of a REST controller. (The registry consumes it through a small framework-free seam so
     `domain` stays web-free, consistent with the other SPIs.)
- **Removal**: delete the direct hook plumbing — the `SessionStart` `curl` branch in `ClaudeCodeAgent`
  (folded into `activityHookSettings()`), `AgentLaunchService.sessionReportUrl()`, and the now-unused
  `POST /api/commands/{id}/agent-session` endpoint on `CommandController` (plus its `ReportAgentSessionRequest`
  wiring on the controller side). Keep `CommandService.reportAgentSession` and the DTO shape — that's
  the consumer that must keep working. The frontend `reportAgentSessionRequest.ts` model becomes dead
  once the endpoint is gone.
- **SPI**: a new framework-free `WorkspaceAgentActivity` interface in
  `domain/…/repository/control` (sibling of `WorkspaceGitStatus`), implemented by the registry and
  consumed as `Instance<>` — RUNNING-gated — in `WorkspaceService`/the agent-session read path, so the
  state reaches the `WorkspaceDto`/agent-session DTO. This is the "sync back to the in-mem workspace
  state in the host" the feature is named for.

### Frontend: a new Agents-tab item

Add a `WorkspaceAgentActivityComponent` under `pattern/workspace/` and stack it into the Agents tab
`<div class="flex flex-col gap-6">` in `workspace-detail.page.ts` (follow the existing
`<section aria-label> + <h2>` shape of the sibling sections). It:

- **Shows** the live activity state (a "cooking… / idle / waiting on you / ended" chip) from the new
  SPI, refreshed over SSE via `workspace-live.service.ts`.
- **Configures** the tracking: a signal-form toggle (enable/disable activity hooks) persisted through
  the generic settings store (`SettingControllerService`, key e.g. `agent.activity-tracking.enabled`),
  mirroring `SettingsComponent`'s existing "Default coding agent" field.

Refine `agentsIndicator()` so the tab dot reflects `BUSY` (`primary`/pulsing) vs merely
present-but-idle, upgrading today's binary running/not-running dot into a real busy signal.

## Open questions

- **TCP loopback vs unix socket**: a unix-domain socket at a fixed in-container path
  (`curl --unix-socket …`) needs no port allocation and is inherently loopback-only; a
  `127.0.0.1:<port>` is simpler to `curl` and more portable. Lean unix socket.
- **Command correlation transport**: render `commandId` as a query param on the hook `curl` vs. an
  added JSON body field. Query param is simpler to inject and keeps the daemon a dumb forwarder; lean
  query param.
- **Instance-level vs per-workspace config**: start instance-level (one settings key) for parity with
  `agent.default-type`; per-workspace override is a later refinement if wanted.
- **Manual `claude` runs**: writing hooks into claude-home `settings.json` would cover sessions qits
  didn't launch, but muddies "qits-managed" vs "user" config on the shared volume. Deferred.

## Non-goals

- **Not** OTLP/telemetry — activity is a coarse control-plane state, not spans/metrics; qits-observability is untouched.
- **Not** parsing transcript content or tool-by-tool activity — only turn-boundary lifecycle. `PreToolUse`/`PostToolUse` granularity is out of scope.
- **Not** a new persisted column — activity is ephemeral live state in the in-mem registry, exactly like `gitClean`; it is never written to H2.
- **Not** changing how agents are launched or executed (`AgentLaunchService`, `docker exec`) beyond adding the `--settings` hook layer.

## Testing sketch

- **Daemon** (`workspace-daemon` unit test): POST each hook JSON to the webhook route, assert the
  mapped `AgentActivity` frame is enqueued/sent; assert buffering when the socket is down and
  re-report on reconnect.
- **Protocol/codec**: round-trip `AgentActivity` through `DaemonMessageCodec`; capability-version bump asserted.
- **Host registry** (`service` test): feed `AgentActivity` messages into `WorkspaceDaemonRegistry.onMessage`,
  assert the in-mem map updates, the SPI reflects it, `unregister` clears it, and a state flip fires
  the `AGENT_ACTIVITY` change hint. Non-RUNNING workspaces report null.
- **Session lineage preserved over the new route** (`service`/`domain` test): a `SessionStart`
  `AgentActivity` still results in a `CommandService.reportAgentSession` DB write producing the same
  lineage row the old direct hook did — the regression guard for the removal. Assert the
  `POST /api/commands/{id}/agent-session` endpoint is gone (and the harness no longer renders the
  direct `curl` — assert on the rendered `--settings`).
- **Frontend**: component test for the activity chip states and the enable/disable toggle persisting
  through the settings store; indicator-dot busy vs idle.
- **Manual (`/verify`, seed-webapp)**: launch an interactive agent in the greeting workspace, submit a
  prompt, watch the Agents-tab chip go BUSY on submit and back to IDLE at turn end; trigger a
  permission prompt and see WAITING.
