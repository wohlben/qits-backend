# AGENTS.md

This file provides guidance to AI coding agents (Claude Code, Kimi Code, pi, …) when working with code in this repository. `CLAUDE.md` is a symlink to this file.

## Commands

Package manager is **pnpm** (not npm). Angular 21 + standalone components.

- `pnpm start` / `ng serve` — dev server at http://localhost:4200
- `pnpm build` — production build to `dist/`
- `pnpm test` / `ng test` — run unit tests (Vitest via `@angular/build:unit-test`)
- `pnpm test:visual` — run visual-regression "screenshot tests" (`*.browser.spec.ts`, headless Chromium; excluded from `pnpm test`). See `.claude/skills/screenshot-tests/SKILL.md`.
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

All server state goes through `@tanstack/angular-query-experimental` — never raw `HttpClient`/`fetch` in components. Wrap generated service Observables with `lastValueFrom(...)` inside `queryFn`/`mutationFn`. Query keys are arrays, entity-first (`['project', id]`, `['projects']`). Invalidate on mutation success. Full rules in `.claude/skills/rest-api/SKILL.md`.

`app-page-layout` accepts a `[request]` input (any object with `isPending()`/`isError()`/`data()`) and renders pending/error/success states centrally; on success it exposes the data to the `#pageTitle`/`#pageContent` templates via template context. Use this instead of duplicating loading boilerplate (see `pages/projects/project-detail/project-detail.page.ts`).

### Routing conventions

Standard entity pattern: `list` / `new` / `:id` / `:id/edit`, all lazy-loaded from `app.routes.ts`. **`new` and `edit` reuse the same form component** — the form picks POST vs PUT/PATCH based on an optional input. Nested sub-entities (Feature Flow Phases/Steps) use the **builder pattern** inline in the parent detail page rather than their own routes. Full spec in `ROUTING.md`.

## Conventions (enforced by the style guide below + lint)

Highlights:

- **Standalone components only**; never set `standalone: true` (it's the default). Always `ChangeDetectionStrategy.OnPush`.
- `input()`/`output()`/`computed()` functions, never the decorators. `inject()` over constructor injection. Host bindings go in the `host` object, not `@HostBinding`/`@HostListener`.
- **Signal forms** (`@angular/forms/signals`: `form`, `required`, `submit`) — not reactive or template-driven forms.
- State management via `@ngrx/signals` (`signalState` local, `signalStore` shared); mutate with `patchState`. See `.claude/skills/ngrx-signals/SKILL.md`.
- Native control flow (`@if`/`@for`/`@switch`); `class`/`style` bindings, never `ngClass`/`ngStyle`. No globals like `new Date()` in templates.
- Avoid `any` (use `unknown`); strict TS is on. Templates must pass AXE / WCAG AA.
- Local lint rule `qits-local/no-inject-query-client`: use `inject(QueryClient)`, not `injectQueryClient()`.
- **Base-relative URLs, never a hardcoded leading `/api`**: the app must keep working when served under a path prefix (a supervising qits' `/daemon/{ws}/{d}/` web view rebases `<base href>`; see `index.html`). The generated client gets its base via `provideApi(appBasePath())`; raw escape hatches (`EventSource`, `WebSocket`, real anchors) go through `appUrl()`/`wsUrl()` from `@/shared/utils/app-base`.

Path alias: imports use `@/* → src/app/*` throughout (e.g. `@/api/...`, `@/ui/...`, `@/pattern/...`, `@/shared/...`). `tsconfig.json` also defines `$ui/*` and `$pattern/*`, but these are currently unused — prefer `@/*`.

Additional task-specific skills live in `.claude/skills/`: `rest-api`, `ngrx-signals`, `create-form`, `create-component`, `screenshot-tests`.

## Style guide

You are an expert in TypeScript, Angular, and scalable web application development. You write functional, maintainable, performant, and accessible code following Angular and TypeScript best practices.

### Package Manager

Repository uses pnpm as its package manager instead of npm.

### TypeScript Best Practices

- Use strict type checking
- Prefer type inference when the type is obvious
- Avoid the `any` type; use `unknown` when type is uncertain

### Angular Best Practices

- Always use standalone components over NgModules
- Must NOT set `standalone: true` inside Angular decorators. It's the default in Angular v20+.
- Use `@ngrx/signals` for state management (see State Management section)
- Implement lazy loading for feature routes
- Do NOT use the `@HostBinding` and `@HostListener` decorators. Put host bindings inside the `host` object of the `@Component` or `@Directive` decorator instead
- Use `NgOptimizedImage` for all static images.
  - `NgOptimizedImage` does not work for inline base64 images.

### Routing

- All feature routes live under `src/app/pages/` and are lazy-loaded.
- Follow the standard entity route pattern: list, new, `:id`, `:id/edit`.
- Reuse the same form component for create (`new`) and update (`:id/edit`).
- Use the builder pattern for nested sub-entities that do not need top-level routes.
- See [`ROUTING.md`](./ROUTING.md) for the full specification and file structure conventions.

### Page Components

Page-specific conventions live in [`src/app/pages/AGENTS.md`](./src/app/pages/AGENTS.md).

### Forms and Inputs

Form and input conventions live in the following AGENTS.md files:

- **Forms** (`ui/forms/`) — Presentational form components that collect input and emit data.
  See [`src/app/ui/forms/AGENTS.md`](./src/app/ui/forms/AGENTS.md).
- **Inputs** (`ui/inputs/`) — Domain-specific input components that wrap a `FormField` with label, zard-styled control, and error display.
  See [`src/app/ui/inputs/AGENTS.md`](./src/app/ui/inputs/AGENTS.md).

For the shared layout primitive used by both, see `app-form-field-layout` in `src/app/ui/layout/form-field-layout/`.

### Accessibility Requirements

- It MUST pass all AXE checks.
- It MUST follow all WCAG AA minimums, including focus management, color contrast, and ARIA attributes.

### Components

- Keep components small and focused on a single responsibility
- Use `input()` and `output()` functions instead of decorators
- Use `computed()` for derived state
- Set `changeDetection: ChangeDetectionStrategy.OnPush` in `@Component` decorator
- Prefer inline templates for small components
- Prefer Signal forms instead of Reactive or Template-driven ones
- Do NOT use `ngClass`, use `class` bindings instead
- Do NOT use `ngStyle`, use `style` bindings instead
- When using external templates/styles, use paths relative to the component TS file.

### State Management

- Use `@ngrx/signals` for all component and feature state
  - Simple local state: `signalState` (https://ngrx.io/guide/signals/signal-state)
  - Complex or shared state: `signalStore` (https://ngrx.io/guide/signals/signal-store)
- Read the `ngrx-signals` skill before designing state for any component
- Keep state transformations pure and predictable
- Do NOT mutate state directly; use `patchState` or entity helpers

### Templates

- Keep templates simple and avoid complex logic
- Use native control flow (`@if`, `@for`, `@switch`) instead of `*ngIf`, `*ngFor`, `*ngSwitch`
- Use the async pipe to handle observables
- Do not assume globals like (`new Date()`) are available.

### Services

- Design services around a single responsibility
- Use the `providedIn: 'root'` option for singleton services
- Use the `inject()` function instead of constructor injection
