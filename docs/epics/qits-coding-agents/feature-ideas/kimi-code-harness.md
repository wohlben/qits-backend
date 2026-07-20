# Kimi Code harness — a second coding-agent harness (non-chat)

## Introduction

The coding-agent domain was built for exactly one harness: Claude Code. The abstraction that was
meant to make it pluggable — the `CodingAgent` builder + `CodingAgentFactory.ofType(AgentType)` —
is in place, but `AgentType` has a single value and every surrounding service quietly assumes
Claude: its CLI flags, its transcript layout, its OAuth flow, its plugin marketplace. This feature
adds **Kimi Code CLI** as a second, peer harness for its **interactive TUI** and **autonomous
one-shot** launch shapes, plus the machinery every shape shares — session identity, MCP delivery,
auth, and transcript import — by implementing the gaps the Claude-shaped assumptions leave behind.

Agent selection is a **global config property** (`qits.agent.type=claude|kimi`, default `claude`):
one harness per qits deployment, no per-launch UI picker.

**The native in-UI chat is deliberately out of scope here** — kimi has no stdin stream-json chat
mode, so its chat rides its **ACP (Agent Client Protocol)** stdio interface, a large enough piece
to own its own document. This harness feature ships without kimi chat; kimi chat launches are
rejected until [kimi-code-acp-chat](kimi-code-acp-chat.md) lands. Interactive and autonomous runs
are fully functional.

Related / dependent plans:

- Builds directly on the [coding-agent-harness](../features/2026-07-01_coding-agent-harness.md):
  `CodingAgent` / `CodingAgentFactory` / `AgentType` / `LaunchSpec` are the extension points this
  feature plugs into; `AgentLaunchService` owns the MCP scope→URL construction both harnesses share.
- **Prerequisite of [kimi-code-acp-chat](kimi-code-acp-chat.md)** — the native chat over ACP builds
  on the `AgentType.KIMI` harness, session-identity model, transcript import, and auth this feature
  establishes.
- Reuses the session machinery of [agent-session-lineage](../features/2026-07-10_agent-session-lineage.md)
  (session refs on the command row, the session-report endpoint) with a relaxed identity model —
  kimi session ids can't be pinned at launch.
- Reuses the transcript import of [chat-persistence-on-transcript](../features/2026-07-10_chat-persistence-on-transcript.md)
  (`AgentTranscriptService` / `AgentTranscriptTailService`) against kimi's `wire.jsonl` layout.
- Rides the same container/credential model as
  [container-agent-sessions](../features/2026-07-04_container-agent-sessions.md): the shared named
  volume, the HOME overlay, `docker/workspace/agent-login.sh`.
- Complements [mcp-task-prompt-delivery](mcp-task-prompt-delivery.md): the fetch-not-push prompt
  model is launch-shape-universal and applies unchanged to kimi (its `-p` and TUI modes both
  support MCP tools).

## Problem: where Claude is assumed today

The harness abstraction covers **command rendering**; everything around it is Claude-shaped
(the chat-specific assumptions are addressed in [kimi-code-acp-chat](kimi-code-acp-chat.md)):

- **`AgentType` / `CodingAgentFactory`** — one value, one case. (The intended extension point; no
  design flaw.)
- **`CodingAgent`'s session model is Claude's.** It assumes a create-only UUID pinnable at launch
  (`--session-id`), fork (`--fork-session`), canonical-UUID validation
  (`validateSessionConfiguration`), and a per-launch `--settings` SessionStart hook for session
  reporting. Kimi can resume (`-S <id>`) but **cannot pin a new session's id**, has **no CLI fork**,
  and its ids are `session_<uuid>`, not canonical UUIDs.
- **`AgentLaunchService`** hardcodes `ofType(AgentType.CLAUDE)` in `renderChat` /
  `renderAutonomous` / `renderInteractive`, hardcodes "Claude Code …" display names, probes auth
  with `claude auth status` (`AgentAuthStatus`), and renders the login terminal as `exec claude`.
- **Transcript import** (`AgentTranscriptService` / `AgentTranscriptTailService`) reads Claude's
  `projects/<escaped-cwd>/<id>.jsonl` plus `subagents/agent-*.jsonl` + `.meta.json` off the shared
  volume (`qits.agent.claude-config-dir`), and its stat collection parses Claude line shapes.
- **`AgentPluginService`** is the Claude marketplace (LSP plugins) — Claude-only by nature.
- **`PromptRefinementService`** runs `ofType(CLAUDE).model(…).run(metaPrompt)` in the container.
- **The image** bakes a pinned `CLAUDE_CODE_VERSION`; `agent-login.sh` does the claude REPL OAuth;
  the shared volume holds `~/.claude`.

Already harness-agnostic (no work): `ResolveConflictService` → `launchAutonomous`, the MCP
scope→URL construction (`serversFor`, the `?projectId=/repositoryId=/workspaceId=` narrowing),
`McpServers.httpMcp`, and the read-only `agentReadOnly=true` server marking.

## Kimi capability map (verified)

Probed against the installed CLI and the official docs
([kimi command](https://www.kimi.com/code/docs/en/kimi-code-cli/reference/kimi-command.html),
[MCP](https://www.kimi.com/code/docs/en/kimi-code-cli/customization/mcp.html),
[hooks](https://www.kimi.com/code/docs/en/kimi-code-cli/customization/hooks.html),
[sessions](https://www.kimi.com/code/docs/en/kimi-code-cli/guides/sessions.html)):

- **Interactive**: `kimi` TUI (PTY-friendly); `-S <id>` resume, `-m <model>`, `--yolo`
  auto-approve, `--plan`. No `--session-id` pin; fork is the TUI-only `/fork`.
- **Autonomous**: `kimi -p '…' [--output-format stream-json]` — auto permission by default (the
  skip-permissions equivalent); stream-json emits NDJSON `{"role":"assistant","content":…}`,
  assistant `tool_calls` + tool messages, and a `session.resume_hint` meta line carrying the new
  session id. (`-p` rejects combination with `--yolo`/`--auto`.)
- **MCP**: `mcp.json` at `$KIMI_CODE_HOME/mcp.json` (user level) or `.kimi-code/mcp.json` (project
  level); `{url}` entries are HTTP servers; per-server `enabledTools` allowlist; tool naming
  `mcp__<server>__<tool>` — the same scheme qits' existing allowlists already use. There is no CLI
  flag, so the file is written at launch time.
- **Hooks**: `[[hooks]]` in `config.toml`; a `SessionStart` event whose stdin payload is
  `{hook_event_name, session_id, cwd}` — enough for qits' session-report endpoint. Configured via
  file (can live on the shared volume), not a per-launch flag.
- **Auth**: `kimi login` is an RFC 8628 device-code flow — it prints the verification URL + user
  code to stderr and polls, so it works over a PTY (unlike `claude auth login`, which blocks on an
  unreachable loopback callback). Credentials live under `$KIMI_CODE_HOME`. There is no
  `auth status` subcommand; the probe is credential-file presence (or a trivial `-p` run).
- **Sessions / transcripts**: `$KIMI_CODE_HOME/sessions/<workDirKey>/<sessionId>/agents/main/
  wire.jsonl`, with subagent sidechains as sibling `agents/<subagentId>/wire.jsonl` and `state.json`
  metadata. Session ids are `session_<uuid>`. `wire.jsonl` has its own schema (a `metadata` line
  with `protocol_version`, `config.update`, message events) and carries request-trace noise (tool
  schemas, MCP listings) the import must filter.
- **Chat (bidirectional)**: no stdin stream-json — the programmatic protocol is `kimi acp`, owned
  by [kimi-code-acp-chat](kimi-code-acp-chat.md).

## Proposed design

### 1. `AgentType.KIMI` + `KimiCodeAgent`

A `KimiCodeAgent extends CodingAgent` rendering kimi command lines, added to the factory switch.
`start()` → `exec kimi` (TUI; `--yolo` when skip-permissions, `-S <id>` on resume, `-m` model);
`run(prompt)` → `kimi -p '<prompt>' [--output-format stream-json]`. `transcriptPath`/`subagentsDir`
map to the `sessions/<workDirKey>/<id>/agents/` layout. (`chat()` → `exec kimi acp` is added by
[kimi-code-acp-chat](kimi-code-acp-chat.md); until then a kimi `chat()` render throws / the launch
is rejected — see below.)

A global **`qits.agent.type=claude|kimi`** (default `claude`) is read by `AgentLaunchService` (one
`ofType` call site per render method becomes type-driven, display names per harness),
`PromptRefinementService`, `AgentAuthStatus`, the transcript services (per-harness config dir +
path convention), and `AgentPluginService` (plugins stay Claude-only; the UI hides that surface for
kimi).

### 2. Session identity without pinning

Kimi can't pin a session id, so the lineage model relaxes: a fresh kimi launch starts **unpinned**
and qits learns the id from the harness itself — the `SessionStart` hook POST (payload carries
`session_id`, wired to the existing `/api/commands/{id}/agent-session` endpoint via a `[[hooks]]`
entry in the volume's `config.toml`), and for `-p` runs the `session.resume_hint` meta line. The
first `AgentSessionRef` on the command row becomes "reported at start" rather than PINNED. Resume
maps to `-S <id>`; **fork is rejected with a clear 400 for kimi** (no CLI support — emulating it by
copying session dirs is explicitly out). Session-id validation accepts harness-native ids
(`session_<uuid>`) instead of canonical UUIDs only.

### 3. MCP delivery for interactive + autonomous: a per-launch `KIMI_CODE_HOME`

The scoped MCP configuration is **per launch, not per workspace** — `serversFor` produces a
different server set per `AgentMcpScope` (ACTIONS = actions + narrowed repository, REPOSITORY =
narrowed repository, PROJECT = project-wide repository), and two sessions in the same workspace
may run concurrently with different scopes. Any design that writes one static MCP config file per
workspace is therefore wrong by construction: launches would clobber each other's config.

Interactive TUI and autonomous `-p` have no per-launch MCP channel — no CLI flag, no env override
for `mcp.json` itself (the
[config-override rules](https://www.kimi.com/code/docs/en/kimi-code-cli/configuration/overrides.html)
reserve env vars for data-location/switch duties). But `KIMI_CODE_HOME` *is* the one supported
relocation knob, and `mcp.json` lives directly under it — so each launch renders a small prelude
into its `LaunchSpec` script (a mktemp + symlink farm):

```sh
export KIMI_CODE_HOME="$(mktemp -d /tmp/qits-kimi-XXXXXX)"
trap 'rm -rf "$KIMI_CODE_HOME"' EXIT
# Symlink farm: everything except mcp.json comes from the shared volume home.
for e in config.toml tui.toml credentials oauth device_id sessions session_index.jsonl; do
  [ -e "$QITS_KIMI_HOME/$e" ] && ln -s "$QITS_KIMI_HOME/$e" "$KIMI_CODE_HOME/$e"
done
cat > "$KIMI_CODE_HOME/mcp.json" <<'EOF'
{ "mcpServers": { "repository": { "url": "…scoped…", "enabledTools": [ … ] } } }
EOF
exec kimi …
```

Every launch gets its **own** `mcp.json` — no race, no lock, nothing written into the workspace
clone, no `.git/info/exclude` — while credentials, hooks config, and the session store flow
through the symlinks onto the shared volume, so login, the `SessionStart` report hook, and the
`wire.jsonl` transcript import all keep working unchanged (kimi creates session subdirs *inside*
the symlinked `sessions/`; the writes land on the volume). The user-level
`$KIMI_CODE_HOME/mcp.json` on the volume is deliberately **not** used: it is global across all
workspaces — exactly the clobbering this section exists to avoid. Runtime-only state that lands in
the throwaway dir instead (diagnostic logs, `user-history`, update checks) is acceptable — none of
it is load-bearing for qits.

**One asymmetry: `launchLogin` uses the real volume home, not a mktemp one.** If kimi persists
credentials with an atomic rename (write tmp + replace), it would replace the `credentials`
*symlink* with a real file inside the throwaway dir and the login would evaporate on cleanup.
Sessions and hook config only ever have their *contents* written (subdirs under a symlinked dir,
which is rename-safe), so the farm is safe for everything except the login flow itself — which
needs no MCP config anyway.

The allowlists need one mapping step: kimi's `enabledTools` is **per-server** and takes bare tool
names, while qits' shared `READ_ONLY_*` lists use the Claude-prefixed `mcp__<server>__<tool>` form
— so the kimi renderer strips its own server's prefix when filling `enabledTools` (the underlying
tool naming is identical, so nothing else changes).

> **Chat** (over ACP) uses a different, protocol-native channel — scoped `mcpServers` on
> `session/new`, no file — because the ACP transport has a per-session slot the file-based modes
> lack. See [kimi-code-acp-chat](kimi-code-acp-chat.md) §"MCP over ACP".

### 4. Auth on the shared volume

Same shared-volume model: the real kimi home is `<claude-mount>/.kimi-code` on the shared volume
(reached via the existing HOME overlay, under which `~/.kimi-code` lands anyway). `launchLogin`
renders `kimi login` against that **real** home — the device-code flow is PTY-friendly by design,
so the login terminal works without the claude REPL-onboarding workaround. Agent launches point
`KIMI_CODE_HOME` at the per-launch mktemp farm of §3, whose symlinks resolve credentials and
sessions back to the volume; the login flow is the one launch shape that must *not* use the farm
(atomic-rename credential writes would strand the login in the throwaway dir). `AgentAuthStatus`
gets a per-harness probe: credential-file presence under the real volume home (no `auth status`
subcommand exists).

### 5. Transcript import

`AgentTranscriptService`/`AgentTranscriptTailService` resolve kimi's
`sessions/<workDirKey>/<sessionId>/agents/main/wire.jsonl` (the workDirKey derivation is verified
and pinned by a regression IT, exactly like the claude escaped-cwd convention) and import it with
kimi-shaped filtering: drop the request-trace noise (`config.update`, tool-schema dumps), map
kimi's message events for the stat collector's conversation-turn counting, and import subagent
sidechains from sibling `agents/<id>/wire.jsonl` dirs. The frontend consumes the normalized import
unchanged.

The transcript services (and the tail) currently hardcode `ofType(AgentType.CLAUDE)` and the
`qits.agent.claude-config-dir`; both become per-harness: the config dir resolves to `.kimi-code`
under kimi and the transcript/subagent path conventions come from `AgentType`.

> The re-attach **uuid-minting contract** (minting a stable uuid per normalized event so the live
> ring and the durable transcript stitch losslessly) only matters for the live chat stream, so it
> is specified together with the ACP normalizer in
> [kimi-code-acp-chat](kimi-code-acp-chat.md). The autonomous/interactive transcript import here is
> post-exit / tail-only and needs no live-ring stitching.

### 6. Image and login script

**Done ahead of the rest (2026-07-20):** the kimi CLI is baked into the `workspace` stage of
`docker/qits/Dockerfile` at a pinned version (`KIMI_CODE_VERSION` ARG, mirroring
`CLAUDE_CODE_VERSION`, installed system-wide via `KIMI_INSTALL_DIR=/usr/local`, update preflight
disabled with `KIMI_CODE_NO_AUTO_UPDATE=1`), so both harnesses ship in the one `qits/workspace`
image — and in the devcontainer, which is `FROM qits/workspace:latest`. Remaining here:
`agent-login.sh` gains a kimi path (`kimi login` in the throwaway container against the volume).

## Not built (candidate follow-ups)

- **Kimi native chat** — over ACP; its own document,
  [kimi-code-acp-chat](kimi-code-acp-chat.md). Kimi chat launches are rejected until it lands.
- **Fork for kimi** — no CLI support; would require copying session dirs (fragile, unversioned
  layout).
- **Kimi plugins** — a different mechanism than the Claude marketplace; `AgentPluginService` stays
  Claude-only.
- Per-launch / per-workspace agent selection (the global property is the deliberate first step).
- Token/cost display, partial-message streaming — same status as for Claude.

## Open verifications (spikes before/during implementation)

- The `<workDirKey>` derivation rule in `sessions/<workDirKey>/…`, and `wire.jsonl` schema
  stability across CLI versions (the `protocol_version` metadata line is the pin point).
- Does the `SessionStart` hook fire for `-p` launches, not only the TUI? (Determines whether `-p`
  runs can rely on the hook for identity or must parse `session.resume_hint`.)
- The mktemp symlink farm's core assumption: kimi follows symlinked `sessions/`, `credentials`,
  and `config.toml` transparently (session subdir creation and atomic renames *inside* a symlinked
  dir land on the volume; verified with a real launch in the container). Also that nothing
  load-bearing (beyond diagnostic logs/history) is written to `KIMI_CODE_HOME` at runtime.

## Testing / verification

- `CodingAgentFactoryTest`-style renderer tests: exact kimi argv for start/run; the launch prelude
  renders the mktemp home, the symlink farm, and the scoped `mcp.json` heredoc (prefix-stripped
  `enabledTools`); `launchLogin` provably uses the real volume home; POSIX shell-quoting.
- `AgentLaunchServiceTest`: `qits.agent.type` selects the harness, names/probes follow; kimi fork
  rejected with 400; kimi chat launch rejected until [kimi-code-acp-chat](kimi-code-acp-chat.md).
- Transcript-import tests on recorded `wire.jsonl` fixtures (main + sidechain + trace noise).
- `AgentAuthStatus` probe parse tests (credential-file presence).
- Extended (real-docker) IT: kimi autonomous run in a workspace container, session id reported,
  transcript imported.
