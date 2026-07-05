# Workspace history — soft-deleted workspaces with resolution state

## Introduction

Workspaces are always created *for a reason* and *with a goal*, and they end in one of a few ways
(integrated, cleaned up, abandoned). Today that whole story is thrown away: `WorkspaceService`'s
`doDiscard` runs `workspaceRepository.delete(workspace)` (WorkspaceService.java:697), so the moment a
branch is done its row — and any intent/outcome we might attach to it — is gone. The on-disk workspace
and branch are also removed, which is correct; the mistake is destroying the *record*.

This feature **soft-deletes workspaces instead of hard-deleting them**: a workspace gets a resolution
**status** enum and keeps its DB row when it's "deleted". The filesystem workspace and the git branch are
still removed (deletion still means deletion *on disk*), but the row persists as a durable record of the
unit of work — carrying a markdown **preamble** (the reason/goal) and **result** (the outcome), a
**timeline of events**, and — via the existing `Command.workspace` FK — the **commands that ran in it**.
This is browsable from the repository UI as a history.

Related / dependent plans:
- Reworks the workspace lifecycle in `repository.control.WorkspaceService` (`createWorkspace`,
  `mergeWorkspace`/`mergeBranch`, `cleanupBranch`, `discardWorkspace`, and the `doDiscard` mechanics) and
  the `RepositoryDiscoveryService` reconciliation.
- Makes the command-execution model ([command-registry](../features/2026-06-30_command-registry.md) and
  siblings) whole: `Command` already FKs the `Workspace` row and snapshots branch/commit. Because the row
  now persists, those commands stay associated with the workspace forever and are listed in its history.
  No change to the command schema is needed — the existing non-null FK is correct now that the row is
  never deleted.
- `repository.control.ResolveConflictService` creates resolution workspaces, which should seed a
  preamble.

## Problem

- A workspace's **intent** (why it exists, what "done" means) and **outcome** (merged where? abandoned
  why?) are never captured.
- The `Workspace` row is **hard-deleted** on cleanup/discard, so there is no history of the changes that
  flowed through a repository, and the commands that ran in it lose their anchor.

## Goal

Stop deleting workspace rows. A `Workspace` becomes the persistent record of a unit of work, with:

- a **status** (`ACTIVE`, `INTEGRATED`, `ABANDONED`) tracking its resolution;
- a **preamble** (markdown) — the reason/goal, authored at creation, editable while `ACTIVE`;
- a **result** (markdown) — the outcome, authored at integration/cleanup or abandonment;
- a **timeline of events** (created, integrated, cleaned-up, abandoned, …) with timestamps and
  branch/parent/target/commit context;
- its **associated commands** (already linked by `Command.workspace`), shown in the history;
- `createdAt` / `resolvedAt` timestamps.

Active workspaces still drive the branch tree; resolved ones live on in a browsable history.

## Conventions to mirror

- **Entity**: `Workspace` is Panache active-record (public fields, surrogate `Long id`, business key
  `workspaceId`). Add the new columns to it. Markdown bodies are large → CLOB / `@Lob`, exactly like
  `command.entity.CommandLogLine.content` (V9). Enums are `@Enumerated(STRING)` with a `check(...)` in
  DDL (e.g. `RepositoryArchetype`).
- **Branches/parents are strings**, not entities — `Workspace.parent` already is one; events snapshot
  branch/target/commit as strings (as `Command` does).
- **Services** are `@ApplicationScoped` + `@Transactional`; the history writes hang off the existing
  `WorkspaceService` transactions so they commit atomically with the lifecycle change.
- **Controllers** under `/repositories/{repoId}/...` with nested request/response records; REST is
  OpenAPI-generated (edit `openapi.yml`, then `pnpm generate:api`).
- **Frontend**: lazy routes in `pages/repositories/repositories.routes.ts`; smart lists in `pattern/`,
  card grids + `z-badge` (`pattern/command/commands-list.component.ts` is a close model); TanStack
  Query keyed by entity arrays. The command **History** list + its terminated→log view is the closest
  precedent for this whole UI.

## Data model

Enrich the **`Workspace`** entity (no separate aggregate needed — the row itself is the record):

- `@Enumerated WorkspaceStatus status` (`ACTIVE`, `INTEGRATED`, `ABANDONED`), default `ACTIVE`;
- `@Lob String preamble` (nullable until authored); `@Lob String result` (nullable until resolved);
- `Instant resolvedAt` (nullable).

New child entity **`WorkspaceEvent`** (timeline; sequence `Long` id like `Workspace`):
- `@ManyToOne Workspace workspace`; `@Enumerated WorkspaceEventType`
  (`CREATED`, `INTEGRATED`, `CLEANED_UP`, `ABANDONED`, `UPDATED_FROM_PARENT`, `RESOLVE_STARTED`, …);
- snapshot context `String branch`, `String parent`, `String target`, `String commit`, `String note`;
  `Instant at`.

Associated commands come for free via the existing `Command.workspace` FK (ordered by `launchedAt`),
each linking to its terminal/log view at `/commands/:commandId`.

Migration **`V10__worktree_history.sql`**: add the `status` (default `ACTIVE`, backfill existing),
`preamble`, `result`, `resolved_at` columns to `workspace`; create `workspace_event` (sequence + table +
FK); **and drop the `(repository_id, workspace_id)` unique constraint** — see below.

### Key consequence: workspace-id reuse

The current `@UniqueConstraint(columnNames = {repository_id, workspace_id})` assumes a workspace id is
deleted before it can be reused. With soft-delete, resolved rows accumulate, so the same id can recur
(e.g. abandon `feat`, later create `feat` again). So:

- **Drop the composite unique constraint.** Enforce instead, in `createWorkspace`, that **no `ACTIVE`
  workspace** already has that id for the repo (`existsActiveByRepositoryAndWorkspaceId`).
- **Runtime lookups resolve the `ACTIVE` row.** `findByRepositoryAndWorkspaceId` (used by the terminal,
  command launch, merge, etc.) must return the active one; resolved rows are history only.
- The on-disk workspace dir is keyed by id, so only one can physically exist at a time anyway — the
  active-only rule matches reality.

## Lifecycle hooks (in `WorkspaceService`, same transaction)

- `createWorkspace(...)` → row created `ACTIVE` + a `CREATED` event. Add an **optional `preamble`**
  parameter the create dialog supplies; programmatic creators pass a default (resolve-conflict:
  "Resolve merge conflict on `<branch>`").
- `mergeWorkspace` / `mergeBranch` → `INTEGRATED` event (record `target` + merge commit). Stays `ACTIVE`
  (the workspace still exists on disk until cleanup).
- `cleanupBranch` → **no longer deletes the row**; sets `status = INTEGRATED`, `resolvedAt`, captures
  **result**, adds a `CLEANED_UP` event, and still removes the on-disk workspace + branch.
- `discardWorkspace` → **no longer deletes the row**; sets `status = ABANDONED`, `resolvedAt`, captures
  **result/reason**, adds an `ABANDONED` event, and still removes the on-disk workspace + branch.
- `doDiscard` becomes "remove from disk + mark resolved" instead of "remove from disk + delete row";
  the resolved status is passed in by the caller (`INTEGRATED` for cleanup, `ABANDONED` for discard).
- `RepositoryDiscoveryService` no longer deletes rows for vanished on-disk workspaces; an `ACTIVE` row
  whose directory disappeared out-of-band should be marked (e.g. `ABANDONED`) rather than removed.

## Frontend

- **Branch tree / workspace list stays as-is** but is now filtered to `ACTIVE` workspaces (the backend
  `listWorkspaces` returns only active ones).
- New repository subroute `repositories/:repoId/history` → a smart list
  (`pattern/repository/workspace-history-list.component.ts`): card grid of all workspaces (active +
  resolved) showing branch, parent, a status **badge** (active/integrated/abandoned), and
  created/resolved timestamps; click → detail.
- `repositories/:repoId/history/:workspaceId` (or by surrogate id, given reuse) → detail page: rendered
  **preamble** and **result** markdown, the **event timeline** (type + context + relative time, gap
  markers like the command log), and an **associated-commands** section (action, status badge, launch
  time, exit code) linking to `/commands/:commandId`. Optionally interleave commands into the timeline
  by `launchedAt` for one unified history.
- Dialog changes in `branch-list.component.ts`: a markdown textarea for **preamble** in the create
  dialog, and for **result** in the integrate and abandon dialogs.
- Needs a markdown renderer — none exists today. v1 can render as a styled whitespace-pre block; a
  follow-up can add a lightweight markdown component.

## REST

- `GET /repositories/{repoId}/history` — all workspaces (active + resolved), newest first.
- `GET /repositories/{repoId}/history/{id}` — one workspace with its event timeline (+ commands).
- `PATCH /repositories/{repoId}/history/{id}` — edit preamble/result markdown.
- Existing create/merge/discard bodies gain an optional markdown field (`preamble` on create, `result`
  on merge & discard) so intent/outcome are captured inline with the action.

## Open questions

- **Naming/route**: history vs journal vs changelog; status values (`ABANDONED` vs `DISCARDED`).
- **Discovered/main workspaces**: do they get a preamble/history too, or is the always-present main
  workspace a minimal/implicit record?
- **Identity in the URL**: `workspaceId` is reusable now, so the history detail route should key on the
  surrogate id (or a slug + id) rather than the workspace id alone.
- **Markdown**: ship a real renderer now or defer (render raw in v1)?

## Verification

1. Create a workspace with a preamble → it's `ACTIVE` in the history with the preamble and a `CREATED`
   event; it still shows in the branch tree.
2. Run a command in it → it appears in the workspace's associated-commands section and links to its log.
3. Integrate + clean up → on-disk workspace and branch are gone, but the row **persists** with
   `status = INTEGRATED`, a result, the timeline, and its commands. (Regression: `cleanupBranch` no
   longer deletes the row, and no FK violation occurs.)
4. Abandon a different workspace with a reason → `status = ABANDONED` + event + result; row persists.
5. Reuse the id of a resolved workspace → `createWorkspace` succeeds (only an `ACTIVE` duplicate is
   rejected); the old resolved row stays in history.
6. Restart the app → history persists; resolved workspaces are not re-created on disk by discovery.
