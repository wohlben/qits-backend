# Unified action scope: one action table, feature flows bind repository-scoped actions

## Introduction

Action scope used to be a **table identity**: global actions were `ActionConfiguration` rows,
repository-scoped ones `RepositoryAction` rows (both subclassing an `AbstractActionDefinition`
mapped superclass), and the `ActionScope` enum was stamped on the DTO by which mapper ran. That
split had a structural consequence: `FeatureFlowPhaseAction`'s FK targeted `ActionConfiguration`
only, so **an action bound into a feature flow was forced to be global** — which is how
`seed-webapp`'s `build-project` / `lint-backend` / `lint-frontend` / `run-unit-tests` (Maven- and
pnpm-specific, i.e. repository-specific commands) ended up polluting every repository's effective
set. This feature merges the two entities into **one `ActionConfiguration` table with a nullable
`repository` FK** (`null` = global), making scope a column instead of a table — flows can now bind
either scope, and the seed's stack-specific actions are repository-scoped where they belong.

Related/dependent plans:

- [actions](2026-05-01_actions.md) — the original single-table `ActionConfiguration`; the
  two-table split (V6) is now folded back in, keeping that doc's shape plus the `repository` FK.
- [feature-flows](2026-05-01_feature-flows.md) — `FeatureFlowPhaseAction` is unchanged
  structurally but its FK now reaches actions of either scope; binding a repository-scoped action
  requires the repository and the flow to share a project.
- [workspace-actions-tab](../../qits-workspace-detail/features/2026-07-09_workspace-actions-tab.md) — the surface that exposed the
  mis-scoping; its effective-actions endpoint and scope badges are unchanged (same DTO wire
  shape).
- [servable-quarkus-angular-fixture](../../qits-testing-fixtures/features/2026-07-05_servable-quarkus-angular-fixture.md) — the
  `seed-webapp` command now seeds its build/lint/test actions repository-scoped.
- Issues resolved:
  [seed-webapp seeded repo-specific actions as global](../../../issues/resolved/2026-07-09_seed-webapp-repo-specific-actions-seeded-global.md),
  and the earlier
  [global-action leak](../../../issues/resolved/2026-07-09_seed-webapp-leaks-global-actions.md) whose
  reconcile helper this supersedes.

## The model

One entity, one table (migration `V27__unify_actions.sql`):

- `ActionConfiguration` absorbs the mapped superclass's fields and gains
  `@ManyToOne @JoinColumn(name = "repository_id") Repository repository` — **`null` means
  global**, set means owned by (and only available in) that repository, cascade-deleted with it
  (`Repository.actions`). One env table (`action_configuration_env`).
- `ActionScope` stays a **derived, never persisted** enum: the MapStruct mapper computes
  `GLOBAL`/`REPOSITORY` from the FK's null-ness. The DTO (`scope` + `repositoryId`), the REST
  paths, the OpenAPI schema and the MCP tool names are all unchanged — no frontend change.
- `RepositoryAction`, its repository/service/mapper and `AbstractActionDefinition` are deleted.
  `ActionConfigurationService` is the single CRUD seam, with the scopes kept strictly apart: the
  plain methods manage the global library (and 404 on repository-scoped ids), the
  `*ForRepository` methods manage one repository's own actions (and 404 across repositories).
- V27 copies `repository_action` (+ env) into the unified table and drops the old tables; ids are
  UUIDs, so no collisions.

## Behavioural changes

- **Feature flows can bind repository-scoped actions.** `FeatureFlowPhaseActionService.create`
  resolves any action row; if it is repository-scoped, the repository's project must equal the
  flow's project (`BadRequestException` otherwise).
- **`ActionResolutionService` is one query**: `effectiveActions(repoId)` =
  `repository is null or repository.id = :repoId` (still a plain union — no name-based
  shadowing), `resolveForRepository` = one lookup + ownership check.
- **Deletion ordering.** The phase-action FK has no cascade, so deleting a repository (which
  cascades its actions) while a flow still binds them would fail. `RepositoryService.delete`
  unbinds the repository's actions first (`deleteBindingsForRepository`), and
  `ProjectService.delete` deletes flow configurations **before** repositories (it was the other
  way around — harmless while flows could only bind globals, an FK violation now).
- **`RepositoryMcpTools.listActions` takes a `repoId`** and lists the repository's *effective*
  non-interactive set instead of globals only — otherwise the now-repo-scoped seed actions would
  be invisible to the agent while `runAction` could still run them. This is the one externally
  visible API change (an MCP tool arg; the OpenAPI surface is untouched).

## Seed

- `seed-webapp` creates `build-project`, `lint-backend`, `lint-frontend`, `run-unit-tests` (and
  the existing `Stack info`) as **repository-scoped** actions and binds the four into the
  "Build & Verify" flow. They cascade-delete with the project reset, so the reset needs no
  reconcile bookkeeping anymore (`ensureGlobalAction` is gone); a cleanup pass deletes the stale
  *global* copies earlier seed versions left in long-lived dev databases, sparing any still bound
  by a user's flow.
- The only global action out of the box is **"Bash"**, seeded at startup by
  `ActionConfigurationSeeder` (unchanged mechanism, now matching by global-scoped name).

## Still open / deferred

- A **workspace tier** (`ActionScope.WORKSPACE`) remains deferred (see
  [workspace-actions-tab](../../qits-workspace-detail/features/2026-07-09_workspace-actions-tab.md)); it is now a nullable-FK/column
  addition rather than a third parallel entity stack.
- The flow-detail UI's action picker still fetches `GET /action-configurations` (globals only) —
  repository-scoped actions are bindable via the API but not pickable in that UI yet (see
  `docs/backlog.md`).

## Testing

- `ActionResolutionServiceTest` — union correctness (globals + own repo, excludes other repos),
  repo-scoped resolve + cross-repo `NotFound`.
- `FeatureFlowPhaseActionServiceTest` — binds a repo-scoped action (same project OK,
  cross-project `BadRequest`).
- `SeedWebappServiceTest.resetRescopesSeedActionsAndCleansStaleGlobals` — the four actions exist
  exactly once, repository-scoped; stale globals deleted; flow-bound copies spared. The
  seed-twice test also regression-covers the `ProjectService` delete-ordering fix.
- `RepositoryActionsControllerTest` / `RepositoryMcpToolsTest` — wire-level scope badges and the
  effective `listActions(repoId)`.
- `docs/openapi.yml` regenerated with no diff; `generate-migration` reports "No schema changes"
  after V27.
