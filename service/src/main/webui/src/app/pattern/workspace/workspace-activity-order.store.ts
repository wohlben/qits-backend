import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';

import { AgentActivityState } from '@/api/model/agentActivityState';
import type { WorkspaceDto } from '@/api/model/workspaceDto';

/** One workspace's last-observed activity state plus when we first saw it in that state. */
interface ActivityEntry {
  state: AgentActivityState;
  /** Epoch millis of the state's most recent change — the newest-first sort key. */
  changedAt: number;
}

/**
 * Root-scoped ordering memory for the workspace activity bar: it remembers, per workspace, the last
 * {@code WorkspaceDto.agentActivity} state we observed and *when it last changed*, so the bar can lay
 * its buttons out newest-activity-first. A session that just stopped (BUSY → WAITING/IDLE) changed
 * most recently, so it sorts to the far left — matching the "whenever a session stops it goes to the
 * left" behaviour.
 *
 * Root scope is deliberate: switching workspaces remounts the detail page (it reads workspaceId from
 * the route snapshot), so a page-scoped store would forget the order on every navigation. The bar
 * feeds it the workspace list via {@link observe} (SSE keeps that list fresh); the store never touches
 * HTTP.
 *
 * {@code agentActivity} carries no server timestamp, so change times are stamped client-side. Cold
 * start (several workspaces already active on first load) shares one timestamp until each next flips;
 * this is cosmetic for a live-only bar.
 */
export const WorkspaceActivityOrderStore = signalStore(
  { providedIn: 'root' },
  withState({ entries: {} as Record<string, ActivityEntry> }),
  withMethods((store) => ({
    /**
     * Reconcile the memory against the current workspace list: stamp a fresh {@code changedAt} for a
     * workspace that becomes active or flips state, keep the timestamp for an unchanged one, and drop
     * any whose {@code agentActivity} went null (ENDED / container stopped). Idempotent — an unchanged
     * list produces no write, so timestamps stay stable and the bar order doesn't churn.
     *
     * Call from an effect wrapped in {@code untracked} so the store reads here don't feed back into
     * the caller's dependency set.
     */
    observe(workspaces: readonly WorkspaceDto[]): void {
      const now = Date.now();
      const current = store.entries();
      const next: Record<string, ActivityEntry> = {};
      let changed = false;
      for (const ws of workspaces) {
        const id = ws.workspaceId;
        const state = ws.agentActivity;
        if (!id || !state) {
          continue;
        }
        const prev = current[id];
        if (prev && prev.state === state) {
          next[id] = prev;
        } else {
          next[id] = { state, changedAt: now };
          changed = true;
        }
      }
      // A pure removal (or a removal that nets the count back to equal via an add) shows up as a size
      // difference; a state change shows up via the per-entry branch above.
      if (changed || Object.keys(current).length !== Object.keys(next).length) {
        patchState(store, { entries: next });
      }
    },

    /** The sort key for a workspace: when its activity last changed, or 0 if it is not tracked. */
    changedAt(workspaceId: string): number {
      return store.entries()[workspaceId]?.changedAt ?? 0;
    },
  })),
);
