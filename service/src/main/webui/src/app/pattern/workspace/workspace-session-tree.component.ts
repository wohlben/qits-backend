import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { injectMutation, injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { AgentControllerService } from '@/api/api/agentController.service';
import { AgentSessionControllerService } from '@/api/api/agentSessionController.service';
import { CommandControllerService } from '@/api/api/commandController.service';
import { AgentLaunchMode } from '@/api/model/agentLaunchMode';
import { AgentMcpScope } from '@/api/model/agentMcpScope';
import { AgentSessionNodeDto } from '@/api/model/agentSessionNodeDto';
import { CommandDto } from '@/api/model/commandDto';
import { newestRunningChat, newestRunningInteractiveAgent } from '@/pattern/command/running-chat';
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
 *
 * The list is also where a specific past session is explicitly resumed (the Agents tab embed
 * never auto-resumes): while nothing runs for the workspace, each row offers Resume, which
 * launches an interactive run with that row's `resumeSessionId`; the ['commands'] invalidation
 * then makes the embed attach to it. While a run or chat is live the buttons disappear — a
 * concurrent `--resume` is the collision session pinning exists to avoid.
 */
@Component({
  selector: 'app-workspace-session-tree',
  imports: [AgentSessionRowsComponent],
  template: `
    <section class="flex flex-col gap-3" aria-label="Session history">
      <h2 class="text-lg font-semibold">Sessions</h2>

      @if (resumeMutation.isError()) {
        <div class="text-sm text-destructive">Failed to resume the session.</div>
      }

      @if (sessionsQuery.isPending()) {
        <div class="text-sm text-muted-foreground">Loading sessions…</div>
      } @else if (sessionsQuery.isError()) {
        <div class="text-sm text-destructive">Failed to load the session history</div>
      } @else if (rows().length === 0) {
        <p class="text-sm text-muted-foreground">
          No agent sessions yet — the first session starts when the tab resolves.
        </p>
      } @else {
        <app-agent-session-rows
          [rows]="rows()"
          [currentSessionId]="currentSessionId()"
          [resumable]="resumable()"
          (resumeSession)="resumeMutation.mutate($event)"
        />
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
  private readonly agentService = inject(AgentControllerService);
  private readonly commandService = inject(CommandControllerService);
  private readonly queryClient = inject(QueryClient);

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

  // Same key AND shape as the page's commands query, so all consumers share one cache entry.
  readonly commandsQuery = injectQuery(() => ({
    queryKey: ['commands'],
    queryFn: () =>
      lastValueFrom(this.commandService.apiCommandsGet()).then(
        (r) => r.entries?.map((e) => e.command!).filter((c): c is CommandDto => !!c) ?? [],
      ),
  }));

  readonly rows = computed(() => flattenSessions(this.sessionsQuery.data() ?? [], 0, null));

  /** Resume is offered only while nothing owns the workspace's conversation. */
  readonly resumable = computed(
    () =>
      !newestRunningInteractiveAgent(this.commandsQuery.data(), this.workspaceId()) &&
      !newestRunningChat(this.commandsQuery.data(), this.workspaceId()) &&
      !this.resumeMutation.isPending(),
  );

  readonly resumeMutation = injectMutation(() => ({
    mutationFn: (resumeSessionId: string) =>
      lastValueFrom(
        this.agentService.apiRepositoriesRepoIdWorkspacesWorkspaceIdAgentsPost(
          this.repoId(),
          this.workspaceId(),
          {
            scope: AgentMcpScope.Repository,
            mode: AgentLaunchMode.Interactive,
            resumeSessionId,
          },
        ),
      ),
    // The embed attaches by watching ['commands'] — invalidation is the whole hand-off.
    onSuccess: () => this.queryClient.invalidateQueries({ queryKey: ['commands'] }),
  }));
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
