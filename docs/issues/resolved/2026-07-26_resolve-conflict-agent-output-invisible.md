# Resolve-merge-conflict run showed no agent output while it worked

- **Date:** 2026-07-26
- **Status:** Resolved 2026-07-26
- **Area:** `domain` — `agent.control.AgentLaunchService` / `repository.control.ResolveConflictService`; surfaced on the command page (`/commands/{id}`) opened by the repository detail route's resolve-conflict shortcut

## Introduction / related plans

- The agent code path the resolve flow rides: `docs/epics/qits-coding-agents/features/2026-07-01_coding-agent-harness.md`
- The chat pipeline it now reuses: `docs/epics/qits-coding-agents/features/2026-07-01_stream-json-chat.md`
- The fetch-model prompt delivery (`taskPrompt` bootstrap) that stays unchanged: `docs/epics/qits-coding-agents/feature-ideas/mcp-task-prompt-delivery.md`
- Userflow describing the feature: `docs/domain/userflows/workspace/resolve-merge-conflicts.md`

## Observed

Using the resolve-conflict shortcut on the repository detail route correctly forked the
`<workspace>-resolve` workspace and started the agent session (branch created, command row present,
the command page opened) — but the page showed nothing of what the agent said or did for the whole
run. The session looked broken even though the agent was working.

## Cause

`AgentLaunchService.launchAutonomous` rendered the run as a one-shot **`claude -p '<bootstrap>'`**
print run (kind `TERMINAL`). In print mode Claude writes **only the final result text at exit** —
there is no incremental stdout while the turn runs. So the terminal the UI attached to was silent
until the very end (and a long resolution can run many minutes), and the "conversation" was never
structured anyway: even the final blob was one flat print, not the chat frame's per-message stream.

## Fix

Rewired the autonomous launch onto the existing **chat pipeline** instead of fixing terminal
streaming — the option that reuses everything the chat frame already does:

- `launchAutonomous` now spawns the run exactly like `launchChat` (kind `CHAT`, stream-json over
  pipes, live transcript tail, chat exit sweep), with the `TASK_PROMPT_BOOTSTRAP` sent as the first
  stdin turn instead of the `-p` argv. The command page's existing kind switch then renders
  `app-command-chat` — the live conversation — with no frontend change (the resolve mutation already
  navigated to `/commands/{id}`).
- The autonomous-specific hardening is kept: the scoped repository MCP server stays
  **read-only-marked** (`agentReadOnly=true`, for Kimi via a new read-only variant of the ACP
  session config), and `--dangerously-skip-permissions` still applies. `renderAutonomous` became
  `renderAutonomousChat`.
- The launch also gained chat's container + sign-in gate: an unauthenticated volume now redirects to
  the sign-in REPL instead of dying silently.
- A human can now follow up in the same session once the autonomous turn finishes — the chat input
  is live on the same page.
- The composed prompt additionally closes with an explicit goal: *"If you can resolve the conflict
  fully on your own, do commit and push the resolution."*

Code: `domain/src/main/java/eu/wohlben/qits/domain/agent/control/AgentLaunchService.java`,
`domain/src/main/java/eu/wohlben/qits/domain/repository/control/ResolveConflictService.java`.

## Regression tests

- `ResolveConflictServiceTest.resolveForksAWorkspacePersistsThePromptAsItsDraftAndLaunchesAFetchRun`
  now asserts the launched command is kind `CHAT`, carries the stream-json chat script (read-only
  marked, workspace-narrowed MCP), and that the draft prompt ends with the commit-and-push
  instruction.
- `AgentLaunchServiceTest` — `renderAutonomousChat` renders a chat (bootstrap not in argv), still
  read-only marks only the autonomous run.
- `AgentLaunchServiceKimiTest` — `renderAutonomousChatUsesKimiAcp` (a plain `exec kimi acp`, no
  mcp.json, bootstrap not in argv) and `acpSessionConfigReadOnlyMarksServerUrls` (the read-only ACP
  session config keeps `taskPrompt` while marking every server URL `agentReadOnly=true`).
