# Coding-agent harness — a `CodingAgent` builder, and all Claude launches through it

## Introduction

Running a coding agent (today only Claude Code) was not a first-class concept: it was bolted onto the
generic **action** model as an `ActionVariant` enum, its dangerous flag-construction lived in
`ActionResolutionService.claudeLaunch()`, its MCP-scoped launches were seeded as fake "global
actions", and one flow (`ResolveConflictService`) hand-wrote its own `claude -p "$(cat …)"` script and
a per-workspace prompt file. This feature introduces a proper harness abstraction — a `CodingAgent`
builder with a single `ClaudeCodeAgent` implementation — and routes **every** Claude invocation
through it.

This resolves the "rethink action variants — the typed enum is a flawed concept" backlog item
(`docs/backlog.md`), which called for separating the **capability** (attach a repo-scoped MCP server,
set an initial context) from the **harness** that consumes it, so capabilities compose and new
harnesses don't each require new enum values + bespoke renderers.

Related / dependent plans:
- Sits on top of the [command-registry](../../qits-workspace-commands/features/2026-06-30_command-registry.md): every agent launch is spawned
  as a registry `Command` (re-attachable terminal, survives restart) via a new
  `CommandService.launchAgent(...)`.
- Removes the `variant` concept added by [actions](../../qits-feature-flows/features/2026-05-01_actions.md); actions are plain shell
  scripts again.
- Reworks `repository.control.ResolveConflictService` (from [workspace-history](../../qits-workspaces/features/2026-06-30_workspace-history.md))
  to launch its autonomous Claude run through the agent path instead of a bespoke action + prompt file.

## Problem

- **Leaky abstraction.** Three of four `ActionVariant`s (`CLAUDE_ACTIONS_MCP`,
  `CLAUDE_REPOSITORY_MCP`, `CLAUDE_PROJECT_MCP`) were really Claude launches disguised as shell
  actions; the UI selected them client-side by reading `variant`.
- **Scattered construction.** Claude command lines were built in at least three places
  (`ActionResolutionService`, `ActionConfigurationSeeder`, `ResolveConflictService`), each by hand, with
  their own escaping and MCP-config JSON.
- **No common surface.** There was nowhere to iteratively configure an agent (MCP servers, allowlist,
  skip-permissions, an initial prompt) independent of which agent it is.

## Solution

A new domain area **`eu.wohlben.qits.domain.agent`** (`control/`):

- **`CodingAgent`** — an abstract class that *is* the builder. It holds the harness-agnostic config
  (MCP servers as a `Map<key, config>`, a tool allowlist, an initial prompt, skip-permissions, env) and
  the fluent setters; it declares `start()` / `run(prompt)` abstract. A concrete agent only has to know
  how to render its own command line.
- **`ClaudeCodeAgent extends CodingAgent`** — the self-building implementation. `start()`/`run()`
  assemble the `claude` command from the accumulated config: `exec claude` (interactive) vs `claude -p`
  (one-off), MCP servers merged into one `--strict-mcp-config --mcp-config '{…}'` (serialized with
  Jackson `ObjectMapper`, not hand-rolled JSON), the allowlist into one `--allowedTools '…'`, and
  `--dangerously-skip-permissions` when autonomous. The prompt is embedded directly as a POSIX
  single-quoted argument (injection-safe), so it can come from any source — a literal, a classpath
  resource, an entity — with no side file.
- **`CodingAgentFactory.ofType(AgentType)`** — a pure delegating facade that hands back the right
  concrete agent. No building logic lives here.
- **`McpServers.httpMcp(url)`** — a reusable generator for the standard `{"type":"http","url":"…"}`
  MCP config object, so a server definition is agent-agnostic.
- **`LaunchSpec(script, interactive, environment)`** — the rendered result the command registry runs.

Usage:

```java
LaunchSpec spec = CodingAgentFactory.ofType(AgentType.CLAUDE)
    .mcpServer("repository", McpServers.httpMcp(scopedUrl))
    .allowedTools(READ_ONLY_REPOSITORY_TOOLS)
    .initialContext(seed)    // optional
    .skipPermissions()       // optional
    .start();                // or .run(prompt)
```

**The agent code path.** "Spawn Claude with an MCP server" is no longer an action. `AgentLaunchService`
(`@ApplicationScoped`) owns the MCP scope→URL construction (read-only allowlists, `?repositoryId=` /
`?projectId=` query params, UUID validation — moved out of `ActionResolutionService`), builds the
launch via the factory, and spawns it as a `Command`. It is exposed at
`POST /api/repositories/{repoId}/workspaces/{workspaceId}/agents` (`AgentController`) with an
`AgentMcpScope` (`ACTIONS` / `REPOSITORY` / `PROJECT`) and an optional `initialContext`. The three
"Configure … with Claude" UI buttons call this instead of launching a seeded action.

**`ActionVariant` removed.** Deleted the enum and the `variant` column from both action tables; actions
are plain shell scripts (their `executeScript` runs verbatim). The seeded "Claude Code" action now
renders its `exec claude` script through the builder too, so no hand-written `claude` string remains
anywhere.

**`ResolveConflictService` migrated.** It no longer hand-writes a `claude` script, writes
`.qits/resolve-prompt.md`, or creates a reusable "Resolve merge conflict" action. It forks the
resolution workspace and composes the (injection-fenced) prompt in one committed transaction, then
spawns an autonomous run via `AgentLaunchService.launchAutonomous(...)` and returns the spawned
`commandId`. The prompt-injection defenses (`composePrompt` / `sanitizeSubject`) are unchanged and now
travel inside the command line.

## Key files

- `domain/agent/control/` — `CodingAgent`, `ClaudeCodeAgent`, `CodingAgentFactory`, `AgentType`,
  `AgentMcpScope`, `McpServers`, `LaunchSpec`, `AgentLaunchService`.
- `service/…/domain/agent/api/AgentController.java` — the agent endpoint.
- `domain/command/control/CommandService.java` — `launchAgent(...)` + a shared launch descriptor;
  `CommandLifecycleService` / `Command.actionId` now nullable (agent runs have no action).
- `domain/featureflow/…` — `ActionVariant` deleted; `AbstractActionDefinition`, the action services,
  DTO, controller and MCP tools lost `variant`; `ActionResolutionService` reduced to plain resolution.
- `domain/repository/control/ResolveConflictService.java` — routed through the agent path.
- Frontend: variant picker removed from the action form; the Configure-with-Claude buttons
  (`repository-detail`, `project-detail`, `branch-list`) call the agents endpoint; the resolve flow
  navigates to the returned command's terminal.

## Migrations

- **V11** — drop the `variant` column from `action_configuration` and `repository_action`; make
  `command.action_id` nullable.
- **V12** — widen `command.execute_script` to a CLOB (`@Lob`), because an agent launch embeds its
  prompt in the command line and the rendered script can be long.

## Testing / verification

- `CodingAgentFactoryTest` — pure-renderer unit tests: exact interactive/print scripts, Jackson MCP
  JSON, merged allowlist across servers, direct prompt embedding, and POSIX shell-escaping.
- `AgentLaunchServiceTest` — each `AgentMcpScope` → correct scoped URL + read-only allowlist; non-UUID
  ids rejected.
- `AgentControllerTest` — endpoint wiring + validation.
- `ResolveConflictServiceTest` — asserts the composed prompt is embedded in the launched command's
  `executeScript`, the injection fence survives inside the command line, and each resolution spawns its
  own command.
- Full `./mvnw clean test` green (domain, service, cli); OpenAPI regenerated (`docs/openapi.yml`), the
  Angular client regenerated (`pnpm generate:api`), `ng build` + `ng lint` clean.
