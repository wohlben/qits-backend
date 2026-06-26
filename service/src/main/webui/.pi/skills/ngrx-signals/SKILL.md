---
name: ngrx-signals
description: Guidelines for state management in Angular components using @ngrx/signals. Use whenever designing component or feature state, deciding between signalState and signalStore, or wiring reactivity.
---

# NgRx Signals State Management

Use `@ngrx/signals` for **all** non-trivial component and feature state. Do not use raw `signal()` / `computed()` for state that spans multiple related values, triggers side effects, or is modified through multiple operations.

> **Docs:**
> - `signalState`: https://ngrx.io/guide/signals/signal-state
> - `signalStore`: https://ngrx.io/guide/signals/signal-store
> - `withState`: https://ngrx.io/guide/signals/with-state
> - `withComputed`: https://ngrx.io/guide/signals/with-computed
> - `withMethods`: https://ngrx.io/guide/signals/with-methods
> - `withHooks`: https://ngrx.io/guide/signals/with-hooks
> - Store Features: https://ngrx.io/guide/signals/store-features
> - RxJS Integration: https://ngrx.io/guide/signals/rxjs-integration
> - Entity Management: https://ngrx.io/guide/signals/entity-management

## Decision: signalState vs signalStore

| Scenario | Use |
|----------|-----|
| Simple local component state (flags, forms, UI toggles) | `signalState` |
| Multiple related values, entity collections, async flows, side effects, or shared state | `signalStore` |

## signalState

A lightweight reactive object for simple component state. Use inside components or small services.

```ts
import { signalState } from '@ngrx/signals';

state = signalState({ count: 0, query: '' });

// Read
this.state.count(); // 0

// Update (must replace entire slice or use patchState)
patchState(this.state, (s) => ({ count: s.count + 1 }));
patchState(this.state, { query: 'foo' });
```

Rules:
- Keep the shape flat and minimal.
- Use `patchState` for all updates; never mutate the state object directly.
- Derive values with `computed(() => ...)` outside the state object if needed.

## signalStore

A typed, composable state container. Use for anything non-trivial.

### Minimal Store

```ts
import { signalStore, withState, withComputed, withMethods } from '@ngrx/signals';

export const UserStore = signalStore(
  withState({ users: [] as User[], loading: false }),
  withComputed((store) => ({
    userCount: computed(() => store.users().length),
  })),
  withMethods((store) => ({
    setLoading: (loading: boolean) => patchState(store, { loading }),
    loadUsers: (users: User[]) => patchState(store, { users, loading: false }),
  }))
);
```

Usage:

```ts
store = inject(UserStore); // provided in root by default

// Template
{{ store.userCount() }}

// Methods
this.store.setLoading(true);
```

### Store with RxJS & Side Effects

Use `rxMethod` for async operations and side effects.

```ts
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { pipe, switchMap, tap } from 'rxjs';

export const UserStore = signalStore(
  withState({ users: [] as User[], loading: false, error: null as string | null }),
  withMethods((store, usersService = inject(UsersService)) => ({
    fetchUsers: rxMethod<void>(
      pipe(
        tap(() => patchState(store, { loading: true, error: null })),
        switchMap(() => usersService.getAll()),
        tap({
          next: (users) => patchState(store, { users, loading: false }),
          error: (err) => patchState(store, { loading: false, error: err.message }),
        })
      )
    ),
  }))
);
```

### Store with Entities

Use `@ngrx/signals/entities` for collection management.

```ts
import { signalStore, withState, withMethods } from '@ngrx/signals';
import { withEntities, setAllEntities, addEntity, updateEntity, removeEntity } from '@ngrx/signals/entities';

export const TodoStore = signalStore(
  withEntities<Todo>(),
  withMethods((store) => ({
    setTodos: (todos: Todo[]) => patchState(store, setAllEntities(todos)),
    addTodo: (todo: Todo) => patchState(store, addEntity(todo)),
    updateTodo: (id: string, changes: Partial<Todo>) =>
      patchState(store, updateEntity({ id, changes })),
    deleteTodo: (id: string) => patchState(store, removeEntity(id)),
  }))
);
```

Entity selectors:
- `store.entities()` — array of all entities
- `store.entitiesMap()` — record by id
- `store.ids()` — array of ids

### Store Hooks

Use `withHooks` for lifecycle side effects.

```ts
import { withHooks } from '@ngrx/signals';

export const UserStore = signalStore(
  withState({ ... }),
  withMethods((store) => ({ ... })),
  withHooks({
    onInit(store) {
      store.fetchUsers();
    },
    onDestroy(store) {
      // cleanup
    },
  })
);
```

## Rules

- **Never mutate state** — always use `patchState` or entity helpers.
- **Keep stores small** — one store per bounded context or feature slice.
- **Use `withComputed` sparingly** — prefer simple `computed()` in components when the derivation is view-only.
- **Side effects belong in `withMethods`** using `rxMethod`, not in components.
- **Provide at the right level** — use `providedIn: 'root'` for global stores; provide locally in component `providers` for local/component-scoped stores.
- **Do NOT mix raw signals and store state** for the same conceptual state. Pick one approach per feature.
- **Type everything** — define explicit interfaces for state shapes and entity types.
