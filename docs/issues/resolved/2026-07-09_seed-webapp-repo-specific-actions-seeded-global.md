# seed-webapp seeded repository-specific actions (build/lint/test) as GLOBAL

## Introduction

Related plans:

- [unified-action-scope](../../features/2026-07-09_unified-action-scope.md) — the resolution.
- [workspace-actions-tab](../../features/2026-07-09_workspace-actions-tab.md) — the surface that
  exposed it: the effective-actions tab shows every global action in every workspace, so the
  Maven/pnpm commands appeared under repositories they can't run in.
- [feature-flows](../../features/2026-05-01_feature-flows.md) — the structural cause lived in its
  `FeatureFlowPhaseAction` entity.
- [seed-webapp global-action leak](2026-07-09_seed-webapp-leaks-global-actions.md) — the earlier,
  related symptom (duplicates of these same rows).

## Observed

After `seed-webapp`, the global action library contained `build-project` (`./mvnw package`),
`lint-backend` (`./mvnw spotless:check`), `lint-frontend` (`pnpm --dir src/main/webui lint`) and
`run-unit-tests` (`./mvnw test`). Global means "available in every repository" — but these
commands are specific to the Quarkus + Angular fixture repo; in any other repository (different
stack, no Maven wrapper, no pnpm) they are wrong, and they still showed up in every workspace's
Actions tab and Run… picker.

## Cause

Not a wrong argument in the seed — a structural constraint. Scope was a table identity
(`ActionConfiguration` = global vs `repository_action` = repo-scoped), and
`FeatureFlowPhaseAction`'s FK targeted `ActionConfiguration` only, so an action bound into a
feature flow **had** to be global. `seed-webapp` binds the four actions into its "Build & Verify"
blueprint, so it was forced to create them global (`SeedWebappService.ensureGlobalAction`).

## Resolution

The two action entities were merged into one table with a nullable `repository` FK
(`V27__unify_actions.sql`), so flows can bind actions of either scope — see
[unified-action-scope](../../features/2026-07-09_unified-action-scope.md). The seed now creates
the four as repository-scoped and its reset deletes the stale global copies earlier versions left
behind (sparing any a user's flow still binds). Regression:
`SeedWebappServiceTest.resetRescopesSeedActionsAndCleansStaleGlobals`.
