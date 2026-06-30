import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { WorktreeHistoryControllerService } from '@/api/api/worktreeHistoryController.service';
import { WorktreeHistoryDto } from '@/api/model/worktreeHistoryDto';
import { WorktreeStatus } from '@/api/model/worktreeStatus';
import { CardLayoutComponent } from '@/layout/card-layout/card-layout.component';
import { ZardBadgeComponent, ZardBadgeTypeVariants } from '@/shared/components/badge';
import { EmptyStateComponent } from '@/ui/components/empty-state/empty-state.component';

/**
 * The worktree history for a repository: every worktree (active + resolved) as a browsable record.
 * Clicking one opens its detail — the narrative, the event timeline, and the commands that ran in it.
 */
@Component({
  selector: 'app-worktree-history-list',
  imports: [DatePipe, CardLayoutComponent, ZardBadgeComponent, EmptyStateComponent],
  template: `
    @if (historyQuery.isPending()) {
      <div class="py-12 text-center text-muted-foreground">Loading history…</div>
    } @else if (historyQuery.isError()) {
      <div class="py-12 text-center text-destructive">Failed to load history</div>
    } @else if ((historyQuery.data() ?? []).length === 0) {
      <app-empty-state>
        <span title>No worktree history yet</span>
        <span description>Worktrees you create, integrate or abandon will be recorded here.</span>
      </app-empty-state>
    } @else {
      <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        @for (wt of historyQuery.data() ?? []; track wt.id) {
          <button class="text-left" (click)="open(wt)">
            <app-card-layout [hasActions]="false">
              <div cardTitle class="flex items-center gap-2">
                <h3 class="font-mono font-semibold">{{ wt.worktreeId }}</h3>
                <z-badge [zType]="badgeType(wt.status)">{{ statusLabel(wt.status) }}</z-badge>
              </div>
              <dl class="mt-1 flex flex-col gap-0.5 text-sm text-muted-foreground">
                @if (wt.parent) {
                  <div class="text-xs">off {{ wt.parent }}</div>
                }
                <div class="text-xs">created {{ wt.createdAt | date: 'short' }}</div>
                @if (wt.resolvedAt) {
                  <div class="text-xs">resolved {{ wt.resolvedAt | date: 'short' }}</div>
                }
              </dl>
            </app-card-layout>
          </button>
        }
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorktreeHistoryListComponent {
  readonly repoId = input.required<string>();

  private readonly historyService = inject(WorktreeHistoryControllerService);
  private readonly router = inject(Router);

  readonly historyQuery = injectQuery(() => ({
    queryKey: ['worktree-history', this.repoId()],
    queryFn: () =>
      lastValueFrom(this.historyService.apiRepositoriesRepoIdHistoryGet(this.repoId())).then(
        (r) => r.entries?.map((e) => e.worktree!).filter((w): w is WorktreeHistoryDto => !!w) ?? [],
      ),
  }));

  open(wt: WorktreeHistoryDto) {
    if (wt.id != null) {
      this.router.navigate(['/repositories', this.repoId(), 'history', wt.id]);
    }
  }

  badgeType(status: WorktreeStatus | undefined): ZardBadgeTypeVariants {
    switch (status) {
      case WorktreeStatus.Active:
        return 'default';
      case WorktreeStatus.Abandoned:
        return 'destructive';
      default:
        return 'secondary';
    }
  }

  statusLabel(status: WorktreeStatus | undefined): string {
    return status ? status.toLowerCase() : 'unknown';
  }
}
