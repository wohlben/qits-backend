# Rename the "worktree" domain concept to "workspace"

## Introduction

Implemented follow-up to
[disposable workspace containers](2026-07-04_disposable-workspace-containers.md) (§G of the
original idea), which deliberately shipped the lifecycle behaviour (§A–§F) *without* this rename so the
mechanical change stayed out of the same diff as behaviour changes. Done as a pure, green rename pass
over the already-implemented code, with no behaviour change.

Related:

- **Parent feature**: [disposable-workspace-containers](2026-07-04_disposable-workspace-containers.md)
  — after it, a "workspace" is a branch's isolated working environment in a container, with no host
  git worktree at all, so the old "worktree" name had become actively misleading.
- Touches the same surfaces as [workspace-containers](2026-07-04_workspace-containers.md)
  (the `qits.workspace.*` config, `/workspace` mount and `qits/workspace` image already used the
  target name — the entity was the last thing that didn't).

## Why

"Worktree" is a git term for a **host checkout**, and this model no longer has one — the thing is a
branch's isolated working environment (a *workspace*), which the surrounding infrastructure already
called exactly that: the clone mounts at `/workspace`, the config namespace is `qits.workspace.*`, the
image is `qits/workspace`. Renaming the domain entity to **workspace** makes it match its substrate.
(Rejected: **container** — the domain abstracts the runtime behind `ContainerRuntime` for
podman/remote later, so naming the entity after docker would leak the implementation.)

## What was renamed

A broad, mostly-mechanical rename done as one focused pass with a green build at the end. Inventory at
the time of writing: ~2,870 case-insensitive occurrences across ~71 Java files, ~58 frontend files,
8 Flyway migrations, 2 MCP tool files, and ~55 docs.

- **Domain**: `Worktree` → `Workspace`, and `WorktreeService` / `WorktreeRepository` / `WorktreeDto` /
  `WorktreeMapper` / `WorktreeMetadata` / `WorktreeStatus` / `WorktreeRuntimeStatus` /
  `WorktreeEvent(Type)` / `WorktreeFilesService` / `WorktreeHistoryService` / `WorktreeFileAccess` →
  `Workspace*`. Method and variable names (`worktreeId` → `workspaceId`, `createWorktree` →
  `createWorkspace`, `ensureContainer` stays, …).
- **Persistence / DB**: a new Flyway migration renaming tables `worktree` / `worktree_event` →
  `workspace` / `workspace_event` (and FK/column refs: `command.worktree_id_fk`,
  `daemon_event.worktree_id`, the `runtime_status`/`runtime_error` columns move with the table) via
  `ALTER TABLE … RENAME`. H2 everywhere, so it's clean and lossless. Migrations are append-only — a
  new `V22`, not edits to V1–V21.
- **REST (breaking)**: `/repositories/{repoId}/worktrees/{worktreeId}` → `…/workspaces/{workspaceId}`,
  including the `…/ensure-container` and `…/stop-container` sub-paths. Regenerate `docs/openapi.yml`
  (run `OpenApiSchemaExportTest`) and the Angular client (`pnpm generate:api`).
- **Container labels & names**: `qits.worktree` label → `qits.workspace`, name prefix `qits-wt-` →
  `qits-ws-`. Because containers are disposable and recreatable, the cleanest migration is to
  **recreate** on first reconcile after the rename; a one-release back-compat read of the old
  `qits.worktree` label avoids a forced recreate. The `qits.workspace.*` **config** keys were already
  correct and unaffected.
- **MCP tools (breaking)**: `listWorktrees` / `createWorktree` / `listWorktreeDaemons` etc. →
  `listWorkspaces` …; update the read-only allowlist string `mcp__repository__listWorktrees` in
  `AgentLaunchService`.
- **Frontend**: routes (`/worktrees/:worktreeId` → `/workspaces/:workspaceId`), components
  (`worktree-chat`, `worktree-file-browser`, `worktree-prompt-panel`, `branch-row` copy,
  `WorktreeWipPage`, `WorktreeDetailPage` → `workspace-*`), query keys, and copy.
- **Docs**: this file's parent feature docs, `CLAUDE.md`, `AGENTS.md`, `ROUTING.md`, and the
  `docs/domain/userflows/workspace/` directory (renamed from `docs/domain/userflows/worktree/`).
