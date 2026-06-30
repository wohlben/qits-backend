import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { WorktreeHistoryControllerService } from '@/api/api/worktreeHistoryController.service';
import { WorktreeStatus } from '@/api/model/worktreeStatus';
import { CardLayoutComponent } from '@/layout/card-layout/card-layout.component';
import { ZardBadgeComponent, ZardBadgeTypeVariants } from '@/shared/components/badge';

/**
 * A single worktree's full history: its narrative (preamble/result markdown), the event timeline, and
 * the commands that ran in it (each linking to its terminal/log). Keyed by the surrogate id.
 */
@Component({
  selector: 'app-worktree-history-detail',
  imports: [DatePipe, RouterLink, CardLayoutComponent, ZardBadgeComponent],
  template: `
    @if (detailQuery.isPending()) {
      <div class="py-12 text-center text-muted-foreground">Loading…</div>
    } @else if (detailQuery.isError()) {
      <div class="py-12 text-center text-destructive">Failed to load worktree history</div>
    } @else if (detailQuery.data(); as wt) {
      <div class="flex flex-col gap-6">
        <h2 class="font-mono text-xl font-semibold">{{ wt.worktreeId }}</h2>
        <div class="flex items-center gap-2">
          <z-badge [zType]="badgeType(wt.status)">{{ statusLabel(wt.status) }}</z-badge>
          @if (wt.parent) {
            <span class="text-sm text-muted-foreground">off {{ wt.parent }}</span>
          }
          <span class="text-sm text-muted-foreground">
            created {{ wt.createdAt | date: 'short' }}
            @if (wt.resolvedAt) {
              · resolved {{ wt.resolvedAt | date: 'short' }}
            }
          </span>
        </div>

        <section class="flex flex-col gap-2">
          <h2 class="text-sm font-semibold text-muted-foreground">Preamble</h2>
          @if (wt.preamble) {
            <pre class="whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-sm">{{ wt.preamble }}</pre>
          } @else {
            <p class="text-sm text-muted-foreground">No preamble.</p>
          }
        </section>

        @if (wt.result) {
          <section class="flex flex-col gap-2">
            <h2 class="text-sm font-semibold text-muted-foreground">Result</h2>
            <pre class="whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-sm">{{ wt.result }}</pre>
          </section>
        }

        <section class="flex flex-col gap-2">
          <h2 class="text-sm font-semibold text-muted-foreground">Timeline</h2>
          <ul class="flex flex-col gap-1">
            @for (event of wt.events ?? []; track $index) {
              <li class="flex items-baseline gap-2 text-sm">
                <span class="font-medium">{{ event.type }}</span>
                @if (event.target) {
                  <span class="text-muted-foreground">→ {{ event.target }}</span>
                }
                @if (event.commit) {
                  <span class="font-mono text-xs text-muted-foreground">{{ event.commit?.slice(0, 7) }}</span>
                }
                <span class="ml-auto text-xs text-muted-foreground">{{ event.at | date: 'short' }}</span>
              </li>
            }
          </ul>
        </section>

        <section class="flex flex-col gap-2">
          <h2 class="text-sm font-semibold text-muted-foreground">Commands</h2>
          @if ((wt.commands ?? []).length) {
            <ul class="flex flex-col gap-1">
              @for (command of wt.commands ?? []; track command.id) {
                <li>
                  <a
                    class="flex items-baseline gap-2 text-sm hover:underline"
                    [routerLink]="['/commands', command.id]"
                  >
                    <span class="font-medium">{{ command.actionName }}</span>
                    <span class="text-xs text-muted-foreground">{{ command.status?.toLowerCase() }}</span>
                    <span class="ml-auto text-xs text-muted-foreground">{{ command.launchedAt | date: 'short' }}</span>
                  </a>
                </li>
              }
            </ul>
          } @else {
            <p class="text-sm text-muted-foreground">No commands ran in this worktree.</p>
          }
        </section>
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorktreeHistoryDetailComponent {
  readonly repoId = input.required<string>();
  readonly worktreeRowId = input.required<number>();

  private readonly historyService = inject(WorktreeHistoryControllerService);

  readonly detailQuery = injectQuery(() => ({
    queryKey: ['worktree-history-detail', this.repoId(), this.worktreeRowId()],
    queryFn: () =>
      lastValueFrom(
        this.historyService.apiRepositoriesRepoIdHistoryIdGet(this.worktreeRowId(), this.repoId()),
      ).then((r) => r.worktree ?? null),
  }));

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
