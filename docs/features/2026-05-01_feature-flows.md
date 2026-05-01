# Feature Flows

## Introduction

**Related / Dependent Plans:**
- [`docs/features/2026-05-01_actions.md`](2026-05-01_actions.md) — Actions are associated with feature-flow *steps* via an `N:N` join that carries ordering and gating metadata.
- [`docs/feature-ideas/feature-flows.md`](../feature-ideas/feature-flows.md) — Future extensions (feature development instances, transition automation) remain in the idea draft.

## Goals

1. Extend `FeatureFlowConfiguration` from a bare referential container into a blueprint for ordered development stages.
2. Introduce `FeatureFlowPhase` to model stages such as *refining → funnel → development → QA → release*.
3. Support hierarchical phases so that a stage (e.g. *development*) can contain nested sub-processes / work-packages.
4. Introduce `FeatureFlowPhaseStep` as an ordered, named container of actions within a phase — enabling logical groupings such as "lint" that contain multiple concrete actions (e.g. `lint-frontend`, `lint-backend`).
5. Provide a quality-gate mechanism per phase: an ordered set of mandatory actions that must pass before the phase can transition.
6. Support parallel execution hints via an optional `parallelGroup` on action links.

## Non-Goals

1. Actual execution of actions or enforcement of quality gates at runtime.
2. Transition rules / automation between phases.
3. Feature development instances spawned from a configuration.

## Domain Model

### FeatureFlowConfiguration

The root blueprint entity. Owns an ordered list of phases.

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Auto-generated primary key |
| `name` | string | Human-readable name |
| `phases` | list | Ordered top-level phases |

### FeatureFlowPhase

Represents a single stage in the flow. Can be nested via `parentPhase`.

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Auto-generated primary key |
| `name` | string | Phase name |
| `description` | string (optional) | Detailed explanation |
| `orderIndex` | int | Position within the parent scope |
| `featureFlowConfiguration` | ref | Owning flow configuration |
| `parentPhase` | ref (optional) | Parent phase for nested sub-processes |
| `subPhases` | list | Child phases |
| `steps` | list | Ordered action steps within this phase |

### FeatureFlowPhaseStep

An ordered, named step inside a phase. Groups related actions together.

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Auto-generated primary key |
| `name` | string | Step name (e.g. "lint", "test", "e2e") |
| `sortOrder` | int | Position within the phase |
| `phase` | ref | Owning phase |
| `actions` | list | Action links belonging to this step |

### FeatureFlowPhaseAction

Join entity between a step and an `ActionConfiguration`. Adds ordering and gating semantics.

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Auto-generated primary key |
| `step` | ref | The step this link belongs to |
| `actionConfiguration` | ref | The action definition |
| `actionType` | enum | `PREREQUISITE` or `QUALITY_GATE` |
| `sortOrder` | int | Execution order within the step |
| `parallelGroup` | string (optional) | Group identifier for parallelizable actions |

## API Surface

| Resource | Path | Operations |
|----------|------|------------|
| FeatureFlowConfiguration | `/feature-flow-configurations` | CRUD (now returns phase tree with steps) |
| FeatureFlowPhase | `/feature-flow-phases` | CRUD + list by `featureFlowConfigurationId` |
| FeatureFlowPhaseStep | `/feature-flow-phase-steps` | CRUD + list by `phaseId` |
| FeatureFlowPhaseAction | `/feature-flow-phase-actions` | CRUD + list by `stepId` |

## Quality Gate Semantics

- A phase is made up of ordered **steps**. Each step contains ordered actions.
- **Prerequisite** actions are expected to be completed in `sortOrder` before the phase can be considered for transition.
- **Quality Gate** actions are mandatory. All quality-gate actions must pass (in `sortOrder`) for the phase to be considered complete.
- Actions sharing the same `parallelGroup` (within the same step) may be executed concurrently. Sequential actions use a distinct or `null` `parallelGroup`.

## Hierarchical Phases & Steps Example

A *development* phase might look like this:

```
Development
├── Build
│   └── build-project (PREREQUISITE)
├── Lint
│   ├── lint-frontend (PREREQUISITE, parallelGroup: "lint")
│   └── lint-backend  (PREREQUISITE, parallelGroup: "lint")
├── Test
│   └── run-unit-tests (QUALITY_GATE)
└── E2E
    └── run-e2e-suite (QUALITY_GATE)
```

## Hierarchical Phases

A phase can declare a `parentPhase`. This allows modelling complex stages such as *development* containing multiple parallel *work-packages*, each with their own steps and quality gates. The `orderIndex` is scoped to the combination of `featureFlowConfiguration` and `parentPhase`.
