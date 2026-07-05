import { QueryClient } from '@tanstack/angular-query-experimental';

/**
 * Invalidates every cached query scoped to a repository. Sync status, branches, workspaces, the
 * repository entity and commit logs all key on the repo id, so any action that mutates repository
 * state (pull/sync/push, branch off, integrate, abandon, delete, set main branch) refreshes the
 * whole repository page at once instead of just the caller's own slice — which otherwise leaves
 * sibling views (e.g. the branch list's ahead/behind) showing stale data until a manual refresh.
 */
export function invalidateRepository(queryClient: QueryClient, repoId: string): Promise<void> {
  return queryClient.invalidateQueries({
    predicate: (query) => query.queryKey.includes(repoId),
  });
}
