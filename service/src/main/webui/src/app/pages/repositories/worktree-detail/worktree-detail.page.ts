import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { WorktreeControllerService } from '@/api/api/worktreeController.service';
import { WorktreeDto } from '@/api/model/worktreeDto';
import { PageLayoutComponent } from '@/layout/page-layout/page-layout.component';
import { WorktreeFileBrowserComponent } from '@/pattern/worktree/worktree-file-browser.component';

/**
 * The worktree detail page: browse the worktree's files with a tree + syntax-highlighted viewer.
 * The speak-to-prompt experiment lives on a separate `…/wip` route, linked from the header.
 */
@Component({
  selector: 'app-worktree-detail-page',
  imports: [PageLayoutComponent, WorktreeFileBrowserComponent, RouterLink],
  template: `
    <app-page-layout
      [request]="worktreesQuery"
      pendingText="Loading worktree…"
      errorText="Failed to load worktree"
    >
      <ng-template #pageTitle>
        <div class="flex flex-col gap-1">
          <h1 class="text-2xl font-semibold">{{ worktreeId }}</h1>
          @if (worktree(); as wt) {
            <span class="text-sm text-muted-foreground">
              {{ wt.branch }}
              @if (wt.parent) {
                <span> · forked from {{ wt.parent }}</span>
              }
            </span>
          }
        </div>
      </ng-template>

      <ng-template #pageActions>
        <a
          class="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
          [routerLink]="['/repositories', repoId, 'worktrees', worktreeId, 'wip']"
        >
          Speak a prompt
        </a>
      </ng-template>

      <app-worktree-file-browser [repoId]="repoId" [worktreeId]="worktreeId" />
    </app-page-layout>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorktreeDetailPage {
  private readonly route = inject(ActivatedRoute);
  private readonly worktreeService = inject(WorktreeControllerService);

  readonly repoId = this.route.snapshot.paramMap.get('repoId')!;
  readonly worktreeId = this.route.snapshot.paramMap.get('worktreeId')!;

  // Same key AND shape as the branch list's worktrees query, so both share one cache entry.
  readonly worktreesQuery = injectQuery(() => ({
    queryKey: ['worktrees', this.repoId],
    queryFn: () =>
      lastValueFrom(this.worktreeService.apiRepositoriesRepoIdWorktreesGet(this.repoId)).then(
        (r) => r.entries?.map((e) => e.worktree!).filter((w): w is WorktreeDto => !!w) ?? [],
      ),
  }));

  readonly worktree = computed(
    () => (this.worktreesQuery.data() ?? []).find((w) => w.worktreeId === this.worktreeId) ?? null,
  );
}
