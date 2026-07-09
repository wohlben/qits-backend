# seed-webapp leaks four global ActionConfigurations per run — "idempotent by reset" doesn't hold for them

## Introduction

Related plans:

- [seed-webapp / servable fixture](../../features/2026-07-05_servable-quarkus-angular-fixture.md) —
  the command whose reset contract is broken.
- [workspace-actions-tab](../../features/2026-07-09_workspace-actions-tab.md) — the surface that
  exposed it: the new effective-actions endpoint/tab lists every global action, so the
  duplicates are now user-visible on every workspace.
- [actions](../../features/2026-05-01_actions.md) / [feature-flows](../../features/2026-05-01_feature-flows.md)
  — global `ActionConfiguration` is deliberately project-independent, which is exactly why the
  project-cascade reset misses it.

## Observed

On a long-lived `~/.qits` H2 file, after N `seed-webapp` runs:

```
GET /api/action-configurations
→ build-project ×14, lint-backend ×14, lint-frontend ×14, run-unit-tests ×14, Bash ×1
```

Every run adds four more. The workspace Actions tab (and the branch-list Run… picker, and
`GET /repositories/{id}/actions`) shows them all.

## Suspected cause

`SeedWebappService.seed()` resets by deleting the prior `"Quarkus + Angular Demo"` project —
that cascades to repositories (and their `RepositoryAction`s, e.g. "Stack info") and to the
project's feature-flow configurations, but **global `ActionConfiguration`s hang off nothing**:
`seedFeatureFlow` (`cli/src/main/java/eu/wohlben/qits/cli/SeedWebappService.java`) calls
`actionConfigurationService.create(...)` four times per run and nothing ever deletes the
previous run's rows. Deleting the flow configuration removes the `FeatureFlowPhaseAction`
join rows, leaving the old globals orphaned but alive.

## Suggested fix direction

In `seedFeatureFlow` (or the reset block), delete-or-reuse by name before creating: look up
existing global actions named `build-project`/`lint-backend`/`lint-frontend`/`run-unit-tests`
and either delete them with the project reset or reuse them (skip-if-exists, like `seed`
does). Reuse-by-name is probably safer — a delete would break any *other* project's flow that
bound them. `ActionConfigurationService` may need a `findByName` for that. Add a regression
test: run `seed()` twice, assert the global action count is unchanged.

## Resolution (2026-07-09)

`SeedWebappService.ensureGlobalAction` now reconciles each seed-owned name instead of blindly
creating: the first same-named global is **updated back to the seeded definition** (script,
description, cleared checkScript/interactive/environment — reset semantics, so drift heals
too), surplus same-named rows are **deleted** (which also cleans up the duplicates leaked by
earlier versions on long-lived DBs), and a surplus row that some other project's flow still
binds is **spared** (the `feature_flow_phase_action` FK has no cascade; deleting it would both
fail and break that flow) — checked via the new
`FeatureFlowPhaseActionService.isActionBound` /
`FeatureFlowPhaseActionRepository.existsByActionConfigurationId`.

Regression test: `SeedWebappServiceTest.resetReconcilesSeedOwnedGlobalActions` — seeds, plants
a drifted unbound duplicate and a flow-bound duplicate, re-seeds, and asserts exactly one
known-good `build-project` remains while the bound `run-unit-tests` copy survives.
