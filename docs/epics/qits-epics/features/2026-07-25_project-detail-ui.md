# qits-epics: the project-detail UI (epics section + segmented drill-down)

Part 2 of the [qits-epics epic](../epic.md), **as built**. It surfaces the planning domain from
[part 1](2026-07-25_domain-and-persistence.md) in the Angular UI: an **Epics** section on the
project-detail route (above Repositories) and the segmented **project → epic → feature → task**
drill-down, with create/edit forms, dependency/repository pickers, implemented-markers, and the
epic audit "History" view. With this part the epic's done-when is met.

## Introduction

Related/dependent plans:

- **[domain-and-persistence](2026-07-25_domain-and-persistence.md)** — the REST endpoints this
  consumes, via the generated Angular client (`ProjectEpicsControllerService`,
  `EpicControllerService`, `FeatureControllerService`, `TaskControllerService` and the
  epic/feature/task/audit DTOs). The client was already regenerated in part 1; this part touches
  neither the backend nor `src/app/api/`.
- **Frontend contracts** — `service/src/main/webui/AGENTS.md` and `ROUTING.md`, plus the `rest-api` /
  `create-form` / `create-component` / `screenshot-tests` webui skills. Angular 21, standalone
  components, TanStack Query for all server state, **Signal Forms** for forms.
- **[qits-userflows](../../qits-userflows/epic.md)** — the new `userflows/.../epic/` story chain
  (below) rides the userflow framework.

## What was built

### The Epics section on the project detail page

`pages/projects/project-detail/project-detail.page.ts` renders
`<app-project-epic-list [projectId]>` immediately **above** `<app-project-repository-list>`.
The smart list (`pattern/project/project-epic-list.component.ts`, TanStack key
`['project-epics', projectId]`) carries its own "New Epic" action and empty state, and stacks
`app-epic-card`s — so the project page's action bar did not grow.

### Segmented drill-down routes (project-scoped, as decided)

All in `pages/projects/projects.routes.ts` (lazy `loadComponent`; each level declares the literal
`new` before its `:param` sibling):

```
:projectId/epics/new | :epicId | :epicId/edit
:projectId/epics/:epicId/features/new | :featureId | :featureId/edit
:projectId/epics/:epicId/features/:featureId/tasks/new | :taskId | :taskId/edit
```

The flat id-addressable alternative was not taken — the hierarchy in the URL was the point. Each
detail page is a thin `<app-page-layout [request]>` shell (`pages/projects/{epic,feature,task}-detail/`)
with a dumb `-detail-header` in `#pageTitle`, `pageActions` (Edit / Delete / mark-implemented), and
the child smart list:

- **EpicDetailPage** → header (title, timestamps, Markdown spine via the existing `app-markdown`) +
  `pattern/epic/epic-feature-list` + the audit **History** (`pattern/epic/epic-audit-list`, a
  collapsed native `<details>` over `GET /api/epics/{id}/audit`, rows =
  `ui/components/epic/audit-entry-row` with an operation badge; the JSON `snapshot` is not shown).
- **FeatureDetailPage** → header with `implementedOn` badge + depends-on link (sibling title
  resolved from the shared `['epic-features', epicId]` query) + `pattern/feature/feature-task-list`.
- **TaskDetailPage** → header with `implementedAt` badge, depends-on link, and the bound
  **repository** link to `/repositories/{repositoryId}` (display URL resolved via the shared
  `['repository', id]` query).

Deletes use the native `confirm()` precedent and navigate up one level (task → feature detail,
feature → epic detail, epic → project detail), invalidating the parent list + `['epic-audit', epicId]`.

### Forms (Signal Forms, one form page per entity for create + update)

Three-layer split per entity, mirroring the project form trio: `pages/projects/<x>-form/<x>-form.page.ts`
(edit-mode by presence of the id param) → `pattern/<x>/<x>-create-update-form.component.ts` (smart:
mutations, option queries, invalidation, navigation, inline error box) → `ui/forms/<x>/<x>-form.component.ts`
(dumb Signal Forms shell). Shared inputs in `ui/inputs/epics/`: a Markdown-description textarea, a
dependency `z-select` (leading "None" item; **self is excluded by the smart form**, not the input),
and the repository `z-select` labeled by clone URL (`RepositoryDto` has no name).

Request-mapping rules encoded in the smart forms (PUT is a partial update):

- `''` maps to `undefined` — blank optional fields are never sent.
- Clearing a previously-set dependency sends `clearDependsOn: true` (never both an id and the flag).
- **The repository binding is immutable after create** — `UpdateTaskRequest` has no `repositoryId`,
  so the task form hides the picker in edit mode (the model keeps the current binding so the
  required-validation passes).
- **Mark implemented is a detail-page action**, not a form field: a `pageActions` toggle PUTs
  `implementedOn`/`implementedAt` (full ISO instant — both columns are `Instant`) or the matching
  `clearImplemented*` flag; the badge renders from the refetched entity.
- Backend 400s (dependency cycles, cross-epic/cross-feature edges, cross-project repository) surface
  in an inline error box above the form via the new shared `errorMessage()` helper
  (`shared/utils/error-message.ts`, hoisted from the repository-detail page's local copy).

### Deviations from the idea draft

- **Dumb components live in `ui/components/<entity>/`** (`epic/`, `feature/`, `task/`), not
  `ui/components/project/` as the draft sketched — matching the repo grain (repository cards render
  on project detail but live under `ui/components/repository/`).
- **An epic's description cannot be blanked once set** — `UpdateEpicRequest` has no clear flag
  (title-only PUTs preserve it, but so does an empty textarea). Accepted; a backend clear-flag is a
  follow-up if it ever matters.
- No breadcrumb was added; the detail headers carry the context (revisit if the depth warrants it).

## Query keys

`['project-epics', projectId]`, `['epic', id]`, `['epic-features', epicId]`, `['feature', id]`,
`['feature-tasks', featureId]`, `['task', id]`, `['epic-audit', epicId]` — plus the reused
`['project-repositories', projectId]` and `['repository', id]` (same key + unwrap as their existing
consumers, so caches are shared). Every mutation invalidates its list + detail keys and
`['epic-audit', epicId]`.

## Testing

- **Unit specs** (Vitest): the three smart lists (render/empty/fetch-unwrap), the feature and task
  create-update forms (the clear-flag mapping, repository omitted on update, self-excluded dependency
  options), and the epic/task dumb forms (required title, repository required + picker hidden in
  edit). Note: happy-dom's `tag#id` compound selector misses elements whose id also appears on the
  `app-form-field-layout` host — specs select inputs with `input[id="…"]`.
- **Screenshot specs** (`*.browser.spec.ts`): `epic-card`, `epic-detail-header` (markdown),
  `audit-entry-row` (per-operation badges), `feature-card` (± implemented), `feature-detail-header`,
  `task-card`, `task-detail-header` — baselines committed under `__screenshots__/`.
- **Userflows** — new `userflows/.../epic/` chain: `CreateEpicIT` (→ `CreateProjectIT`) →
  `CreateFeatureIT` → `CreateTaskIT` (also → `CreateRepositoryIT`; picks the repository in the
  `z-select` by URL text) → `MarkTaskImplementedIT` → `DeleteEpicIT` (opens the audit History, then
  deletes; `@UserflowRunsAfter` the mark story). Ordering ripples into the existing chains:
  `DeleteRepositoryIT` gained `@UserflowRunsAfter(DeleteEpicIT.class)` (the epic chain's task binds
  that repository) and `CreateRepositoryIT` became `public` and scopes its View click to
  `app-repository-card` (the epics section above now has View links of its own — the unscoped click
  hit the epic card).
