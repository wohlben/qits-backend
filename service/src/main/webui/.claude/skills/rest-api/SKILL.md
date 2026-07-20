---
name: rest-api
description: Guidelines for all REST API interactions in this Angular project. Use whenever fetching, mutating, caching, or invalidating server data. Enforces TanStack Query (Angular) exclusively.
---

# REST API

All server state must go through **TanStack Query Angular** (`@tanstack/angular-query-experimental`). Do not write manual `fetch`/`HttpClient` calls inside components without `injectQuery` or `injectMutation`.

> **Docs:** https://tanstack.com/query/v5/docs/framework/angular/overview  
> This package is currently experimental. Lock to a patch version in production.

## Setup

Provide the `QueryClient` in `app.config.ts`:

```ts
import { provideHttpClient } from '@angular/common/http'
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental'
import { withDevtools } from '@tanstack/angular-query-experimental/devtools'

export const appConfig: ApplicationConfig = {
  providers: [
    provideHttpClient(),
    provideTanStackQuery(new QueryClient(), withDevtools()),
  ],
}
```

## Queries

Use `injectQuery` to fetch data. It returns signals for state:

```ts
import { injectQuery } from '@tanstack/angular-query-experimental'
import { lastValueFrom } from 'rxjs'

query = injectQuery(() => ({
  queryKey: ['todos'],
  queryFn: () => lastValueFrom(this.http.get<Todo[]>('/todos')),
}))
```

State signals: `status()`, `data()`, `error()`, `isPending()`, `isError()`, `isSuccess()`, `isFetching()`, `isLoading()`.

## Query Keys

Query keys must be arrays. The first element is the entity, followed by identifiers/filters. Order matters.

```ts
['todos']                           // list
['todos', { status: 'done' }]       // filtered list
['todo', 5]                         // single item
['todo', 5, { preview: true }]      // single item + modifier
```

Avoid objects with keys in different orders for the same query. Always initialize every key segment.

## Query Functions

The `queryFn` receives a context with `queryKey` and an `AbortSignal`. Pass the signal to `fetch`/`axios` for automatic cancellation. Errors must be **thrown**, not returned.

## Query Options

Use `queryOptions` in a service to share config and preserve types:

```ts
post(postId: number) {
  return queryOptions({
    queryKey: ['post', postId],
    queryFn: () => lastValueFrom(this.http.get<Post>(`/posts/${postId}`)),
  })
}

// usage
postQuery = injectQuery(() => this.queries.post(this.postId()))
queryClient.prefetchQuery(this.queries.post(23))
```

## Important Defaults

- `staleTime: 0` — queries are stale immediately and refetch in the background on mount/window-focus/reconnect.
- `gcTime: 5 * 60 * 1000` — inactive queries are garbage-collected after 5 minutes.
- `retry: 3` — failed queries retry 3 times with exponential backoff.
- Server-side `retry` defaults to `0`.

Tune these globally or per-query:

```ts
new QueryClient({
  defaultOptions: {
    queries: { staleTime: 60_000, retry: 1 },
  },
})
```

## Parallel Queries

Multiple `injectQuery` calls run in parallel automatically. For dynamic lists, use `injectQueries`.

## Dependent / Disabled Queries

Delay execution until prerequisites are ready with `enabled: !!this.userId()` or `queryFn: condition ? () => fetch() : skipToken`.

## Paginated Queries

For numbered pages (not infinite scroll), use `placeholderData: keepPreviousData`. Prefetch the next page with `queryClient.prefetchQuery(...)`.

## Infinite Queries

Use `injectInfiniteQuery` for cursor/page-based infinite lists:

```ts
query = injectInfiniteQuery(() => ({
  queryKey: ['projects'],
  queryFn: async ({ pageParam }) =>
    lastValueFrom(this.projectsService.getProjects(pageParam)),
  initialPageParam: 0,
  getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  getPreviousPageParam: (firstPage) => firstPage.prevCursor ?? undefined,
  maxPages: 3,
}))
```

Access pages via `query.data().pages`. Fetch more with `query.fetchNextPage()`.

## Mutations

Use `injectMutation` for writes. Call with `mutation.mutate(todo)`. State signals: `isPending()`, `isError()`, `isSuccess()`, `error()`, `data()`.

Lifecycle callbacks: `onMutate`, `onError`, `onSuccess`, `onSettled`. Invalidate queries in `onSuccess` or `onSettled`.

## Mutation Options

Reuse mutation config with `mutationOptions`:

```ts
updatePost(id: number) {
  return mutationOptions({
    mutationKey: ['updatePost', id],
    mutationFn: (post: Post) => lastValueFrom(this.http.patch(`/posts/${id}`, post)),
    onSuccess: (newPost) => {
      this.queryClient.setQueryData(['post', id], newPost)
    },
  })
}
```

## Query Invalidation

Invalidate queries to trigger refetches after mutations:

```ts
queryClient.invalidateQueries({ queryKey: ['todos'] })          // broad
queryClient.invalidateQueries({ queryKey: ['todos'], exact: true }) // exact match only
queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'todos' })
```

## Optimistic Updates

Update the cache before the mutation finishes and roll back on failure:

```ts
mutation = injectMutation(() => ({
  mutationFn: updateTodo,
  onMutate: async (newTodo, context) => {
    await context.client.cancelQueries({ queryKey: ['todos'] })
    const previous = context.client.getQueryData(['todos'])
    context.client.setQueryData(['todos'], (old) => [...old, newTodo])
    return { previous }
  },
  onError: (err, newTodo, result, context) => {
    context.client.setQueryData(['todos'], result.previous)
  },
  onSettled: (_, __, ___, context) => {
    context.client.invalidateQueries({ queryKey: ['todos'] })
  },
}))
```

## Query Cancellation

Queries receive an `AbortSignal`. Pass it to `fetch`, `axios`, or RxJS `takeUntil`. Cancel manually with `queryClient.cancelQueries({ queryKey: ['todos'] })`.

## Window Focus & Network Refetching

Queries refetch automatically on window focus and reconnect. Disable globally or per-query with `refetchOnWindowFocus: false`.

## Scroll Restoration

Cached queries restore instantly when navigating back. Keep query keys stable across routes.

## Devtools

Enable with `withDevtools()` in the provider. Automatically excluded from production builds. For staging, import from `/devtools/production`.
