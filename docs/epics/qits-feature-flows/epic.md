# Epic: qits-feature-flows — configurations, phases, actions

## Introduction

The **feature-flow domain**: a `FeatureFlowConfiguration` associated with a
[Project](../qits-projects/epic.md), structured as **phases** that bind **actions** (and steps).
An **action** is a shell-script definition with an accompanying *check* script that decides
whether execution is needed — the standalone action package was **merged into** this domain, so
actions live under `featureflow` as subordinate entities bound to phases via
`FeatureFlowPhaseAction`.

**Builds on [qits-projects](../qits-projects/epic.md)** (a flow is Project-associated, so it can
span every repository in the project) and touches
[qits-project-repositories](../qits-project-repositories/epic.md): actions carry a nullable
`repository_id` (`null` = global, else repository-scoped). Not itself part of the
projects → repositories → workspaces aggregate chain — it is a configuration domain *under* a
project. Retroactive umbrella epic; future feature-flow work lands here.

Related epics / cross-cutting concerns:

- **Run/observed from the [Actions tab](../qits-workspace-detail/epic.md)** — the frontend that
  runs and watches configured actions on the workspace detail route (`workspace-actions-tab`)
  is that epic's; this epic owns the action/flow *definitions*.
- **Agent launches left this model** — [qits-coding-agents](../qits-coding-agents/epic.md): the
  coding-agent harness lifted agent launches *out* of the generic action model (they were an
  `ActionVariant`), so agents are no longer fake "global actions".
- **A deferred gate reads a daemon healthcheck** — [qits-workspace-daemons](../qits-workspace-daemons/epic.md):
  "gate this phase on the dev server being healthy" is the concrete predicate a healthcheck
  provides.
- **Reconciled from `.qits-config`** — [qits-project-repositories](../qits-project-repositories/epic.md):
  a repo's committed config declares repository-scoped actions/daemons that upsert into these
  tables.
- **Action execution runtime** rides the workspace container + the command substrate
  ([qits-workspace-commands](../qits-workspace-commands/epic.md)); the definitions here predate
  that runtime (the original `actions` doc noted execution was "out of scope, needs a missing
  primitive").

## Parts (implemented)

- **[feature-flows](features/2026-05-01_feature-flows.md)** (05-01) — the foundation: the
  `FeatureFlowConfiguration` → phases → actions/steps model, Project-associated; the standalone
  action domain was merged in here.
- **[actions](features/2026-05-01_actions.md)** (05-01) — the **action-configuration** entity: a
  shell-script definition plus a *check* script that determines whether execution is needed
  (subordinate to feature-flow, bound to phases via `FeatureFlowPhaseAction`).
- **[unified-action-scope](features/2026-07-09_unified-action-scope.md)** (07-09) — fold the
  interim two-table split (global `ActionConfiguration` vs `RepositoryAction`) back into one
  `ActionConfiguration` table with a nullable `repository_id`, so a **repository-scoped** action
  can be bound into a feature flow (which the split forbade).

## Done when

Rolling: current when its `feature-ideas/` is empty and every feature-flow/action feature since
this epic's creation has landed here.

## Status

| Part | Status |
|---|---|
| [feature-flows](features/2026-05-01_feature-flows.md) | implemented |
| [actions](features/2026-05-01_actions.md) | implemented |
| [unified-action-scope](features/2026-07-09_unified-action-scope.md) | implemented |
