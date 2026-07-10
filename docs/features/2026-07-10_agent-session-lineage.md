# Agent session lineage: pinned session IDs, transcript extraction, resume/fork, and the interactive Claude launch

## Introduction

Every Claude Code invocation qits makes today is anonymous from qits' point of view: what we
persist is whatever we intercept off the stream-json stdout pipe, and the session Claude Code
itself persists — the transcript JSONL under its config dir, with the session ID that would let us
resume or fork — is invisible to us. This idea makes the session a first-class, qits-owned
identity:

1. **qits generates the session ID** and pins it at launch — no discovery or interception.
2. Session identity is **persisted per command as an ordered list** (one execution can traverse
   several sessions), linking every agent run to its transcripts and its lineage (which command
   resumed/forked which session).
3. **Transcript extraction**: the session JSONL — **including subagent transcripts** — is read
   from the shared claude volume into `command_log_line`, the durable log source for agent runs
   (stdout interception remains the *live transport* for chat).
4. **Resume and fork** become regular `CodingAgent` capabilities.
5. **Session-switch reporting**: a `SessionStart` hook injected at launch reports the live
   session ID (and transcript path) back to qits, so lineage stays truthful even when a user
   switches sessions inside the interactive TUI.
6. On top of 1–3, an **interactive Claude launch**: the plain `claude` REPL in the terminal view
   (xterm.js), with the transcript extracted from session persistence instead of stdout.

All session mechanics live **behind the `CodingAgent` interface**: callers express intent
(`sessionId`, `resume`, `fork`, `transcriptPath`) and only the harness implementation knows the
CLI flags and on-disk conventions that realize it.

Related/dependent plans:

- **Extends [coding-agent-harness](2026-07-01_coding-agent-harness.md).** The
  `CodingAgent` builder gains the session-identity methods and a harness-owned
  transcript-location contract; `ClaudeCodeAgent` stays the only implementation.
- **Complements [stream-json-chat](2026-07-01_stream-json-chat.md) /
  [persistent-chat-sessions](2026-07-04_persistent-chat-sessions.md).** Chat keeps its
  live stdout stream over the WebSocket; durable logs move to transcript extraction. Retiring
  chat's redundant stdout-line persistence afterwards is its own follow-up:
  [chat-persistence-on-transcript](../feature-ideas/chat-persistence-on-transcript.md).
- **Builds on [container-agent-sessions](2026-07-04_container-agent-sessions.md).**
  The shared `qits_shared_dot_claude` volume (`qits.workspace.claude-volume`, mounted at
  `qits.workspace.claude-mount` = `/claude-home`) is where the transcripts live — qits reads them
  directly off its own filesystem because the
  [devcontainer](2026-07-07_qits-net-devcontainer-unification.md) mounts the same
  volume.
- **Stays on the agent path** ([unified action scope](2026-07-09_unified-action-scope.md)
  keeps actions plain shell): the interactive launch is a launch mode on `AgentLaunchService`, a
  sibling of chat, not an `ActionConfiguration`.
- **Runs through [workspace containers](2026-07-04_workspace-containers.md)** —
  unchanged `docker exec` plumbing (`CommandRegistry`); the interactive REPL reuses the PTY path
  the signed-out login flow already exercises.

## Verified mechanics (Claude Code 2.1.204, the pinned image version)

All of the following was verified live against the real CLI:

- **`--session-id <uuid>`** pins the session ID at launch. It is **create-only external naming**:
  a fresh UUID starts a brand-new session (verified: `num_turns: 1`, no prior history, JSONL file
  created by the launch), and an already-used UUID fails hard with
  `Error: Session ID <uuid> is already in use.` (exit 1).
- **`--resume <id>`** resumes **in place**: same session ID, same JSONL file, appended.
- **`--resume <old> --fork-session --session-id <new>`** forks deterministically: the new session
  inherits the full conversation history (verified: the fork answered a question about the
  original session's first message) and lands in a new JSONL named by the qits-chosen `<new>`
  UUID.
- **Transcript location**: `$CLAUDE_CONFIG_DIR/projects/<escaped-cwd>/<sessionId>.jsonl`, where
  `<escaped-cwd>` is the working directory with non-alphanumeric characters replaced by `-`.
  Every workspace container runs the agent with cwd `/workspace` and
  `CLAUDE_CONFIG_DIR=/claude-home/.claude`, so all workspace sessions land in
  `/claude-home/.claude/projects/-workspace/`, keyed by the session UUID. If the escaping
  convention ever drifts across CLI upgrades, an exact filename lookup
  (`find <config-dir>/projects -name '<uuid>.jsonl'`) recovers the file.
- **Subagent transcripts** are deterministic too: a Task-tool subagent persists to
  `projects/<escaped-cwd>/<sessionId>/subagents/agent-<agentId>.jsonl` (a directory named by the
  session UUID, beside the main JSONL), with a sibling `agent-<agentId>.meta.json` carrying
  `{agentType, description, toolUseId, spawnDepth}`. Every subagent line carries the parent
  `sessionId`, `isSidechain: true`, and its `agentId`; main-transcript lines carry
  `isSidechain: false`. The `toolUseId` links the sidechain to the exact Task tool-call in the
  main transcript.
- **`SessionStart` hooks** report session identity from inside the harness: a hook configured via
  `--settings` receives `{hook_event_name, source, session_id, transcript_path}` on stdin —
  verified with `source: "resume"` on a `--resume` launch, including the **absolute
  `transcript_path`**. Sources cover `startup`/`resume`/`clear`/`compact`, so the hook fires
  again whenever the live session changes underneath a running process.

## Data model: an ordered session list per `Command`

One command execution can traverse **several** sessions — the interactive TUI lets the user
`/resume` away from the pinned session mid-run — so session identity is a list, not a column.
Migration `V28__command_agent_session.sql` creates a collection table, mapped as an
`@ElementCollection` of a new `@Embeddable AgentSessionRef` on `Command` (the same shape as the
daemon `observers`/`sources` lists):

```java
@ElementCollection(fetch = FetchType.EAGER)
@CollectionTable(name = "command_agent_session",
    joinColumns = @JoinColumn(name = "command_id"))
@OrderColumn(name = "session_index")
public List<AgentSessionRef> agentSessions = new ArrayList<>();
```

| `AgentSessionRef` field | Meaning |
|---|---|
| `sessionId` | The agent session UUID. |
| `source` | `PINNED` (fresh launch) \| `RESUMED` (relaunch of an existing session) \| `FORKED` (branch launch) \| `SWITCHED` (hook-reported in-TUI change). |
| `forkedFromSessionId` | Set on `FORKED` entries: the session this one branched from. |
| `transcriptPath` | The hook-reported transcript JSONL path (container-side, authoritative over the computed convention); null until the first report. |
| `recordedAt` | When the entry was pinned/reported. |

The command's **current** session is the last entry; the list is the full history of sessions the
execution drove, in order. Most commands have exactly one entry. The list is empty for plain
actions/terminals/daemons.

Lineage falls out of the rows: all commands whose lists contain a session ID form that session's
conversation thread in chronological order (original + resumes); `forkedFromSessionId` edges form
the fork tree. Queries join through `command_agent_session` (`sessionId` indexed).

`CommandDto` exposes the list (MapStruct, `CommandMapper`); regenerate `docs/openapi.yml` + the
frontend API client.

## `CodingAgent` interface changes

The builder (harness-agnostic, `domain.agent.control`) gains:

```java
agent.sessionId(uuid)      // pin a fresh session under this ID
agent.resume(sessionId)    // continue an existing session in place
agent.resume(oldId)
     .fork(newUuid)        // branch oldId into a new session pinned as newUuid
```

a session-reporting seam:

```java
agent.sessionReporting(url)  // have the harness report session identity changes to this
                             // qits endpoint (initial start, and any in-TUI switch)
```

plus two harness-owned locators:

```java
// where this harness persists the transcript, relative to its config dir —
// e.g. projects/-workspace/<sessionId>.jsonl for cwd /workspace
Path transcriptPath(String cwd, String sessionId);

// where its subagent sidechains live —
// e.g. projects/-workspace/<sessionId>/subagents/ for Claude Code
Path subagentsDir(String cwd, String sessionId);
```

`ClaudeCodeAgent` maps the builder methods to `--session-id` / `--resume` / `--resume
--fork-session --session-id` in `appendFlags` (alongside the existing MCP/allowlist merging),
realizes `sessionReporting` as a `--settings` layer containing a `SessionStart` hook (below), and
implements the `projects/<escaped-cwd>/` conventions. **No caller ever sees a CLI flag, a hook
config, or a path convention** — `AgentLaunchService` and `AgentTranscriptService` go through the
builder and the locators only, so a future harness plugs in by implementing the same methods.
Validation at render time: session IDs must be UUIDs (they are interpolated into an argv); `fork`
without `resume` throws.

`AgentLaunchService` pins a fresh `UUID.randomUUID()` on **every** launch path — `launchChat`,
`launchAutonomous`, and the new interactive launch — and records it via `CommandService` at
`prepare` time as the command's first `AgentSessionRef` (`PINNED`, `RESUMED`, or `FORKED` by
launch kind). A retried launch regenerates its UUID (pinned IDs are single-use). The login REPL
is the one exception (onboarding, not a conversation).

## Transcript extraction: JSONL → `command_log_line`

A new `AgentTranscriptService` (`domain.agent.control`):

- Resolves the transcript as `<config-dir>/` + `CodingAgent.transcriptPath(cwd, sessionId)`
  (via `CodingAgentFactory`, so the convention stays harness-owned). `<config-dir>` is a new
  config property `qits.agent.claude-config-dir`, default
  `${qits.workspace.claude-mount}/.claude` — a direct filesystem read off the shared volume.
  When the conventional path is absent, fall back to the exact filename lookup; when the config
  dir doesn't exist (qits running without the volume mount), log once and skip import.
- Imports each JSONL line as a `command_log_line` row on the owning command, on a new
  `LogChannel.TRANSCRIPT` (distinct from intercepted stdout on `OUTPUT`, so chat's existing
  persistence is untouched). The sweep runs over **every entry in the command's session list** —
  a run that switched sessions imports each session's transcript, concatenated in list order (the
  lines self-describe via `sessionId`, so segment boundaries stay recoverable in the rendered
  view).
- **Imports subagent sidechains** from `CodingAgent.subagentsDir(cwd, sessionId)`: each
  `agent-<agentId>.jsonl` is swept the same way (the lines already self-describe via
  `isSidechain`/`agentId`, so they share the `TRANSCRIPT` channel), and the `.meta.json`
  (`agentType`, `description`, `toolUseId`) provides the label. In the transcript view a
  sidechain renders as a collapsible group anchored at its Task tool-call (matched by
  `toolUseId`), showing `agentType: description` when collapsed.
- Runs **on command exit** (composed onto the registry exit listener, after the status write): one
  idempotent sweep — delete-and-reimport of the `TRANSCRIPT` channel — streamed rather than
  slurped. **There is no live tail** (deliberate scope cut from the original idea): the transcript
  exists for post-hoc auditing, and while the session runs the terminal/chat *is* the view, so the
  transcript view simply renders after exit.
- Makes qits the durable owner of the conversation: Claude Code prunes old sessions
  (`cleanupPeriodDays`, default ~30 days), and the shared volume is disposable — after import,
  the DB copy survives both.

Transcript lines are shaped like stream-json events wrapped with persistence metadata
(`parentUuid`, `sessionId`, timestamps, the same `message` envelope). The existing
`linesToItems()` folding in `pattern/command/chat-stream.ts` needs only tolerance for the extra
fields to render extracted transcripts with the same chat renderer used live.

## Session-switch reporting: the `SessionStart` hook

Pinning covers the launch; the hook covers everything after. `sessionReporting(url)` makes
`ClaudeCodeAgent` add a `--settings` layer with a `SessionStart` hook whose command POSTs the
hook's stdin JSON (`{source, session_id, transcript_path}`) to the given qits endpoint — a new
`POST /api/commands/{commandId}/agent-session`, reached from inside the container via the
existing `QitsHostResolver` host (the same channel the MCP servers already use). The endpoint:

- on first report, confirms the pinned ID (and records the authoritative `transcript_path`,
  which is even less convention-dependent than computing it);
- on a report with a **different** `session_id` — the user ran `/resume` inside the interactive
  TUI — **appends** a new `AgentSessionRef` (`SWITCHED`) to the command's session list, so
  transcript extraction and lineage follow the session actually being driven while every earlier
  session the run touched stays recorded. Switching back and forth appends again — the list is
  the faithful order of sessions driven, duplicates included.

`launchChat`/`launchAutonomous` get the same hook — for them it is a consistency check (stream
modes can't switch sessions), and it removes any dependence on parsing the stream-json `init`
event for identity.

## Resume / fork surface

- **REST**: `POST /api/repositories/{repoId}/workspaces/{workspaceId}/agents` (existing launch
  endpoint) gains optional `resumeSessionId` + `fork` (boolean) fields. Resume relaunches the
  chat (or interactive session) via `agent.resume(...)`; fork additionally pins a fresh UUID and
  records `forked_from_session_id`.
- **UI**: a finished agent command (workspace chat tab / command detail) shows **Resume** and
  **Fork** buttons, acting on the command's **current** (last) session. Resume continues the same
  thread — a new `Command` row whose first session entry is the same ID (`RESUMED`); Fork starts
  a sibling. The transcript replay for a resumed command can prepend the thread's earlier
  commands' transcripts, since their session lists share the ID.
- Iteration one scopes resume/fork to the *same* workspace (the transcript's file references and
  git state belong to it).

## The interactive Claude launch

A third launch mode beside chat and autonomous: `AgentLaunchService.launchInteractive` builds the
agent with a pinned session ID, the same MCP scope servers, `HOME=/claude-home` overlay, and
skip-permissions as chat, and spawns the interactive `start()` spec as a `TERMINAL` command — the
full Claude Code TUI in xterm.js, on the plumbing the signed-out login flow already uses.

The PTY byte stream is ANSI-rendered TUI output, kept only for the terminal view; the structured
conversation comes from transcript extraction and renders through the same chat-transcript
component as a read-only "Transcript" view beside the terminal. The run is a first-class agent
session like any chat — persisted session ID, resumable, forkable, same lineage.

Entry point: a "Terminal session" option beside the existing chat launch on the workspace (same
scope picker).

## Implementation notes (as shipped, 2026-07-10)

Where the implementation deviates from (or pins down) the idea above:

- **No live transcript tail.** The original idea sketched a file-watch tail feeding a live
  transcript view; cut deliberately — the transcript exists for post-hoc auditing/rationale, and
  during the run the terminal (interactive) or chat stream (chat) is the view. The only import is
  the post-exit sweep. If live transcript freshness is ever wanted, the follow-up is a
  `ChatCommandSocket`-shaped `/api/transcript/commands/{id}` socket, not polling.
- **`Command.id` is service-generated now** (was `@GeneratedValue`): the launch renders the
  session-report hook URL (`/api/commands/{id}/agent-session`) into the script *before* the row
  exists, so `CommandLifecycleService.createRunning` assigns the UUID (restoring the codebase-wide
  service-layer-id convention) and persists the first `AgentSessionRef` in the same transaction —
  the hook can never race the pinned entry.
- **`AgentSessionRef.transcriptPath`** (not in the idea's field table): the hook-reported
  authoritative path is stored per entry; the sweep prefers it (remapped from the container-side
  `<claude-mount>/.claude/…` onto `qits.agent.claude-config-dir`) over the computed convention.
- **Two migrations** — `V28__command_agent_session.sql` (collection table + session index) and
  `V29__transcript_log_channel.sql` (the V9 channel check was inline/unnamed, so the column is
  recreated to admit `TRANSCRIPT`, V15-style).
- **One launch endpoint, `mode` field.** The interactive launch rides the existing
  `POST …/agents` endpoint via `AgentLaunchMode` (`CHAT` default | `INTERACTIVE`) beside
  `resumeSessionId`/`fork`, instead of a sibling endpoint.
- **Sidechain labels ride as a synthetic line**: the sweep emits
  `{"type":"qits_agent_meta","agentId","agentType","description","toolUseId"}` before each
  sidechain's lines; `linesToItems()` folds it into the collapsible group label and
  `foldSidechains()` anchors the group at the matching Task tool-call.
- **Chat double-render guard**: `GET /commands/{id}/log` gains a `channel` filter; chat replay
  pins `OUTPUT`, the transcript view pins `TRANSCRIPT` — chat's stdout persistence is untouched
  until [chat-persistence-on-transcript](../feature-ideas/chat-persistence-on-transcript.md)
  retires it.
- **TRANSCRIPT sequence space**: imported lines number from `1 << 40` (disjoint from live stdio
  sequences starting at 0), and the sweep is delete-and-reimport of the channel — idempotent.
- The session-report write lives in `CommandLifecycleService.recordAgentSessionReport` (the single
  writer of `Command`), reached via `CommandService.reportAgentSession`; the endpoint is
  container-reachable without auth (like `/git` and `/mcp`), so the session id is UUID-validated
  and the command must exist and be RUNNING.

## Extracted follow-ups

- **Converging chat persistence onto `TRANSCRIPT`** — its own idea:
  [chat-persistence-on-transcript](../feature-ideas/chat-persistence-on-transcript.md).
- **Cross-workspace fork** — a `docs/backlog.md` entry until the same-workspace lineage UX
  exists.

## Open questions

- **Convention stability.** The `projects/<escaped-cwd>/<id>.jsonl` and `subagents/` layouts are
  internal Claude Code conventions. Three mitigations layer up: the image pins the CLI version
  (`2.1.204`); the `SessionStart` hook reports the authoritative `transcript_path` at runtime;
  and a regression test against the real CLI (extended suite, next to `WorkspaceContainerIT`)
  pins the round trip — launch with a pinned ID, assert the files exist where
  `transcriptPath`/`subagentsDir` say — so upgrading the pinned CLI re-runs the gate.
- **Transcript growth.** Long interactive sessions produce large JSONL files; `command_log_line`
  already stores un-truncated CLOBs per line, so this is the same order as chat today — the
  post-exit sweep just has to stream.

## Testing sketch

- **`ClaudeCodeAgentTest` additions**: `sessionId`/`resume`/`fork` render the exact flag
  combinations (`--session-id`, `--resume`, `--resume --fork-session --session-id`); `fork`
  without `resume` throws; non-UUID session IDs are rejected; `sessionReporting(url)` renders a
  `--settings` layer whose `SessionStart` hook POSTs to the url; `transcriptPath("/workspace",
  id)` = `projects/-workspace/<id>.jsonl` and `subagentsDir` = `projects/-workspace/<id>/subagents/`.
- **`AgentLaunchServiceTest` additions**: every launch path records a first `AgentSessionRef`
  with the right source (`PINNED`/`RESUMED`/`FORKED`) and wires `sessionReporting`; resume reuses
  the given ID; fork records `forkedFromSessionId`; login gets no session entry.
- **`AgentTranscriptServiceTest`** (temp dir as `qits.agent.claude-config-dir`): imports a
  fixture JSONL into `command_log_line` on `TRANSCRIPT`; a command with multiple session entries
  imports all transcripts in list order; imports sidechain fixtures from `subagents/` with their
  meta labels; idempotent re-import; conventional-path miss falls back to filename lookup; absent
  config dir logs once and skips.
- **Session-report endpoint**: first report with the pinned ID is a no-op confirm; a differing
  ID appends a `SWITCHED` entry (current session = last entry); switching back appends again
  rather than deduplicating; unknown command / mismatched workspace rejected.
- **Extended IT** (real docker + real CLI, self-skipping like `WorkspaceContainerIT`): launch a
  pinned print-mode session in a workspace container; assert the transcript appears at the
  predicted path on the shared volume, a Task-spawning prompt produces
  `<id>/subagents/agent-*.jsonl`, resume-in-place appends to the same file, and the
  `SessionStart` hook delivers `{source, session_id, transcript_path}`.
- **Controller**: launch with `resumeSessionId`/`fork` round-trips; ownership validation (session
  must belong to the workspace); `OpenApiSchemaExportTest` regenerated.
- **Frontend**: transcript renderer folds transcript-JSONL lines (fixture with the wrapped
  format) and collapses sidechain groups at their Task call; Resume/Fork buttons on a finished
  agent command; interactive launch shows terminal + transcript views.
