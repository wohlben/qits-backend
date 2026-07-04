# Rename the "worktree" domain concept to "workspace"

## Introduction

Planned near-term follow-up to
[disposable workspace containers](../features/2026-07-04_disposable-workspace-containers.md) (§G of the
original idea), which deliberately shipped the lifecycle behaviour (§A–§F) *without* this rename so the
mechanical change stays out of the same diff as behaviour changes. This **will** be done — soon, just
not right now — as a pure, green rename pass over the already-implemented code, with no behaviour
change.

Related:

- **Parent feature**: [disposable-workspace-containers](../features/2026-07-04_disposable-workspace-containers.md)
  — after it, a "worktree" is a branch's isolated working environment in a container, with no host
  git worktree at all, so the name is now actively misleading.
- Touches the same surfaces as [workspace-containers](../features/2026-07-04_workspace-containers.md)
  (the `qits.workspace.*` config, `/workspace` mount and `qits/workspace` image already use the
  target name — the entity is the last thing that doesn't).

## When

Do this soon — once the disposable-container work has settled, and ideally **before** building further
features on top of the worktree entity, so new code is written against `Workspace` from the start
rather than adding to the rename surface. Deferred only to keep the mechanical rename out of the
behaviour diff; it is not optional.

## Why

"Worktree" is a git term for a **host checkout**, and this model no longer has one — the thing is a
branch's isolated working environment (a *workspace*), which the surrounding infrastructure already
calls exactly that: the clone mounts at `/workspace`, the config namespace is `qits.workspace.*`, the
image is `qits/workspace`. Renaming the domain entity to **workspace** makes it match its substrate.
(Rejected: **container** — the domain abstracts the runtime behind `ContainerRuntime` for
podman/remote later, so naming the entity after docker would leak the implementation.)

## How to apply

A broad, mostly-mechanical rename; do it as one focused pass with a green build at the end. Inventory
at the time of writing: ~2,870 case-insensitive occurrences across ~71 Java files, ~58 frontend files,
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
  including the new `…/ensure-container` and `…/stop-container` sub-paths. Regenerate `docs/openapi.yml`
  (run `OpenApiSchemaExportTest`) and the Angular client (`pnpm generate:api`).
- **Container labels & names**: `qits.worktree` label → `qits.workspace`, name prefix `qits-wt-` →
  `qits-ws-`. Because containers are now disposable and recreatable, the cleanest migration is to
  **recreate** on first reconcile after the rename; a one-release back-compat read of the old
  `qits.worktree` label avoids a forced recreate. The `qits.workspace.*` **config** keys are already
  correct and unaffected.
- **MCP tools (breaking)**: `listWorktrees` / `createWorktree` / `listWorktreeDaemons` etc. →
  `listWorkspaces` …; update the read-only allowlist string `mcp__repository__listWorktrees` in
  `AgentLaunchService`.
- **Frontend**: routes (`/worktrees/:worktreeId` → `/workspaces/:workspaceId`), components
  (`worktree-chat`, `worktree-file-browser`, `worktree-prompt-panel`, `branch-row` copy,
  `WorktreeWipPage`, `WorktreeDetailPage` → `workspace-*`), query keys, and copy.
- **Docs**: this file's parent feature docs, `CLAUDE.md`, `AGENTS.md`, `ROUTING.md`, and the
  `docs/domain/userflows/worktree/` directory.
