# Gate workspace operations on a dirty working tree

## Introduction

The daemon reports each workspace's clean/dirty state over the control socket, and qits surfaces it
as a Clean/Dirty badge (see
[daemon-git-status-monitoring](2026-07-24_daemon-git-status-monitoring.md), which introduced the
`WorkspaceGitStatus` SPI, the nullable `WorkspaceDto.clean`, and the `git-status` SSE topic this
feature relies on). Until now that signal was purely informational.

This feature makes it **gate the operations that are unsafe on a dirty tree** — the two-directional
merges (integrate, fast-forward, merge-parent-in), cleanup, and abandon — so a workspace with
uncommitted work can't have it clobbered by a merge or silently discarded by a cleanup/abandon.

Related / dependent plans:

- **Part of [qits-workspace-daemon](../epic.md)** — a direct consumer of the daemon-reported
  working-tree status.
- **Consumes [daemon-git-status-monitoring](2026-07-24_daemon-git-status-monitoring.md)** — the
  `WorkspaceDto.clean` flag (live-refreshed by the `git-status` topic) is the gate.

## What was built

Gating keys off the explicit dirty state only (`clean === false`). `null` (unknown / not RUNNING)
preserves prior behaviour — it never blocks.

### Frontend (`service/src/main/webui`)

- **Cleanup & Abandon hidden when dirty** — `branch-row.component.ts` gains a `dirty` computed
  (`workspace().clean === false`); the Cleanup and Abandon buttons are hidden while dirty (Delete,
  which only appears for workspaceless branches, is unaffected).
- **Merges rerouted to a warning when dirty** — `branch-tree.component.ts` adds a `blockedByDirty`
  output. The Behind-tab action (`runAction`) and the Forward-tab Integrate (`runIntegrate`, now
  threaded the workspace) emit `blockedByDirty` instead of running the merge when the workspace is
  dirty. A plain branch (no workspace) has no working tree and is never blocked.
- **Warning dialog** — `branch-list.component.ts` handles `blockedByDirty` by opening a small
  "Uncommitted changes" dialog: it tells the user the workspace has uncommitted changes to commit or
  discard first, and offers a "Work on it" shortcut into the workspace detail page. The buttons and
  dialog react live because the `git-status` topic already invalidates the workspace list on flip.

### Backend (defense in depth)

A private `WorkspaceService.requireCleanWorkingTree` guard (reusing the existing synchronous
`isWorkspaceClean` `docker exec git status --porcelain` probe — the same source `cleanup` already
gates on) throws `BadRequestException` when the workspace is dirty. It is called at the top of
`fastForwardWorkspace`, `updateWorkspaceFromParent`, `mergeBranch` (on the workspace backing the
source branch, if any), and `discardWorkspace` — so a direct API call can't bypass the UI gate.
Cleanup was already refused server-side. An absent container is treated as clean (nothing
uncommitted to lose), so a stopped workspace is never blocked.

No API surface change (no new endpoint, no DTO change), so no OpenAPI regeneration was needed.

## Testing

- **Backend** — `WorkspaceContainerLifecycleServiceTest` gains guard tests: `fastForwardWorkspace`,
  `updateWorkspaceFromParent`, `mergeBranch`, and `discardWorkspace` throw `BadRequestException` on a
  dirty workspace (an untracked file left in the container), the refused abandon leaves the workspace
  in place, and a clean workspace is abandoned normally.
- **Frontend** — `branch-row.component.spec` asserts Cleanup/Abandon are hidden when dirty and kept
  when clean/unknown; `branch-tree.component.spec` asserts `runAction`/`runIntegrate` emit
  `blockedByDirty` (and do not run the merge) when the workspace is dirty.
