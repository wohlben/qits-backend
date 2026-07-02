# Review Command Audit Log

## User Story

As a developer, I want to review the complete interaction history of a finished command — what was typed, what came back, and when — so that past runs are auditable and debuggable after the fact.

## Builds On

1. `command/run-action-in-worktree`

## UI Flow

1. Opening a finished command (from the Commands history or from a worktree's record) shows its persisted log instead of a live view.
2. Terminal commands render as a read-only terminal: output with its original formatting and colors, user input lines visibly marked as such.
3. Long pauses between lines are visualized as gap markers, so idle time is distinguishable from continuous output.
4. Finished *chat* commands replay as the same conversation view they showed live (see `coding-agent/chat-with-agent`).

## Processes

- `commands-commandId-log` — the per-line, per-channel, timestamped audit log
