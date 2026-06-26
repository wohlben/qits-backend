
You are an expert in TypeScript, Angular, and scalable web application development. You write functional, maintainable, performant, and accessible code following Angular and TypeScript best practices.

## Package Manager

Repository uses pnpm as its package manager instead of npm.

## TypeScript Best Practices

- Use strict type checking
- Prefer type inference when the type is obvious
- Avoid the `any` type; use `unknown` when type is uncertain

## Angular Best Practices

- Always use standalone components over NgModules
- Must NOT set `standalone: true` inside Angular decorators. It's the default in Angular v20+.
- Use `@ngrx/signals` for state management (see State Management section)
- Implement lazy loading for feature routes
- Do NOT use the `@HostBinding` and `@HostListener` decorators. Put host bindings inside the `host` object of the `@Component` or `@Directive` decorator instead
- Use `NgOptimizedImage` for all static images.
  - `NgOptimizedImage` does not work for inline base64 images.

## Routing

- All feature routes live under `src/app/pages/` and are lazy-loaded.
- Follow the standard entity route pattern: list, new, `:id`, `:id/edit`.
- Reuse the same form component for create (`new`) and update (`:id/edit`).
- Use the builder pattern for nested sub-entities that do not need top-level routes.
- See [`ROUTING.md`](./ROUTING.md) for the full specification and file structure conventions.

## Page Components

Page-specific conventions live in [`src/app/pages/AGENTS.md`](./src/app/pages/AGENTS.md).

## Forms and Inputs

Form and input conventions live in the following AGENTS.md files:

- **Forms** (`ui/forms/`) — Presentational form components that collect input and emit data.
  See [`src/app/ui/forms/AGENTS.md`](./src/app/ui/forms/AGENTS.md).
- **Inputs** (`ui/inputs/`) — Domain-specific input components that wrap a `FormField` with label, zard-styled control, and error display.
  See [`src/app/ui/inputs/AGENTS.md`](./src/app/ui/inputs/AGENTS.md).

For the shared layout primitive used by both, see `app-form-field-layout` in `src/app/ui/layout/form-field-layout/`.

## Accessibility Requirements

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

## State Management

- Use `@ngrx/signals` for all component and feature state
  - Simple local state: `signalState` (https://ngrx.io/guide/signals/signal-state)
  - Complex or shared state: `signalStore` (https://ngrx.io/guide/signals/signal-store)
- Read the `ngrx-signals` skill before designing state for any component
- Keep state transformations pure and predictable
- Do NOT mutate state directly; use `patchState` or entity helpers

## Templates

- Keep templates simple and avoid complex logic
- Use native control flow (`@if`, `@for`, `@switch`) instead of `*ngIf`, `*ngFor`, `*ngSwitch`
- Use the async pipe to handle observables
- Do not assume globals like (`new Date()`) are available.

## Services

- Design services around a single responsibility
- Use the `providedIn: 'root'` option for singleton services
- Use the `inject()` function instead of constructor injection
