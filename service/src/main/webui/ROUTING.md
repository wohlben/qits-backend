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

Each feature gets its own directory exporting a `*.routes.ts`, lazy-loaded via `loadChildren` from `app.routes.ts`. Everything renders inside `MainLayoutComponent` (the sidebar shell).

## Current Route Map

| Route | Page | Notes |
|-------|------|-------|
| `/` | `HomePage` | placeholder dashboard |
| `/projects` | `ProjectListPage` | standard entity pattern |
| `/projects/new`, `/projects/:id`, `/projects/:id/edit` | `ProjectFormPage` / `ProjectDetailPage` / `ProjectFormPage` | |
| `/projects/:projectId/repositories/new` | `ProjectRepositoryNewPage` | child created under parent scope |
| `/projects/:projectId/feature-flows/new` | `ProjectFeatureFlowNewPage` | child created under parent scope |
| `/repositories/:repoId` | `RepositoryDetailPage` | drill-down only — no list route |
| `/repositories/:repoId/branch/:branchName/commits` | `BranchCommitsPage` | |
| `/repositories/:repoId/branch/:branchName/commits/:commitHash` | `CommitDetailPage` | optional `?parent=` |
| `/repositories/:repoId/workspaces/:workspaceId` | `WorkspaceDetailPage` | file browser |
| `/repositories/:repoId/workspaces/:workspaceId/wip` | `WorkspaceWipPage` | speak-to-prompt |
| `/repositories/:repoId/history` | `WorkspaceHistoryPage` | |
| `/repositories/:repoId/history/:id` | `WorkspaceHistoryDetailPage` | |
| `/commands` | `CommandListPage` | records, not forms — no `new`/`edit` |
| `/commands/:commandId` | `CommandTerminalPage` | dispatches on command kind + status |
| `/action-configurations` (+ `new`, `:id`, `:id/edit`) | standard entity pattern | secondary nav from Feature Flows |
| `/feature-flows` (+ `:id`, `:id/edit`) | standard entity pattern | create lives under `/projects/:projectId/feature-flows/new` |

Sidebar navigation covers only Home, Projects, Commands, and Feature Flows; everything else is reached by drill-down or secondary nav actions.

## Standard Entity Route Pattern

For a primary UI entity (e.g., `Project`, `ActionConfiguration`), the route structure is:

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

## Established Deviations from the Standard Pattern

These are deliberate, and new routes in the same situations should follow them:

- **Parent-scoped creation**: an entity that only exists under an aggregate gets its create route under the parent (`/projects/:projectId/repositories/new`), not a top-level `new`.
- **Drill-down entities**: entities with no standalone "list all" requirement (repositories, workspaces) have no list route; they are reached from their parent's detail page.
- **Record views**: system-produced records (commands, workspace history) have list + detail routes but no `new`/`edit` — creation happens through domain flows, not forms. Narrative edits (history preamble/result) mutate inline on the detail page.
- **View dispatch inside one route**: `/commands/:commandId` renders a live chat, a chat replay, a live terminal, or a read-only log depending on the command's kind and status. Route on the entity; let the page pick the representation.

## Builder Pattern (Nested Sub-Entities)

Some UI concepts span multiple hierarchies and do **not** deserve their own top-level routes. They are managed inline inside a parent detail page.

### When to use it

- The sub-entity cannot meaningfully exist without the parent.
- There is no standalone "list all sub-entities across parents" requirement.
- The user needs to add, remove, or edit a handful of items inside a parent context.

### Pattern

Inside the parent detail page, render a list of sub-entity cards. Each card shows read-only data and provides an action row:

- **Add** → opens the same sub-entity form in "create" mode.
- **Edit** on a card → switches that card's surface into edit mode.
- **Remove** → deletes the sub-entity after confirmation.

The sub-entity form/edit surface follows the exact same reusability rule as top-level forms: one component handles both create and update via an optional `input()`.

### Example: Feature Flow Phases inside a Feature Flow

```
FeatureFlowDetailPage
└── FeatureFlowPhaseBuilderComponent            (pattern/feature-flow/)
    ├── FeatureFlowPhaseCardComponent           (read mode ⇄ one edit mode per phase)
    │   ├── FeatureFlowStepBuilderComponent     (steps editable while phase is in edit mode)
    │   └── FeatureFlowStepCardComponent
    └── [Add Phase] → new card directly in edit mode
```

`FeatureFlowPhase` has **no** `/feature-flow-phases` route. It is strictly a nested builder inside `/feature-flows/:id`. Note the UX rule from the domain docs: there is a **single edit mode per phase** — steps and actions inherit editability from the parent phase, never their own toggles.

## File Structure Example

Pages are thin shells; the smart components they embed live in `pattern/`, presentational pieces in `ui/` (see `CLAUDE.md` for the full layering):

```
src/app/
├── pages/
│   └── projects/
│       ├── projects.routes.ts             # Lazy-loaded feature routes
│       ├── project-list/
│       │   └── project-list.page.ts       # Thin shell around <app-project-list>
│       ├── project-form/
│       │   └── project-form.page.ts       # Thin shell; create + update
│       └── project-detail/
│           └── project-detail.page.ts     # Thin shell; composes smart children
├── pattern/
│   └── project/
│       ├── project-list.component.ts      # Smart: fetches list (TanStack Query)
│       └── project-create-update-form.component.ts  # Smart: POST/PUT
└── ui/
    └── components/
        └── repository/
            └── repository-card.component.ts  # Dumb presentation
```

## Architectural Rules

1. **Routes are thin**. A `.page.ts` component should primarily compose smart child components and wire router params/outputs. It should not implement business logic inline. Every page wraps `<app-page-layout>` (which also centralizes query pending/error states via its `[request]` input).
2. **Prefer smart components**. If a component needs data, it fetches it. If it needs to mutate, it calls the API. Smart components live in `pattern/`; presentational components (pure `input()` / `output()`) live in `ui/`, not inside `pages/`.
3. **Lazy load every feature**. Each folder under `pages/` exports a `Routes` array loaded via `loadChildren` in `app.routes.ts`.
4. **Standalone only**. Page components are standalone. Do not create `NgModule`s for routing.
5. **State inside smart components**. Use `@ngrx/signals` (`signalStore` or `signalState`) for local or shared feature state; server state goes through TanStack Query keyed by entity arrays. Do not hoist transient form state into global stores unless cross-route sharing is required.
6. **No globals in templates**. Do not call `new Date()` or similar inside templates. Derive values via `computed()` or pipe them.

## Component Scope Checklist

Before adding a new route, ask:

- [ ] Does this entity need a standalone list view, or is it only ever used inside a parent?
- [ ] If nested, can I reuse the same form component for create and update?
- [ ] Is my page component under ~150 lines? If not, extract a smart child component.
- [ ] Are related entities shown inline (builder) or routed independently?
- [ ] Is the route lazy-loaded and declared under `src/app/pages/`?
- [ ] Does one of the established deviations above apply (parent-scoped create, drill-down, record view, view dispatch)?
