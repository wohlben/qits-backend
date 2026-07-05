# Monitor and Re-attach

## User Story

As a developer, I want to see everything that is running (or has run) across all repositories and jump back into any running process as if I never left, so that long-running work doesn't chain me to a browser tab.

## Builds On

1. `command/run-action-in-workspace`

## UI Flow

1. The global **Commands** navigation entry lists all commands, split into **Running** and **History**.
2. Each entry shows what and where: action or agent name, status, branch and short commit, workspace, launch time, and exit code once finished.
3. Opening a running terminal command re-attaches and replays the scrollback, with output continuing live; opening a running chat command resumes the conversation.
4. Any running command can be **terminated** explicitly from the list or its detail view.
5. Commands that were running when the application restarted are marked *interrupted* rather than silently lost.

## Processes

- `commands` — list running and finished commands
- `commands-commandId` — one command's metadata
- `commands-commandId-terminate` — force-stop a running command
- `terminal-commands-commandId` / `chat-commands-commandId` (sockets) — re-attach
