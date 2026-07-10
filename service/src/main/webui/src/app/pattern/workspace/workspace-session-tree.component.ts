import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { AgentSessionControllerService } from '@/api/api/agentSessionController.service';
import { AgentSessionNodeDto } from '@/api/model/agentSessionNodeDto';
import {
  AgentSessionRowsComponent,
  forkBranchClass,
  SessionRow,
} from '@/ui/components/agent/agent-session-rows.component';

/**
 * The workspace's session history as a tree — the face of the lineage the data model records. One
 * node per session (resumes collapse onto the session they continued), newest roots first; forks
 * nest under their origin with a stable per-lineage accent color, so sibling branches are tellable
 * apart at a glance; subagent sidechains nest grayed-out under the session that spawned them.
 * Fetches the assembled tree from the agent-sessions endpoint and flattens it for the
 * presentational {@link AgentSessionRowsComponent}.
 */
@Component({
  selector: 'app-workspace-session-tree',
  imports: [AgentSessionRowsComponent],
  template: `
    <section class="flex flex-col gap-3" aria-label="Session history">
      <h2 class="text-lg font-semibold">Sessions</h2>

      @if (sessionsQuery.isPending()) {
        <div class="text-sm text-muted-foreground">Loading sessions…</div>
      } @else if (sessionsQuery.isError()) {
        <div class="text-sm text-destructive">Failed to load the session history</div>
      } @else if (rows().length === 0) {
        <p class="text-sm text-muted-foreground">
          No agent sessions yet — the first session starts when the tab resolves.
        </p>
      } @else {
        <app-agent-session-rows [rows]="rows()" [currentSessionId]="currentSessionId()" />
      }
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkspaceSessionTreeComponent {
  readonly repoId = input.required<string>();
  readonly workspaceId = input.required<string>();

  /** The embedded run's current session — its row is highlighted and reads "live" when unswept. */
  readonly currentSessionId = input<string | null>(null);

  private readonly sessionService = inject(AgentSessionControllerService);

  // Freshness rides the SSE `commands` hint (imports happen on command exit, which fires it) —
  // WorkspaceLiveService invalidates this key alongside ['commands'].
  readonly sessionsQuery = injectQuery(() => ({
    queryKey: ['workspace-agent-sessions', this.repoId(), this.workspaceId()],
    queryFn: () =>
      lastValueFrom(
        this.sessionService.apiRepositoriesRepoIdWorkspacesWorkspaceIdAgentSessionsGet(
          this.repoId(),
          this.workspaceId(),
        ),
      ).then((r) => r.sessions ?? []),
  }));

  readonly rows = computed(() => flattenSessions(this.sessionsQuery.data() ?? [], 0, null));
}

/**
 * Depth-first flatten: a node, then its subagents (one level deeper, grayed), then its fork
 * children — each fork starting its own color-coded lineage that its subtree inherits until a
 * deeper fork overrides it.
 */
export function flattenSessions(
  nodes: readonly AgentSessionNodeDto[],
  depth: number,
  inheritedClass: string | null,
): SessionRow[] {
  const rows: SessionRow[] = [];
  for (const node of nodes) {
    const isFork = depth > 0 && !!node.forkedFromSessionId;
    const branchClass =
      isFork && node.sessionId ? forkBranchClass(node.sessionId) : inheritedClass;
    rows.push({
      key: node.sessionId ?? `session-${depth}-${rows.length}`,
      kind: 'session',
      depth,
      branchClass,
      date: node.firstRecordedAt ?? null,
      messageCount: node.messageCount ?? null,
      sessionId: node.sessionId,
      newestCommandId: node.newestCommandId,
    });
    for (const subagent of node.subagents ?? []) {
      rows.push({
        key: `${node.sessionId}/${subagent.agentId}`,
        kind: 'subagent',
        depth: depth + 1,
        branchClass,
        date: subagent.firstTimestamp ?? null,
        messageCount: subagent.messageCount ?? 0,
        label: [subagent.agentType, subagent.description].filter(Boolean).join(': ') || 'subagent',
      });
    }
    rows.push(...flattenSessions(node.children ?? [], depth + 1, branchClass));
  }
  return rows;
}
