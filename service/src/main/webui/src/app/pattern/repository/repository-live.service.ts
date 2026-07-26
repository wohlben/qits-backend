import { DestroyRef, Injectable, inject } from '@angular/core';
import { QueryClient, QueryKey } from '@tanstack/angular-query-experimental';

import { appUrl } from '@/shared/utils/app-base';

/**
 * The repository-scoped sibling of {@link WorkspaceLiveService}: keeps the repository detail route's
 * active-process discovery fresh over one Server-Sent-Events channel instead of a poll. The backend
 * pushes a payload-free `process` hint when a pull/sync begins or completes; it maps to invalidating
 * `['repository-active-process', repoId]`, so the reattach query refetches (rediscovering a running
 * pull, or clearing it once it finishes) with no polling. The log payload never rides this channel —
 * it rides the technical process's own SSE stream.
 *
 * Same sanctioned `EventSource` escape hatch as the workspace channel (the generated client can't do
 * SSE); a same-origin relative URL through the existing `/api` proxy. Provide it on the component so
 * it tears down with the view; call {@link connect} once.
 */
@Injectable()
export class RepositoryLiveService {
  private readonly queryClient = inject(QueryClient);
  private readonly destroyRef = inject(DestroyRef);

  private source: EventSource | null = null;

  /** Open the channel for one repository and wire hint → invalidation. Idempotent per instance. */
  connect(repoId: string): void {
    if (this.source || typeof EventSource === 'undefined') {
      // No EventSource under SSR / unit tests — queries just keep their fetch-on-focus defaults.
      return;
    }
    const topics = this.topicKeys(repoId);
    const source = new EventSource(
      appUrl(`api/repositories/${encodeURIComponent(repoId)}/events`),
    );
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

  /** Topic → the query keys it invalidates. */
  private topicKeys(repoId: string): Record<string, QueryKey[]> {
    return {
      // A repository pull/sync began or completed: re-fetch the discovery endpoint so the sync bar
      // reattaches to a running process (or re-enables its buttons once it finishes). Payload never
      // rides this channel; the log rides the process's own SSE stream.
      process: [['repository-active-process', repoId]],
      // A workspace's in-container daemon reported its working tree flipped clean↔dirty: re-fetch the
      // branch-tree workspace list so the dirty badge refreshes.
      'git-status': [['workspaces', repoId]],
      // A coding agent's activity rollup flipped in some workspace of this repo (the backend mirrors
      // the workspace-channel hint here): re-fetch the workspace list so the agent-activity bar on
      // the repository detail route re-sorts live.
      'agent-activity': [['workspaces', repoId]],
    };
  }
}
