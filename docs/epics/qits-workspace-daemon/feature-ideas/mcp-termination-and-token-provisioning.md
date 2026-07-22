# MCP termination in-container + token provisioning by `workspace-daemon`

## Introduction

Part 6 of [qits-workspace-daemon](../epic.md). **Out of scope until
[Part 1](workspace-daemon-binary-and-control-socket.md) lands** (and after
[Part 2](command-execution-over-socket.md), since agent launches ride the command path). Makes
`workspace-daemon` **terminate the workspace's MCP connection inside the container** — it is the endpoint
the coding agent talks to locally — and **provision the credentials/tokens** the agent needs,
authorizing back to qits over the control socket instead of the agent reaching the qits MCP
endpoints directly over HTTP with an ambient, shared identity.

Related/dependent plans:

- **Hard dependency** — [Part 1](workspace-daemon-binary-and-control-socket.md); rides
  [Part 2](command-execution-over-socket.md) (the agent is a spawned command).
- **Re-homes MCP for** [qits-coding-agents](../../qits-coding-agents/epic.md) — the MCP scopes
  (ACTIONS / REPOSITORY / PROJECT, the `mcp__repository__*` tools) and read-only allowlists are
  unchanged; where the connection **terminates** and how the caller is **authenticated** change.
- **Dovetails with** [qits-tokens](../../qits-tokens/epic.md) / the
  [scoped-tokens](../../qits-tokens/feature-ideas/scoped-tokens.md) draft — `workspace-daemon` is the
  natural issuer/holder of **purpose-scoped, caller-bound** tokens for a workspace's agent,
  replacing the ambient shared-`HOME` credential model. This part is a prime consumer of that
  epic; sequence them together.

## The current surface (what moves — `AgentLaunchService.java`)

- **MCP URL composition** — `serversFor()` (`:705`) builds scoped servers with
  `?projectId=&repositoryId=&workspaceId=` query params (`:711-740`); `derivedMcpUrl()` (`:759`)
  = `http://<qitsHost>:<port>/mcp/<server>`. The agent connects **out** to qits over HTTP. Under
  `workspace-daemon`, the agent connects to a **local** MCP endpoint `workspace-daemon` exposes in the container;
  `workspace-daemon` proxies/authorizes the calls back to qits over the control socket. The `qitsHost`
  round-trip and per-URL composition go away.
- **Credentials** — today there is **no per-session secret**: `withAgentHome()` (`:689`) points
  `HOME` at a shared credential **volume** (`/claude-home`, `claudeMount` `:151`), populated once
  by `docker/workspace/agent-login.sh`. Every workspace's agent shares that identity. `workspace-daemon`
  instead **provisions per-workspace (ideally per-launch, caller-bound) tokens** handed over the
  socket, so an agent's authority is scoped to its workspace and purpose.

## Scope

- `workspace-daemon` hosts the in-container MCP endpoint the agent is configured against (replacing
  `derivedMcpUrl`); it terminates the MCP session and relays authorized tool calls to qits over
  the socket, tagging them with the workspace/scope identity qits already trusts from the
  handshake.
- Token provisioning: `workspace-daemon` obtains and injects the credentials the agent needs (MCP auth,
  and — coordinated with [Part 4](in-container-git-verbs-over-socket.md) — git-remote auth),
  scoped and caller-bound rather than ambient. Retire the shared-`HOME` identity for MCP.
- Preserve the scope model, the read-only allowlists, and the session-report hook
  (`sessionReportUrl` `:552`) — the latter can relay over the socket too.

## Out of scope

- The MCP *tool semantics* themselves (still the `mcp__repository__*`/action tools).
- Command execution (Part 2, prerequisite), file access (Part 3), git (Part 4), daemons (Part 5),
  maintenance (Part 7). Login UX (`agent-login.sh`) shrinks but its full removal follows the
  token-epic outcome.

## Testing

- Agent talks to the local `workspace-daemon` MCP endpoint; a scoped tool call round-trips to qits and is
  authorized by workspace identity, not ambient credentials. Negative test: a call outside the
  granted scope is rejected. Regression on the existing agent MCP suites.
