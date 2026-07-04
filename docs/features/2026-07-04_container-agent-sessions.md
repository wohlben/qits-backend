# Container agent sessions: the coding agent works inside the workspace container (Phase 3)

## Introduction

The security payoff of [workspace containers](2026-07-04_workspace-containers.md) only fully lands
when the **coding agent** — the single biggest executor of arbitrary commands in qits — runs inside
the sandbox. Phase 1 already routes *all* command execution (including the stream-json chat) through
`docker exec` into the per-worktree container and sets the `qits@local` git identity at container
init, so the mechanical relocation was already done. This phase adds the two things specific to the
agent: the CLI in the image, and a credential hand-off that lets the in-container `claude`
authenticate.

Related/dependent plans:

- **Phase 1 — [workspace-containers](2026-07-04_workspace-containers.md)** (hard dependency): the
  `docker exec` launch seams, the `qits@local` identity, and `CommandService.prepare`'s
  container-only env overlay this builds on. Independent of Phase 2
  ([container-file-access](2026-07-04_container-file-access.md)).
- The [coding-agent harness](2026-07-01_coding-agent-harness.md) and the
  [stream-json chat](2026-07-01_stream-json-chat.md) protocol are what run inside the container; the
  registry still owns stdin/stdout, so [persistent chat sessions](2026-07-04_persistent-chat-sessions.md),
  the [worktree chat dialog](2026-07-04_worktree-chat-dialog.md), and transcript restore are unchanged.
- The [daemons](2026-07-04_daemons.md) agent-notification sink injects events by writing to the
  chat's stdin (`CommandRegistry.chatSend`) — that stdin is a `docker exec -i` pipe, unchanged by
  this phase. Daemon and agent share the same container, so "the dev server the agent just broke" is
  reachable at `localhost` from the agent's shell.

## What was built

### The CLI in the image (`docker/workspace/Dockerfile`)

- `claude` is baked in at a **pinned version** via `ARG CLAUDE_CODE_VERSION` (default `2.1.89`,
  bump-able — the build fails loudly on an unpublished version): `npm install -g
  @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}`. npm-global lands `/usr/bin/claude` on PATH for
  the arbitrary runtime uid the container runs as. (The now-preferred native installer installs
  per-user under `~/.local/bin`, which doesn't fit a uid-agnostic image — noted in the Dockerfile.)
- A world-writable `/claude-home` mount point for the shared credential volume.
- The repository's own `.claude/` and `CLAUDE.md` arrive with the clone, so project configuration
  (incl. repo-configured MCP servers) works with zero qits involvement and runs *inside* the
  container.

### Credential hand-off — a shared `~/.claude` volume

The one secret that must cross the boundary is the agent's own credential. qits uses a **shared
named Docker volume** (`qits.workspace.claude-volume`, default `qits_shared_dot_claude`) holding the
agent's home (`~/.claude` — the login + state):

- `DockerExecutor` creates the volume idempotently at startup (`ensureClaudeVolume`, a `docker volume
  create` on `StartupEvent`) and mounts it read/write at `qits.workspace.claude-mount` (default
  `/claude-home`) on **every** worktree container (added to the `docker run` argv).
- Agent launches (`AgentLaunchService.renderChat` / `renderAutonomous`) set `HOME=<claude-mount>` as
  a `docker exec -e` overlay, so the in-container `claude` reads the login off the volume. The
  overlay rides the existing seam (`CodingAgent.environment` → `LaunchSpec.environment` →
  `CommandService.prepare` → `-e`). CWD stays `/workspace`, so the agent's project detection is
  unaffected.
- The one-time **interactive OAuth login** is done by the operator via `docker/workspace/agent-login.sh`
  (runs `claude /login` in a throwaway container as the host uid, writing `~/.claude` onto the
  volume). Nothing about the login is qits' job at runtime.

Git identity (`qits@local`) is already set repo-locally at container init
(`WorktreeService.createContainerWorktree`), so agent commits just work; pushes go only to the
qits-hosted origin.

### Removed: the seeded bare "Claude Code" action

`ActionConfigurationSeeder` no longer seeds a "Claude Code" run action. The three "Configure … with
Claude" buttons use the chat/agent path (which applies the credential overlay); a bare seeded action
would launch `claude` through the plain action path *without* the overlay and couldn't authenticate.
Only the `Bash` shell is seeded now.

## Deviation from the idea doc (and its blast radius)

The idea doc proposed **per-session `-e` injection** of an API key and explicitly *rejected* mounting
`~/.claude`. This implementation does the opposite on purpose (operator's choice): a dedicated shared
volume holds only the agent's login, populated once interactively, mounted into every container.

**Accepted trade-off, stated:** because the volume is mounted on *every* worktree container (agent
and daemon share one container by design), **any command in any container — including a malicious
dependency in an action or dev server — can read the login token off the volume.** This widens
credential exposure versus per-session `-e` and versus the sandbox's original isolation goal. A
compromised container can spend the credential (and, being shared, poison agent config for all
worktrees) until the login is revoked. It still cannot reach the host, other credential stores, or
external git remotes. Accepted for the prototype; recorded here as a known limit. Blank
`qits.workspace.claude-volume` to disable the mount (agent auth then unavailable).

## Caveats

- **Pre-existing worktree containers must be recreated** to pick up the volume — a mount can't be
  added to a running container. Discard + recreate the worktree (or `docker rm -f` the container so
  reconciliation rebuilds it).
- **Pre-existing seeded "Claude Code" rows** in an operator's H2 are left in place by the idempotent
  seeder; delete them if unwanted (they'd launch `claude` without the credential overlay).
- `PromptRefinementService` still runs `claude` on the **host** (via `ProcessExecutor`, neutral cwd,
  host auth) by design — it's an ephemeral text-rewrite, out of the container scope.

## Testing

- `AgentLaunchServiceTest` — `renderChat`/`renderAutonomous` carry `HOME=/claude-home` (the
  credential overlay) while still rendering the stream-json / print scripts.
- Seeder removal needs no test change (no test asserted the "Claude Code" action or action counts);
  the full `./mvnw clean test` suite stays green across domain/service/cli.
- Extended real-docker IT (`WorkspaceContainerIT`, `@Tag("extended")`, self-skips without
  docker/image): a freshly-run container has the (throwaway) credential volume mounted writable at
  `/claude-home` and `claude --version` runs on PATH. The full authenticated round-trip is manual
  (below), since it needs a real login and spends API credits.

## Manual verification checklist

1. `docker build -t qits/workspace docker/workspace` (set `CLAUDE_CODE_VERSION` as desired); confirm
   `docker run --rm qits/workspace claude --version`.
2. `bash docker/workspace/agent-login.sh` → complete the OAuth login once; confirm
   `docker run --rm -v qits_shared_dot_claude:/claude-home qits/workspace ls /claude-home/.claude`.
3. Start the service; create a repo + worktree; click a "Configure … with Claude" button — the chat
   authenticates from the shared volume and streams a reply; ask it to write a file, commit, and the
   commit pushes back through the JGit server to the bare origin.
