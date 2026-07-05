# Run Action in Workspace

## User Story

As a developer, I want to run a standardized action inside a workspace and interact with it live, so that routine tasks (shells, builds, dev servers) happen in the isolated change context instead of on my machine.

## Builds On

1. `workspace/propose-change`
2. `action-configuration/manage-actions`

## UI Flow

1. On a workspace row in the repository's branch tree, choose **Run…**.
2. The dialog lists the repository's *interactive* actions (its effective set: global plus repository-scoped).
3. Launching spawns the action as a persistent command and opens a live terminal attached to it.
4. The terminal is fully interactive (keystrokes, resize); leaving the page detaches without stopping the process.

Non-interactive actions are run to completion by the system (for example as feature-flow checks) through the same command mechanism, so they too leave an audit trail.

## Processes

- `commands` — launch an action as a command in a workspace
- `terminal-commands-commandId` (socket) — attach the interactive terminal
