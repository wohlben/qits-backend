import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  untracked,
} from '@angular/core';
import { Router } from '@angular/router';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { WorkspaceControllerService } from '@/api/api/workspaceController.service';
import { AgentActivityState } from '@/api/model/agentActivityState';
import type { WorkspaceDto } from '@/api/model/workspaceDto';
import { ZardButtonComponent } from '@/shared/components/button/button.component';
import { WorkspaceActivityOrderStore } from './workspace-activity-order.store';

/** Human label + status-dot colour per activity state, precomputed so the template stays flat. */
const STATE_LABEL: Record<AgentActivityState, string> = {
  [AgentActivityState.Busy]: 'Cooking…',
  [AgentActivityState.Waiting]: 'Waiting on you',
  [AgentActivityState.Idle]: 'Idle',
  [AgentActivityState.Ended]: 'Ended',
};

const STATE_DOT: Record<AgentActivityState, string> = {
  [AgentActivityState.Busy]: 'bg-primary animate-pulse',
  [AgentActivityState.Waiting]: 'bg-amber-500',
  [AgentActivityState.Idle]: 'bg-muted-foreground/60',
  [AgentActivityState.Ended]: 'bg-muted-foreground/40',
};

/** One button's view model — everything the template reads, so it holds no logic. */
interface ActivityButton {
  id: string;
  /** The branch name, or the workspace id as a fallback. */
  label: string;
  state: AgentActivityState;
  stateLabel: string;
  dotClass: string;
  current: boolean;
}

/**
 * The sticky "recent agent activity" bar on the workspace, repository, and project detail routes: a
 * single row of buttons, one per workspace in this repo that has a live coding-agent session (BUSY /
 * WAITING / IDLE), ordered newest-activity-first (far left = most recently changed). A session that
 * just stopped bubbles to the left because that's its most recent change, so the user can jump
 * straight to whichever workspace needs their next prompt — clicking a button opens that workspace's
 * Chat tab. `currentWorkspaceId` is set only on the workspace detail route (it highlights the open
 * workspace); the project detail route mounts one bar per repository, telling them apart via the
 * optional `label` prefix.
 *
 * State comes from {@code WorkspaceDto.agentActivity} on the shared {@code ['workspaces', repoId]}
 * query, which each mounting route's live service ({@code WorkspaceLiveService},
 * {@code RepositoryLiveService}, or the project route's {@code GlobalLiveService}) keeps fresh over
 * its channel's `agent-activity` SSE topic — so the
 * row re-sorts live with no polling. Ordering is remembered in the root-scoped
 * {@link WorkspaceActivityOrderStore} (survives the page remount on workspace switch). Buttons persist
 * while a session is stopped/waiting and drop off only when its activity clears (ENDED / container
 * stopped ⇒ {@code agentActivity} null). The bar renders nothing when no workspace is active.
 */
@Component({
  selector: 'app-workspace-activity-bar',
  imports: [ZardButtonComponent],
  // Collapse the host entirely when there is nothing to show, so the sticky chrome (border/bg the
  // mount site puts on the host) never renders as an empty strip. Inline style beats the mount-site
  // display class in both directions.
  host: { '[style.display]': "buttons().length ? null : 'none'" },
  template: `
    @if (buttons().length) {
      <nav
        class="flex items-center gap-2 overflow-x-auto py-1"
        [attr.aria-label]="navLabel()"
      >
        @if (label(); as prefix) {
          <span class="shrink-0 text-xs font-medium text-muted-foreground">{{ prefix }}</span>
        }
        @for (b of buttons(); track b.id) {
          <button
            z-button
            zSize="sm"
            [zType]="b.current ? 'secondary' : 'ghost'"
            [attr.aria-current]="b.current ? 'page' : null"
            [attr.title]="b.label + ' — ' + b.stateLabel"
            (click)="open(b.id)"
          >
            <span
              class="inline-block size-2 shrink-0 rounded-full"
              [class]="b.dotClass"
              aria-hidden="true"
            ></span>
            <span class="max-w-40 truncate">{{ b.label }}</span>
            <span class="sr-only">{{ b.stateLabel }}</span>
          </button>
        }
      </nav>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkspaceActivityBarComponent {
  readonly repoId = input.required<string>();
  /** The open workspace to highlight — set on the workspace detail route only. */
  readonly currentWorkspaceId = input<string | null>(null);
  /** Optional row prefix naming the repo — set where several bars stack (the project route). */
  readonly label = input<string | null>(null);

  /** Distinct accessible names when several bars stack on one page. */
  readonly navLabel = computed(() => {
    const prefix = this.label();
    return prefix
      ? `Workspaces with recent agent activity in ${prefix}`
      : 'Workspaces with recent agent activity';
  });

  private readonly workspaceService = inject(WorkspaceControllerService);
  private readonly orderStore = inject(WorkspaceActivityOrderStore);
  private readonly router = inject(Router);

  // Same key + shape as the detail page's workspace list, so this reads one shared cache entry that
  // the `agent-activity` SSE topic invalidates.
  private readonly workspacesQuery = injectQuery(() => ({
    queryKey: ['workspaces', this.repoId()],
    queryFn: () =>
      lastValueFrom(this.workspaceService.apiRepositoriesRepoIdWorkspacesGet(this.repoId())).then(
        (r) => r.entries?.map((e) => e.workspace!).filter((w): w is WorkspaceDto => !!w) ?? [],
      ),
  }));

  constructor() {
    // Feed the ordering memory on every list change (SSE-driven). untracked: the store reads inside
    // observe() must not become dependencies of this effect (that would loop on its own patch).
    effect(() => {
      const workspaces = this.workspacesQuery.data() ?? [];
      untracked(() => this.orderStore.observe(workspaces));
    });
  }

  readonly buttons = computed<ActivityButton[]>(() => {
    const current = this.currentWorkspaceId();
    return (this.workspacesQuery.data() ?? [])
      .filter((w): w is WorkspaceDto & { workspaceId: string; agentActivity: AgentActivityState } =>
        !!w.workspaceId && !!w.agentActivity,
      )
      .map((w) => ({
        id: w.workspaceId,
        label: w.branch || w.workspaceId,
        state: w.agentActivity,
        stateLabel: STATE_LABEL[w.agentActivity],
        dotClass: STATE_DOT[w.agentActivity],
        current: w.workspaceId === current,
      }))
      .sort(
        (a, b) =>
          this.orderStore.changedAt(b.id) - this.orderStore.changedAt(a.id) ||
          a.id.localeCompare(b.id),
      );
  });

  open(workspaceId: string): void {
    void this.router.navigate([
      '/repositories',
      this.repoId(),
      'workspaces',
      workspaceId,
      'chat',
    ]);
  }
}
