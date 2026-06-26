# Frontend Routing Conventions

This document defines the standard patterns for creating routes and page-level components in this Angular application.

## Goals

- **Small Scope**: No gargantuan 1k-line components. Every piece has a single, focused responsibility.
- **Reusability**: Create and update flows share the exact same form component. Detail views compose reusable cards and lists.
- **Smart vs. Dumb**: Routes are thin shells. They embed **smart components** (patterns that hold state, fetch data, and handle user intent) and very rarely instantiate dumb presentational components directly.
- **Consistency**: A predictable URL and file structure makes the codebase navigable and enables code generation.

## Route Location

All top-level feature routes MUST live under:

```
src/app/pages/
```

Each feature gets its own directory. Routes are lazy-loaded from `app.routes.ts`.

## Standard Entity Route Pattern

For a primary UI entity (e.g., `Project`, `Repository`, `FeatureFlow`), the route structure is:

| Route | Purpose | Embedded Component |
|-------|---------|-------------------|
| `/the-entity` | **List** view | `TheEntityListPage` |
| `/the-entity/new` | **Create** view | `TheEntityFormPage` |
| `/the-entity/:id` | **Detail** view | `TheEntityDetailPage` |
| `/the-entity/:id/edit` | **Update** view | `TheEntityFormPage` |

### Reusability Rule: Create === Update

`new` and `edit` MUST use the **same** smart form component:

- `/the-entity/new` renders `<app-the-entity-form />` with **no** `entity` input.
- `/the-entity/:id/edit` renders `<app-the-entity-form [entity]="resolvedEntity" />`.

The form component decides internally whether to call `POST` or `PUT` / `PATCH` based on the presence of the input. This guarantees zero duplication of form fields, validation, or submission logic.

### Detail View & Related Entities

The detail route (`:id`) displays the entity and **all directly related child entities** that reference it.

These related entities are shown as lists or cards. They are **not** routed independently unless they are top-level concerns in their own right. Instead, they are embedded as smart sub-components inside the detail page (see Builder Pattern below).

## Builder Pattern (Nested Sub-Entities)

Some UI concepts span multiple hierarchies and do **not** deserve their own top-level routes. They are managed inline inside a parent detail page.

### When to use it

- The sub-entity cannot meaningfully exist without the parent.
- There is no standalone "list all sub-entities across parents" requirement.
- The user needs to add, remove, or edit a handful of items inside a parent context.

### Pattern

Inside the parent detail page, render a list of sub-entity cards. Each card shows read-only data and provides an action row:

- **Add** → opens the same sub-entity form in "create" mode.
- **Pencil icon** on a card → opens the same sub-entity form in "update" mode, pre-populated with that card's data.
- **Remove** → deletes the sub-entity after confirmation.

The sub-entity form component follows the exact same reusability rule as top-level forms: one component handles both create and update via an optional `@Input()`.

### Example: Feature Flow Phases inside a Feature Flow

```
FeatureFlowDetailPage
├── FeatureFlowHeader (read-only summary)
├── FeatureFlowPhaseList
│   ├── FeatureFlowPhaseCard (read-only)
│   │   └── [Pencil] → opens FeatureFlowPhaseForm (update mode)
│   ├── FeatureFlowPhaseCard
│   └── [Add Phase] → opens FeatureFlowPhaseForm (create mode)
└── FeatureFlowActions
```

`FeatureFlowPhase` has **no** `/feature-flow-phases` route. It is strictly a nested builder inside `/feature-flows/:id`.

## File Structure Example

```
src/app/pages/
└── projects/
    ├── projects.routes.ts          # Lazy-loaded feature routes
    ├── project-list/
    │   └── project-list.page.ts    # Smart: fetches list, renders table
    ├── project-form/
    │   └── project-form.page.ts    # Smart: handles create + update
    ├── project-detail/
    │   └── project-detail.page.ts  # Smart: fetches project + related worktrees
    └── components/
        └── worktree-card/
            └── worktree-card.component.ts   # Dumb presentation (rarely here)
```

## Architectural Rules

1. **Routes are thin**. A `.page.ts` component should primarily compose smart child components and wire router params/outputs. It should not implement business logic inline.
2. **Prefer smart components**. If a component needs data, it fetches it. If it needs to mutate, it calls the API. Presentational components (pure `@Input()` / `@Output()`) live in a shared `ui/` or `components/` library, not inside `pages/`.
3. **Lazy load every feature**. Each folder under `pages/` exports a `Routes` array loaded via `loadChildren` in `app.routes.ts`.
4. **Standalone only**. Page components are standalone. Do not create `NgModule`s for routing.
5. **State inside smart components**. Use `@ngrx/signals` (`signalStore` or `signalState`) for local or shared feature state. Do not hoist transient form state into global stores unless cross-route sharing is required.
6. **No globals in templates**. Do not call `new Date()` or similar inside templates. Derive values via `computed()` or pipe them.

## Component Scope Checklist

Before adding a new route, ask:

- [ ] Does this entity need a standalone list view, or is it only ever used inside a parent?
- [ ] If nested, can I reuse the same form component for create and update?
- [ ] Is my page component under ~150 lines? If not, extract a smart child component.
- [ ] Are related entities shown inline (builder) or routed independently?
- [ ] Is the route lazy-loaded and declared under `src/app/pages/`?
