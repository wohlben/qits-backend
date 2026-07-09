# Actions tab: run and observe configured actions from the workspace detail route

## Introduction

Actions are the preconfigured processes a workspace can run — named
`executeScript`s at two tiers (global `ActionConfiguration`, repo-scoped `RepositoryAction`),
merged per repository by `ActionResolutionService.effectiveActions` and executed in the
workspace container via the command registry. But the workspace detail route — the page that
*is* the workspace — has no surface for them: the only UI launcher is the "Run…" dialog on the
repository detail page's branch list, which offers **global interactive actions only**. This
idea adds an **Actions tab** to the workspace detail route: the workspace's effective action
set (both tiers, interactive and not), one-click launch, and the run history/output for this
workspace — making actions a first-class tab alongside Chat, Files, and Daemons.

Related/dependent plans:

- **Hard dependency on [actions](2026-05-01_actions.md)** and the
  [command registry](2026-06-30_command-registry.md): the tab is a new *surface*
  over the existing `ActionResolutionService` + `CommandService.launch` machinery — no new
  execution mechanics.
- **Extends the
  [workspace detail tab consolidation](2026-07-09_workspace-detail-tab-consolidation.md)**
  (+ [draggable tabs](2026-07-09_draggable-workspace-detail-tabs.md)): one more
  `<z-tab>` in the existing group. The drag-reorder persistence merges unknown labels
  gracefully — a new "Actions" tab simply appends for users with a stored order.
- **Reuses the [command audit logs](2026-06-30_command-audit-logs.md)** surface
  (`GET /commands`, `/commands/{id}/log`, terminate) for the run-history half of the tab, and
  the terminal socket / command pages from
  [command restore navigation](2026-06-30_command-restore-navigation.md) for
  interactive runs.
- **Closes a gap the MCP surface already crossed**: `RepositoryMcpTools.listActions`/`runAction`
  and `ActionConfigurationMcpTools` expose the merged effective set (and repo-action CRUD) to
  the agent, but no REST endpoint does — the UI has been the less-capable client. This idea
  adds the missing effective-actions read endpoint.
- **Adjacent to [feature-flows](2026-05-01_feature-flows.md)**: phases bind global
  actions as prerequisites/quality gates. The tab shows and runs the same definitions ad hoc;
  flow-driven orchestration stays out of scope.

## The gap today

- **No workspace-scoped action UI.** The workspace detail route grew Chat, Files, Daemons,
  Web view, Telemetry, and Agents tabs — every runtime concern except the one the action
  domain exists for. Running `mvn test` in a workspace from the UI requires leaving the
  workspace page for the repository branch list.
- **The branch-list "Run…" picker is doubly narrowed.** It fetches
  `GET /action-configurations` (global tier only — repo-scoped actions are invisible to the
  UI, reachable only via MCP) and then filters to `interactive` ones, so non-interactive
  actions (build, lint, test — exactly what `seed-webapp` seeds) have **no UI launcher at
  all**.
- **No effective-actions REST endpoint.** `ActionResolutionService.effectiveActions(repoId)`
  is consumed by MCP and by `CommandService`'s resolution path, but the REST/OpenAPI surface
  never exposes the merged set.
- **No per-workspace run filter.** `Command` stores its `workspace` FK, but
  `GET /commands` filters by `repoId` + `status` only — a workspace-scoped run history
  requires client-side filtering of the whole repo's commands.

## The model: no new entity

No schema change and no migration. Actions stay at their two tiers (per
[actions](2026-05-01_actions.md); `ActionScope` is deliberately open to more tiers
later, but a *workspace* tier is explicitly not this idea — see Explicitly deferred). The
feature is a read surface plus UI over existing rows:

1. **`GET /repositories/{repoId}/actions`** — the effective set, delegating to
   `ActionResolutionService.effectiveActions`. Returns the existing `ActionConfigurationDto`
   shape (it already carries `scope` + `repositoryId`, so global vs repo-scoped renders
   without a new DTO). Nested under repository because that's the resolution scope — the
   workspace only supplies *where runs execute*.
2. **`workspaceId` query param on `GET /commands`** — sibling of the existing `repoId` filter,
   so the tab's run history is a server-side filter instead of a client-side sieve.

## Surface: the tab

A new `<z-tab label="Actions">` in `workspace-detail.page.ts` hosting a new
`app-workspace-actions` pattern component (`pattern/workspace/workspace-actions.component.ts`),
two sections in the Daemons-tab mold (controls above, feed below):

- **Action list** — TanStack Query on `['repository-actions', repoId]` → the new effective
  endpoint. Each row: name, description, scope badge (global / repository), interactive badge,
  and a Run button. Run posts the existing `POST /commands {repoId, workspaceId, actionId}`:
  non-interactive runs stay on the tab (the run appears in the history below); interactive
  runs navigate to the existing command terminal page — same split the codebase already
  enforces at the `Command`/websocket level.
- **Run history** — `['workspace-commands', repoId, workspaceId]` → `GET /commands?workspaceId=…`,
  rendered with the existing command list/log components (status, exit code, expandable log
  via `GET /commands/{id}/log`, terminate button for running ones). One fetch on tab load is
  fine; **freshness after that is push-only** — command status events ride the page's existing
  `WorkspaceLiveService` SSE connection (extending the channel with a command topic if it
  doesn't carry one yet). No polling: the workspace detail page's queries are
  invalidated-by-push by design, and this tab follows suit.
- **Tab indicator** — `'primary'` while any action-launched command in this workspace is
  `RUNNING`, mirroring `chatIndicator`'s pattern (and sharing the page-level commands query
  key so the indicator and the tab body share one cache entry, per the page's established
  convention).
- The branch-list "Run…" dialog is untouched (it remains the multi-workspace launcher), but
  can later switch its fetch to the new effective endpoint to lift its global-only
  restriction — cheap follow-up, not a blocker.

## Seed

`seed-webapp` already creates exactly the fixture this tab wants: Build, Lint (backend +
frontend, parallel-grouped in the flow), and Test global actions against the servable
Quarkus+Angular repo. After seeding, the greeting workspace's Actions tab lists them and "Run"
on Build produces a completed command with its Maven log — no new seed work beyond eyeballing.
`seed-webapp` additionally seeds one repo-scoped `RepositoryAction` ("Stack info",
`./mvnw -q quarkus:info`, via `RepositoryActionService`) so the scope badge and the merged
endpoint are demoed end-to-end; it cascade-deletes with the repository, so the reset-based
idempotency holds.

## Explicitly deferred

- **A workspace tier of actions** (`ActionScope.WORKSPACE`). The tab surfaces the *effective
  repository set in a workspace context*; per-workspace definitions are a new persistence and
  resolution concern. Trigger: a user needs different action sets across workspaces of one
  repository.
- **REST CRUD for `RepositoryAction`** (today MCP-only, no `RepositoryActionController`).
  The tab is read+run; definition management stays on the action-configurations pages and MCP.
  Trigger: editing repo-scoped actions from the UI is actually requested.
- **`checkScript` surfacing** — running the check half and rendering its
  `ActionCheckResult` verdict on the tab. Trigger: feature-flow execution lands and gives
  check results a consumer beyond display.
- **Flow-aware grouping** — badging actions with their feature-flow role
  (prerequisite/quality gate, from `FeatureFlowPhaseAction`). Trigger: flow execution
  surfaces on the workspace route.
- **Auto-provisioning nudge** — a Run against a `STOPPED` workspace already materializes the
  container via the lazy `ensureContainer` path; the tab shows whatever that does through the
  normal command status. No special pre-start UI. Trigger: latency complaints on first run.

## Decisions (were open questions)

- **Endpoint path: repo-nested.** `GET /repositories/{repositoryId}/actions`
  (`RepositoryActionsController`, delegating to `ActionResolutionService.effectiveActions`,
  which now 404s on an unknown repository). The set is workspace-independent by construction;
  a workspace-nested path would have implied a per-workspace set this feature deliberately
  doesn't introduce.
- **Run history scope: all commands, visually distinguished.** The tab lists every command in
  the workspace — chat sessions and daemon runs get an origin badge (`kind`), action runs show
  their `actionName`. A complete "what ran here" audit view is more honest than a filtered one.
  Server-side via the new `workspaceId` query param on `GET /commands` (requires `repoId`,
  since workspace slugs are only unique per repository — 400 otherwise).
- **Command push: the existing SSE `commands` topic — zero new plumbing.** It turned out the
  channel was already fully wired: `CommandLifecycleService` fires `Topic.COMMANDS` on create
  and finish, and `WorkspaceLiveService` maps `commands` → invalidate `['commands']`. The tab's
  history query key (`['commands', repoId, workspaceId]`) sits under that prefix, so TanStack's
  prefix-matching invalidation covers it with no `WorkspaceLiveService` change. The tab never
  polls.
- **Tab indicator source.** `'primary'` while a `RUNNING` `TERMINAL` command exists in this
  workspace, computed from the page's existing `['commands']` query (the one `chatIndicator`
  already reads) — chats and daemons keep their own dots.

## Testing sketch

- **`ActionResolutionService`** already covers the merge; new
  **`RepositoryActionsControllerTest`** (service): effective endpoint returns global + that
  repo's actions with correct `scope`, 404 on unknown repo.
- **`CommandControllerTest` additions**: `workspaceId` filter returns only that workspace's
  commands; combines with `status`.
- **OpenAPI**: regenerate `docs/openapi.yml` (`OpenApiSchemaExportTest`) + frontend client
  (`pnpm generate:api`).
- **Frontend**: `workspace-actions.component.spec.ts` — list renders both scopes with badges,
  Run posts the launch mutation with the route's `repoId`/`workspaceId`, interactive action
  navigates to the terminal route, terminate button on a running row;
  `workspace-detail.page.spec.ts` — Actions tab registered, indicator reflects a running
  command.
- **Manual (devcontainer, docker)**: `seed-webapp` → greeting workspace → Actions tab lists
  Build/Lint×2/Test → Run Build → history row goes RUNNING→SUCCEEDED with the Maven log;
  run against a stopped workspace lazily provisions the container first.
