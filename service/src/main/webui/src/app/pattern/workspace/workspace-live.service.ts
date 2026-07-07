import { DestroyRef, Injectable, inject } from '@angular/core';
import { QueryClient, QueryKey } from '@tanstack/angular-query-experimental';

/**
 * Keeps the workspace detail route fresh over one Server-Sent-Events channel instead of eight
 * free-running polls. The backend pushes payload-free topic hints (`daemons`, `daemon-events`,
 * `telemetry`, `commands`); each maps to one or more TanStack Query invalidations, so data keeps
 * flowing through the unchanged REST endpoints — polling becomes fetch-on-signal, and an idle
 * workspace fetches nothing.
 *
 * This is the sanctioned exception to the "no raw fetch/HttpClient in components" rule (like the
 * existing WebSocket code): `EventSource` can't ride the generated API client. It uses a same-origin
 * relative URL, so it goes through the existing `/api` dev proxy with no config change.
 *
 * Provide it on the page component so it tears down with the route; call {@link connect} once.
 */
@Injectable()
export class WorkspaceLiveService {
  private readonly queryClient = inject(QueryClient);
  private readonly destroyRef = inject(DestroyRef);

  private source: EventSource | null = null;

  /** Open the channel for one workspace and wire hint → invalidation. Idempotent per instance. */
  connect(repoId: string, workspaceId: string): void {
    if (this.source || typeof EventSource === 'undefined') {
      // No EventSource under SSR / unit tests — queries just keep their fetch-on-focus defaults.
      return;
    }
    const topics = this.topicKeys(repoId, workspaceId);
    const source = new EventSource(
      `/api/repositories/${encodeURIComponent(repoId)}/workspaces/${encodeURIComponent(workspaceId)}/events`,
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

  /**
   * Topic → the query keys it invalidates. `telemetry` is a single debounced hint that refreshes all
   * four telemetry views. Keys are prefixes: TanStack partial-matches them, so the `spanSort` /
   * `serviceFilter` suffixes on the spans/logs keys don't need enumerating.
   */
  private topicKeys(repoId: string, workspaceId: string): Record<string, QueryKey[]> {
    return {
      daemons: [['workspace-daemons', repoId, workspaceId]],
      'daemon-events': [['workspace-daemon-events', repoId, workspaceId]],
      telemetry: [
        ['telemetry-errors', repoId, workspaceId],
        ['telemetry-spans', repoId, workspaceId],
        ['telemetry-metrics', repoId, workspaceId],
        ['telemetry-logs', repoId, workspaceId],
      ],
      commands: [['commands']],
    };
  }
}
