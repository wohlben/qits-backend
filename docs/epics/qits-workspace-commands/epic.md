# Epic: qits-workspace-commands — persistent, re-attachable command execution

## Introduction

The **command execution substrate**: an app-scoped registry that owns running processes
independent of any WebSocket, so clients can detach and re-attach freely — plus the global
"Commands" navigation over running/terminated processes and the persisted per-line interaction
log. This is the foundation on which every long-running process in qits runs.

**Cross-cutting substrate** (like [qits-technical-processes](../qits-technical-processes/epic.md)),
not part of the projects → repositories → workspaces aggregate chain: it is *consumed by* the
domains that spawn processes. A [daemon](../qits-workspace-daemons/epic.md) **is** a
`CommandSession`; a [coding-agent](../qits-coding-agents/epic.md) `CHAT` **is** a
`CommandSession`. Commands execute via `docker exec` into the per-workspace container, so it
runs *into* [qits-workspaces](../qits-workspaces/epic.md)'
containers (workspace-containers routed all command execution through that seam).

Retroactive umbrella epic; future command-substrate work lands here.

**Scope rule** — this epic owns the **registry, its re-attach model, the global Commands
nav/list, and the persisted interaction log**. It does **not** own the specific process kinds
built on top: daemons ([qits-workspace-daemons](../qits-workspace-daemons/epic.md)), agent chat
([qits-coding-agents](../qits-coding-agents/epic.md)). The workspace-detail route's own tabs
stay in [qits-workspace-detail](../qits-workspace-detail/epic.md); the global Commands left-nav
(Phase 2) is this epic's own surface, not a workspace-detail tab.

## Parts (implemented) — the 3-phase model

- **[command-registry](features/2026-06-30_command-registry.md)** (Phase 1) — the foundation:
  an app-scoped registry that owns processes independent of any WebSocket (`GET /api/commands`,
  the capture tee in `CommandRegistry`/`CommandSession`), so clients detach and re-attach.
- **[command-restore-navigation](features/2026-06-30_command-restore-navigation.md)** (Phase 2)
  — frontend-only: the global "Commands" left-nav, the running/terminated list, and
  click-to-reattach for running ones.
- **[command-audit-logs](features/2026-06-30_command-audit-logs.md)** (Phase 3) — persists the
  full MitM interaction log (every STDIN/OUTPUT line, per-line timestamped) so a terminated
  command can be reopened to review its complete history.

## Done when

Rolling: current when its `feature-ideas/` is empty and every command-substrate feature since
this epic's creation has landed here.

## Status

| Part | Status |
|---|---|
| [command-registry](features/2026-06-30_command-registry.md) | implemented |
| [command-restore-navigation](features/2026-06-30_command-restore-navigation.md) | implemented |
| [command-audit-logs](features/2026-06-30_command-audit-logs.md) | implemented |
