import { DestroyRef, Injectable, inject } from '@angular/core';
import { QueryClient, QueryKey } from '@tanstack/angular-query-experimental';

import { appUrl } from '@/shared/utils/app-base';

/**
 * The app-wide sibling of {@link WorkspaceLiveService} / {@link RepositoryLiveService}: one
 * Server-Sent-Events channel (`/api/events`) for hints that a cross-repository view cares about.
 * Currently just `agent-activity` — a coding agent's rollup flipped in some workspace of some repo —
 * which maps to invalidating the `['workspaces']` PREFIX, so every observed workspace list refetches
 * and the project detail route's per-repository agent-activity bars re-sort live. One connection
 * serves the whole route regardless of how many repositories the project has (deliberately not one
 * repository channel per repo, which would burn a browser connection each).
 *
 * Same sanctioned `EventSource` escape hatch as the siblings (the generated client can't do SSE); a
 * same-origin relative URL through the existing `/api` proxy. Provide it on the page component so it
 * tears down with the route; call {@link connect} once.
 */
@Injectable()
export class GlobalLiveService {
  private readonly queryClient = inject(QueryClient);
  private readonly destroyRef = inject(DestroyRef);

  private source: EventSource | null = null;

  /** Open the global channel and wire hint → invalidation. Idempotent per instance. */
  connect(): void {
    if (this.source || typeof EventSource === 'undefined') {
      // No EventSource under SSR / unit tests — queries just keep their fetch-on-focus defaults.
      return;
    }
    const topics = this.topicKeys();
    const source = new EventSource(appUrl('api/events'));
    this.source = source;

    // On every (re)connect, close the gap from any disconnected window by invalidating everything
    // once — makes the reconnect story trivially correct with no replay protocol.
    source.onopen = () => {
      for (const keys of Object.values(topics)) {
        this.invalidate(keys);
      }
    };

    source.onmessage = (event) => {
      const keys = topics[event.data as keyof typeof topics];
      if (keys) {
        this.invalidate(keys);
      }
      // Unknown topics (e.g. the "ping" heartbeat) are ignored on purpose.
    };

    // EventSource auto-reconnects on transient errors; nothing to do here but let it.

    this.destroyRef.onDestroy(() => {
      source.close();
      this.source = null;
    });
  }

  private invalidate(keys: QueryKey[]): void {
    for (const queryKey of keys) {
      void this.queryClient.invalidateQueries({ queryKey });
    }
  }

  /** Topic → the query keys it invalidates. Keys are prefixes (TanStack partial-matches them). */
  private topicKeys(): Record<string, QueryKey[]> {
    return {
      // Some repo's agent rollup flipped; the hint carries no repo id, so invalidate the prefix —
      // only the lists a mounted view observes actually refetch.
      'agent-activity': [['workspaces']],
    };
  }
}
