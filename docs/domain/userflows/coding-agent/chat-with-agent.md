# Chat with Agent

## User Story

As a developer, I want to converse with a running coding agent natively in the application — and reread the conversation later — so that agent work is observable and reviewable without a terminal.

## Builds On

1. `coding-agent/configure-with-claude`

## UI Flow

1. The conversation renders as a transcript: user and assistant turns as markdown-formatted chat bubbles, plus structured rows for **tool calls**, **tool results**, **thinking**, and system events.
2. An event filter lets the user hide categories (tool activity, thinking, system); nothing is hidden by default.
3. The user types follow-up turns; replies stream in as the agent produces them.
4. Navigating away never ends the session (it is a command); returning re-attaches and replays the conversation so far.
5. Once the session finishes, opening the command replays the identical transcript from its persisted log.

## Processes

- `chat-commands-commandId` (socket) — live conversation: attach, replay, send user turns
- `commands-commandId-log` — replay a finished conversation
