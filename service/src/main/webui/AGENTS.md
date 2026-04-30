# Angular Frontend Conventions

## TypeScript Path Aliases

| Alias | Resolves to | Purpose |
|---|---|---|
| `@/patterns/*` | `src/app/patterns/*` | Smart, data-managing components |
| `@/components/ui/*` | `src/app/components/ui/*` | Custom dumb/display components |
| `@/components/zardui/*` | `src/app/components/zardui/*` | ZardUI managed — do not edit by hand |
| `@/core/*` | `src/app/core/*` | Services, stores, interceptors, config |
| `@/utils/*` | `src/app/utils/*` | Pure utility functions |
| `@/lib/*` | `src/lib/*` | Low-level library helpers (e.g. cn, mergeClasses) |

## Directory Roles

### `patterns/` — Smart components
Components that own their data: fetch from the API, hold state, orchestrate child components. Route-level views belong here too.

### `components/ui/` — Dumb components
Pure display. Receive data via inputs, emit events via outputs. No HTTP calls, no stores.

### `components/zardui/` — ZardUI components
Added and managed by `npx zard-cli add <name>`. Do not edit manually.

### `core/` — Application core
Everything that is `providedIn: 'root'` or registered in `app.config.ts`:
- `core/services/` — HTTP services, data access
- `core/stores/` — Global state (NgRx signals, etc.)
- `core/interceptors/` — HTTP interceptors
- `core/config/` — App-wide configuration, providers

### `utils/` — Utilities
Stateless pure functions. No Angular dependencies.

## Directory Structure — Domain-first, not type-first

Group by **domain/entity**, not by component type. A backend entity `Issue` might produce:

```
patterns/
  issue/
    issue-list.component.ts
    issue-card.component.ts
    issue-form.component.ts

components/ui/
  issue/
    issue-status-badge.component.ts
    issue-priority-icon.component.ts

core/
  services/
    issue.service.ts
  stores/
    issue.store.ts
```

Do **not** dump everything flat under `patterns/` or `components/ui/`. Always create a domain subfolder first.

## Angular Generator Flags

Every component uses **flat format** (no generated subfolder), **inline template**, and **inline styles**:

```bash
ng generate component patterns/issue/issue-list --flat --inline-template --inline-style
ng generate component components/ui/issue/issue-status-badge --flat --inline-template --inline-style
```

Resulting file: `src/app/patterns/issue/issue-list.component.ts` — one file, template and styles co-located inside it.

Services and stores follow the same domain grouping but do not need `--flat` (they are single files by default):

```bash
ng generate service core/services/issue
ng generate store core/stores/issue  # if using NgRx store schematics
```
