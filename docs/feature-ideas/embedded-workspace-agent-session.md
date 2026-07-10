# Embedded agent session in the workspace Agents tab: auto-resume the last session

## Introduction

[agent-session-lineage](../features/2026-07-10_agent-session-lineage.md) made agent sessions
first-class: qits pins the session ID at launch, persists the lineage per command, and can resume
or fork any session — including the **interactive launch**, the full Claude Code TUI in xterm.js.
But reaching a session still takes a detour: launch from the chat/prompt panel, or find the old
command on the Commands page and hit Resume there. This idea gives the workspace's agent a
permanent home: the workspace detail route's **Agents tab embeds the interactive session
directly**. Selecting the tab resolves the workspace's agent state — a running interactive
session re-attaches, a previous session **auto-resumes** (the workspace's *last* session), and a
workspace with no session history gets a **fresh session created**. The tab *is* the agent; the
conversation continues where it left off, every time.

Related/dependent plans:

- **Hard dependency on [agent-session-lineage](../features/2026-07-10_agent-session-lineage.md)**
  (landed): the interactive launch mode, `resumeSessionId` on the launch endpoint, and
  `CommandDto.agentSessions` are exactly the surface the embed consumes. The embed itself needs
  **no backend changes**; the session history list (below) adds one read endpoint plus a
  sweep-time aggregation.
- **Extends the [workspace detail tab row](../features/2026-07-09_workspace-detail-tab-regrouping.md)**:
  the Agents tab (today only the [LSP plugins list](../features/2026-07-07_agent-lsp-plugins.md))
  gains the session as its primary section; Plugins stays below it.
- **Reuses the [tmux-backed](../features/2026-07-05_tmux-backed-daemons.md) terminal plumbing**:
  `WebTerminalComponent` attach-by-`commandId` (re-attach replays scrollback, detach keeps the
  process running) is unchanged.
- **Coexists with [workspace chat](../features/2026-07-04_workspace-chat-dialog.md)**: chat keeps
  its tab and its stream; the embedded terminal defers while a chat is live (below).
- **Freshness rides [workspace SSE live updates](../features/2026-07-07_workspace-sse-live-updates.md)**:
  the `commands` topic already invalidates the `['commands']` query this tab derives everything
  from — no polling.

## Behavior

### Resolution on tab activation

The session is expensive to materialize (container provisioning, a spawned `claude` process), so
nothing launches on page load. Like the Web view's iframe, the tab latches on **first selection**
(`onTabChange`), then resolves, in order:

1. **A running interactive agent command in this workspace** (kind `TERMINAL`, status `RUNNING`,
   non-empty `agentSessions`, matching `workspaceId`) → **attach** the embedded terminal to it,
   wherever it was started from (this tab earlier, the Commands page, another browser tab).
   Re-attach replays scrollback; switching away only hides the panel — the tab group keeps hidden
   tabs mounted, so the socket and the process survive tab switches, same contract as chat.
   The attach target is a **live computed** (newest running wins, mirroring `newestRunningChat`'s
   rule), not a one-shot decision: when several are running — e.g. two browser tabs launched
   near-simultaneously — every view converges on the **last-initiated** run at the next SSE
   invalidation. Only the *launch* side effect (steps 3–4) is gated by the one-shot activation
   latch.
2. **A running chat command in this workspace** → **defer**: show a "this workspace's
   conversation is live in the Chat tab" state (with a jump link) instead of launching. Its
   session is actively being driven; a concurrent `--resume` of a live session is exactly the
   collision the lineage feature avoids by pinning create-only IDs.
3. **Previous sessions exist** — any finished command of this workspace with a non-empty
   `agentSessions` list → **resume the last session**: the newest such command (by `launchedAt`),
   its list's *last* entry (the command's current session, per the lineage contract). Launch via
   the existing endpoint: `POST /api/repositories/{repoId}/workspaces/{workspaceId}/agents` with
   `{ scope: REPOSITORY, mode: INTERACTIVE, resumeSessionId }`. Chat sessions count — resuming
   the last *chat* conversation in the terminal is deliberate continuity (resume-in-place appends
   to the same JSONL; the mode is a launch property, not a session property).
4. **No session history** → **create one**: same launch, no `resumeSessionId` (a fresh `PINNED`
   session).

All inputs come from the `['commands']` query the page already shares (SSE-invalidated); the
just-launched command bridges the invalidation gap with the same `launchedCommandId` signal
pattern as `WorkspaceChatComponent`.

### Sign-in flow, embedded

When the shared credential volume has no login, the launch returns the sign-in REPL (kind
`TERMINAL`, **no** `agentSessions`) instead of an agent run. It's a PTY like any other, so the
embedded terminal hosts it in place — better than chat's redirect-to-command-page. When it exits,
resolution re-runs and the next launch proceeds signed in.

### Session end and relaunch

When the embedded run exits (operator `/exit`, Terminate, or a crash), the tab does **not**
auto-relaunch (a crashing agent would loop). It shows a session-ended state with:

- **Resume** — re-runs resolution, which now finds the just-ended session as the last one and
  continues it;
- a link to the finished command's page for the imported transcript (the readable conversation).

A **Terminate** button mirrors the chat tab's while the run is live.

### Session history: the workspace's sessions as a tree

Below the embedded terminal (above Plugins), the tab lists **every session ever associated with
this workspace**, so the lineage the data model records finally has a face. Kept deliberately
minimal — each row is `$date · $sessionId · $numOfMessages` — and shaped as a **tree**:

- **One node per session**, not per command: `RESUMED` refs continue an existing node (its date
  is the session's first `recordedAt`; its message count the latest import). Roots are `PINNED`
  sessions, newest first.
- **Forks nest**: a `FORKED` ref becomes a child of its `forkedFromSessionId` node. Fork nodes
  are real sessions — same normal (card) background as roots — and the **branching is
  color-coded**: each fork lineage gets a stable accent color (deterministic palette index from
  the session id) on its tree connector/left border, so sibling branches are tellable apart at a
  glance. `SWITCHED` refs with no fork edge list as roots.
- **Sub-sessions nest under their session with a grayed-out background**: the subagent
  sidechains the coding agent spawned automatically (`agentId`, labeled `agentType:
  description`), visually secondary to the sessions an operator drove. Their row shows the
  sidechain's first-line date and its message count.
- A row navigates to the newest command that drove that session (its transcript view); the
  current session's row is highlighted.

**Data**: the fork tree is fully reconstructable today (`command_agent_session` via the
workspace's commands), but `numOfMessages` and the sub-session list exist only *inside* the
imported transcript CLOBs (`qits_agent_meta` + sidechain lines on the `TRANSCRIPT` channel) — no
queryable structure. Rather than re-parsing CLOBs at read time, the **transcript sweep aggregates
as it imports** (it already streams every line): a new `agent_session_stat` table (a schema
migration; no backfill — prototype phase, no data to migrate) holding per-session message counts
and per-sidechain rows (`agentId`, `agentType`, `description`, `messageCount`, first timestamp),
delete-and-reinsert alongside the channel sweep, so it stays idempotent and recomputable.
`numOfMessages` counts **`user` + `assistant` turns** — the operator's notion of conversation
length — not tool results, progress, or meta lines. A new read endpoint serves the assembled tree:
`GET /api/repositories/{repoId}/workspaces/{workspaceId}/agent-sessions` (nodes with `sessionId`,
`firstRecordedAt`, `forkedFromSessionId`, `messageCount`, `subagents[]`, `newestCommandId`).
Freshness rides the SSE `commands` hint (imports happen on command exit, which already fires it).
A **running** session's counts are absent until its post-exit sweep — the row shows the session
with a "live" placeholder count; the terminal above *is* its view meanwhile.

### Tab surface

- The Agents tab stacks three sections — the embedded session, the session history tree, the
  existing Plugins list — the Daemons tab's controls+events layout, applied here. The tab label
  stays `Agents` (it is the reorder-persistence key in `qits.workspace-detail.tab-order`).
- The tab gets a running-session **indicator dot** (`primary`) when an interactive agent command
  is running here, like the Chat/Actions dots.
- **Actions-tab indicator**: `actionsIndicator` today counts every `RUNNING` `TERMINAL` command,
  so one running embedded agent would light **two dots** (Agents + Actions). The Actions tab's
  run history does list agent runs, so "a command is running" would be literally true there — but
  the indicator already deliberately excludes running *chats* on the each-dot-points-at-its-owner
  rule ("action-launched runs, not chats (the Chat dot) or daemons (the Daemons dot)"). Excluding
  commands with a non-empty `agentSessions` list extends that same rule to the new owner tab. The
  run-history *list* keeps showing agent runs (everything-visible convention); only the dot moves.

## Open questions

- **Double-launch race.** Two browser tabs activating simultaneously both see "no running
  command" and auto-launch. Concurrent sessions per se are a supported flow, and the reactive
  attach (step 1) makes all views unify on the last-initiated run at the next SSE invalidation.
  Two residues remain: the older process keeps running **headless** (attached nowhere, but alive
  in the container and terminable from the Commands page); and when both launches *resumed the
  same session id*, two `--resume` processes append the same transcript JSONL while holding
  diverging in-memory conversations — that session's transcript becomes an interleaving of two
  parallel threads. Iteration one accepts both; a backend "one live driver per session" guard at
  `pinSession` (reject `RESUMED` when a running command's session list already ends in that id)
  is the follow-up if the second residue bites.
- **Auto-resume vs. explicit resume.** Resolution auto-resumes silently; if a stale session's
  context proves confusing in practice, the ended-state could grow a "Fresh session" (fork/new)
  alternative next to Resume. Not in iteration one.
- **Scope picker.** The embed hardcodes `REPOSITORY` scope (the Commands-page Resume does the
  same). If a workspace wants the actions/project scopes here, the chat launch panel's scope
  picker could move into the session-ended state.

## Testing sketch

- **Resolution order** (component test, seeded `['commands']` cache): running interactive command
  → attaches (renders `app-web-terminal` with its id, no launch call); running chat → defers with
  the jump-link state, no launch; finished commands with sessions → launch called with the newest
  command's last `sessionId` and `mode: INTERACTIVE`; empty history → launch without
  `resumeSessionId`.
- **Login embed**: a launch response whose command has no `agentSessions` renders in the embedded
  terminal (no navigation), and its exit re-triggers resolution.
- **Ended state**: a finished embedded run shows Resume + transcript link; Resume relaunches with
  the ended run's last session id.
- **Indicators**: Agents dot on a running interactive agent run; `actionsIndicator` no longer
  lights for commands with `agentSessions`.
- **Sweep aggregation** (`AgentTranscriptServiceTest` additions, same fixtures): importing a
  transcript writes an `agent_session_stat` row with the expected message count; sidechain
  fixtures produce subagent rows carrying the meta labels; re-import replaces rather than
  duplicates (idempotent).
- **Sessions endpoint**: assembles the tree for a workspace — resumes collapse onto one node,
  forks nest under `forkedFromSessionId`, subagents attach to their session, sessions of other
  workspaces are absent; a running session appears without counts.
- **Tree rendering** (component test): fork children indent under their parent with a distinct
  stable branch color; subagent rows render grayed; resumed sessions render once; row click
  navigates to the newest driving command.
- **Screenshot test** for the tab's states (terminal, chat-deferred, ended) and the session tree
  (roots + fork branch + subagent rows).
