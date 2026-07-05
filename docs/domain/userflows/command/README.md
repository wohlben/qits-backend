# Command

A command is a process QITS runs inside a workspace — an interactive action in a terminal, a one-off script, or a coding-agent session. The defining property of the domain is that a command's lifetime belongs to the *system*, not to any browser connection: closing the tab, navigating away, or losing the network never kills a running process. Clients attach and detach freely; re-attaching replays what happened while they were away.

Every command is a durable record:

- It snapshots its origin — the workspace, branch, and exact commit it was launched from, and the action (if any) that spawned it.
- It has a **kind**: a *terminal* command (interactive process rendered in a terminal) or a *chat* command (a coding-agent conversation rendered natively — see the coding-agent domain).
- It has a **status**: running, exited (on its own), terminated (by the user), or interrupted (lost to an application restart, reconciled at startup).
- Its entire interaction is captured line by line as an **audit log** — everything the user typed and everything the process emitted, timestamped — persisted independently of the process.

A command ends only by exiting itself or by explicit user termination; there is no automatic cleanup. Because commands reference their workspace, they remain part of that unit of work's history forever (see `workspace/recall-past-work`).

## User Stories

- [Run Action in Workspace](run-action-in-workspace.md)
- [Monitor and Re-attach](monitor-and-reattach.md)
- [Review Command Audit Log](review-command-audit-log.md)
