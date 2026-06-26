# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Package manager is **pnpm** (not npm). Angular 21 + standalone components.

- `pnpm start` / `ng serve` — dev server at http://localhost:4200
- `pnpm build` — production build to `dist/`
- `pnpm test` / `ng test` — run unit tests (Vitest via `@angular/build:unit-test`)
- `pnpm test:visual` — run visual-regression "screenshot tests" (`*.browser.spec.ts`, headless Chromium; excluded from `pnpm test`). See `.pi/skills/screenshot-tests/SKILL.md`.
- `pnpm lint` / `ng lint` — ESLint (TS + Angular template rules incl. a11y)
- `pnpm generate:api` — regenerate the typed API client in `src/app/api/` from `openapi.yml`

Run a single test file: `ng test --include='src/app/path/to/file.spec.ts'`. There is no e2e setup.

## Generated API client — do not hand-edit

`src/app/api/` is **fully generated** by openapi-generator from `openapi.yml` (`typescript-angular`). It is git-ignored from lint (`eslint.config.mjs` ignores `src/app/api/**`). Never edit files under `src/app/api/`; change `openapi.yml` and run `pnpm generate:api`. Controller services (e.g. `ProjectControllerService`) and DTO models live here and are imported via the `@/api/...` alias.

## Architecture

This is a CRUD admin UI over a REST backend for managing Projects, Repositories, Feature Flows (with nested Phases/Steps/Actions), and Action Configurations. The codebase enforces a strict **smart/dumb component layering** — read the layer docs before adding code, since each layer has its own `AGENTS.md`.

### Layers (under `src/app/`)

- `api/` — generated typed HTTP client (see above).
- `pages/` — thin, lazy-loaded route shells. One folder per feature, each exporting a `*.routes.ts`. A `.page.ts` composes smart child components and wires router params; it holds no business logic. **Every page wraps `<app-page-layout>`.** See `pages/AGENTS.md`.
- `pattern/` — **smart components**: they fetch data (TanStack Query), mutate (`injectMutation`), and handle user intent. Lists, builders, and create/update forms live here (e.g. `pattern/project/project-list.component.ts`).
- `ui/` — **presentational only**, no services/API/routing:
  - `ui/components/` — display cards, headers, empty states.
  - `ui/forms/` — signal-form shells that emit data via `output()`. See `ui/forms/AGENTS.md`.
  - `ui/inputs/` — domain-specific field wrappers around `app-form-field-layout`. Only create one when a plain text input won't do. See `ui/inputs/AGENTS.md`.
  - `ui/layout/form-field-layout/` — the shared `app-form-field-layout` primitive used by forms and inputs.
- `layout/` — app chrome: `main-layout`, `main-navigation`, `page-layout`, `card-layout`.
- `shared/` — zard UI primitives (`shared/components/`: `z-button`, `z-input`, `z-select`, `z-card`…), utils (`mergeClasses`), core providers/directives, and `dark-mode` service. zard is a shadcn-style local component library (`components.json`); its selectors use the `z`/`zard` prefix.

### Data fetching (TanStack Query, mandatory)

All server state goes through `@tanstack/angular-query-experimental` — never raw `HttpClient`/`fetch` in components. Wrap generated service Observables with `lastValueFrom(...)` inside `queryFn`/`mutationFn`. Query keys are arrays, entity-first (`['project', id]`, `['projects']`). Invalidate on mutation success. Full rules in `.pi/skills/rest-api/SKILL.md`.

`app-page-layout` accepts a `[request]` input (any object with `isPending()`/`isError()`/`data()`) and renders pending/error/success states centrally; on success it exposes the data to the `#pageTitle`/`#pageContent` templates via template context. Use this instead of duplicating loading boilerplate (see `pages/projects/project-detail/project-detail.page.ts`).

### Routing conventions

Standard entity pattern: `list` / `new` / `:id` / `:id/edit`, all lazy-loaded from `app.routes.ts`. **`new` and `edit` reuse the same form component** — the form picks POST vs PUT/PATCH based on an optional input. Nested sub-entities (Feature Flow Phases/Steps) use the **builder pattern** inline in the parent detail page rather than their own routes. Full spec in `ROUTING.md`.

## Conventions (enforced by AGENTS.md + lint)

The root `AGENTS.md` is the authoritative style guide. Highlights:

- **Standalone components only**; never set `standalone: true` (it's the default). Always `ChangeDetectionStrategy.OnPush`.
- `input()`/`output()`/`computed()` functions, never the decorators. `inject()` over constructor injection. Host bindings go in the `host` object, not `@HostBinding`/`@HostListener`.
- **Signal forms** (`@angular/forms/signals`: `form`, `required`, `submit`) — not reactive or template-driven forms.
- State management via `@ngrx/signals` (`signalState` local, `signalStore` shared); mutate with `patchState`. See `.pi/skills/ngrx-signals/SKILL.md`.
- Native control flow (`@if`/`@for`/`@switch`); `class`/`style` bindings, never `ngClass`/`ngStyle`. No globals like `new Date()` in templates.
- Avoid `any` (use `unknown`); strict TS is on. Templates must pass AXE / WCAG AA.
- Local lint rule `qits-local/no-inject-query-client`: use `inject(QueryClient)`, not `injectQueryClient()`.

Path alias: imports use `@/* → src/app/*` throughout (e.g. `@/api/...`, `@/ui/...`, `@/pattern/...`, `@/shared/...`). `tsconfig.json` also defines `$ui/*` and `$pattern/*`, but these are currently unused — prefer `@/*`.

Additional task-specific skills live in `.pi/skills/`: `rest-api`, `ngrx-signals`, `create-form`, `create-component`, `screenshot-tests`.
