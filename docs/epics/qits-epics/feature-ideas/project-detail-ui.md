# qits-epics: the project-detail UI (epics section + segmented drill-down)

## Introduction

Part 2 of the [qits-epics epic](../epic.md). It surfaces the planning domain from
[part 1](domain-and-persistence.md) in the Angular UI: an **Epics** section on the project-detail
route, above Repositories, and the segmented **project → epic → feature → task** drill-down. Depends
on part 1 (the endpoints must exist and be regenerated into the client first).

Related/dependent plans:

- **[domain-and-persistence](domain-and-persistence.md)** — the REST endpoints this consumes. These
  are user-facing (in `docs/openapi.yml`, unlike the hidden artifacts API), so the generated Angular
  client gains `apiProjectsProjectIdEpicsGet`, `EpicDto`, etc.
- **Frontend contracts** — `service/src/main/webui/AGENTS.md` and `ROUTING.md` (routing rules incl.
  the "own route vs inline builder" decision), and the `rest-api` / `ngrx-signals` / `create-form` /
  `create-component` webui skills. Angular 21, standalone components, TanStack Query for all server
  state, `@ngrx/signals` for local state, **Signal Forms** for forms.

## What we build

### An Epics section on the project detail page

`pages/projects/project-detail/project-detail.page.ts` renders its sections as sub-components; the
last line is `<app-project-repository-list [projectId]="projectId" />`. Insert an epics list
**immediately above it**:

```html
<app-project-epic-list [projectId]="projectId" />
<app-project-repository-list [projectId]="projectId" />
```

Following the established smart-list/dumb-card split:

- `pattern/project/project-epic-list.component.ts` — smart list, mirrors
  `project-repository-list.component.ts`: `input.required<string>('projectId')`, a TanStack
  `injectQuery` keyed `['project-epics', projectId]` calling `apiProjectsProjectIdEpicsGet`, `@for`
  over `<app-project-epic-card>` with `<app-empty-state>` fallback, and a "New epic" action
  (`<a z-button [routerLink]="['/projects', projectId, 'epics', 'new']">`).
- `ui/components/project/project-epic-card.component.ts` — dumb card, `input.required<EpicDto>`,
  wraps `<app-card-layout>` (title = epic `title`, maybe a short description preview + counts), with
  a "View" `[routerLink]` into the epic detail route.

### Segmented drill-down routes

The user wants **separate routes**, not an inline builder — so this follows the repositories
drill-down style (its own route configs), **not** the feature-flow phase/step inline-builder style.
Routes are project-scoped and added to `pages/projects/projects.routes.ts` (all `loadComponent`
lazy), so the hierarchy is legible in the URL:

```
:projectId/epics/new                                             EpicFormPage (create)
:projectId/epics/:epicId                                         EpicDetailPage    → lists features
:projectId/epics/:epicId/edit                                    EpicFormPage (update)
:projectId/epics/:epicId/features/new                           FeatureFormPage
:projectId/epics/:epicId/features/:featureId                    FeatureDetailPage → lists tasks
:projectId/epics/:epicId/features/:featureId/edit               FeatureFormPage
:projectId/epics/:epicId/features/:featureId/tasks/new          TaskFormPage
:projectId/epics/:epicId/features/:featureId/tasks/:taskId      TaskDetailPage
:projectId/epics/:epicId/features/:featureId/tasks/:taskId/edit TaskFormPage
```

Each detail page is a thin shell in `pages/projects/<x>-detail/` mirroring
`project-detail.page.ts`/`repository-detail.page.ts`: an `injectQuery` for the entity
(`['epic', epicId]` / `['feature', featureId]` / `['task', taskId]`), an `<app-page-layout [request]>`
wrapper, a `-detail-header` in the `#pageTitle` template (rendering `title` + the long-form
`description` as Markdown), `pageActions` (Edit / Delete / mark-implemented), then a smart child list:

- **EpicDetailPage** → renders the epic spine (Markdown `description`) + `pattern/epic/epic-feature-list.component.ts`.
- **FeatureDetailPage** → feature body + `dependsOn` chip + `implementedOn` badge + `pattern/feature/feature-task-list.component.ts`.
- **TaskDetailPage** → task body + the bound **repository** (link to `/repositories/{repositoryId}`) + `dependsOn` chip + `implementedAt` badge.

The deep URLs are the tradeoff for a fully legible hierarchy. **Alternative** (the repositories/
workspaces precedent): flatten to id-addressable top-level routes (`/epics/:epicId`,
`/features/:featureId`, `/tasks/:taskId`) reached only by navigation, no project prefix — shorter
URLs, but the parent context isn't in the path. *Leaning: project-scoped nesting, since the section
lives on the project and the hierarchy is the whole point; revisit if the URLs get unwieldy.*

### Cross-entity affordances

- **Markdown**: the long-form `description` spine renders as Markdown on every detail page (reuse
  whatever Markdown renderer the app already uses, or add one — flag during build).
- **Dependency pickers**: feature/task forms need a select of sibling features/tasks for
  `dependsOn*` (a `z-select` over the same-epic features / same-feature tasks, excluding self).
- **Repository binding**: the task form binds `repositoryId` via a `z-select` of the project's
  repositories (`apiProjectsProjectIdRepositoriesGet`).
- **Implemented markers**: a toggle/action to set `implementedOn` / `implementedAt`, shown as a badge.
- **Audit view**: an optional "History" affordance on the epic (and/or per entity) reading
  `GET /api/epics/{id}/audit`.
- No breadcrumb component exists today; convey context via the detail headers (or add a small
  breadcrumb if the depth warrants it).

### Forms

Create/edit use **Signal Forms** (mandatory per the `create-form` skill), reusing one `XxxFormPage`
for create and update (the project/repository `:id/edit` precedent). Mutations go through TanStack
`injectMutation` wrapping the generated client, invalidating the relevant list/detail keys on
success.

## Regenerating the client (gotcha)

The generated client under `service/src/main/webui/src/app/api/` is produced by `pnpm generate:api`
from `openapi.yml`. **There are two committed copies of the spec** — `docs/openapi.yml` and
`service/src/main/webui/openapi.yml` — regenerated by `OpenApiSchemaExportTest`; **sync both** before
running `pnpm generate:api`, or the client won't match the backend. The epic/feature/task endpoints
(part 1) must land and be exported first; no `apiProjects*Epics*` method or `EpicDto` exists yet.

## Testing

- **Screenshot tests** (Vitest browser mode, `*.browser.spec.ts`, per the `screenshot-tests` skill)
  for the epics section on project-detail, each detail page, and the empty states.
- A **userflow** (`userflows/` module) walking project → create epic → add feature → add task bound
  to a repository → mark implemented, asserting the drill-down navigation and the rendered spine.
- Component/unit tests for the smart lists (query wiring) and forms (Signal Forms validation:
  required title, dependency select excludes self).
