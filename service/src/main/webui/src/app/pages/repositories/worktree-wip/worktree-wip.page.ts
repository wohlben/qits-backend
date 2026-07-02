import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { WorktreeControllerService } from '@/api/api/worktreeController.service';
import { WorktreeDto } from '@/api/model/worktreeDto';
import { PageLayoutComponent } from '@/layout/page-layout/page-layout.component';
import { SpeakToPromptComponent } from '@/pattern/speech/speak-to-prompt.component';
import { MarkdownComponent } from '@/ui/components/markdown/markdown.component';

/**
 * The "work in progress" page of a worktree: decide what to do in it by speaking. Speech is
 * transcribed locally in the browser, refined into a coherent prompt by a small Claude model, and
 * launched as this worktree's agent.
 */
@Component({
  selector: 'app-worktree-wip-page',
  imports: [PageLayoutComponent, SpeakToPromptComponent, MarkdownComponent],
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

      <div class="flex flex-col gap-6">
        @if (worktree()?.preamble; as preamble) {
          <section class="rounded-lg border bg-muted/30 p-4">
            <h2 class="mb-2 text-sm font-medium text-muted-foreground">Goal of this worktree</h2>
            <app-markdown [text]="preamble" />
          </section>
        }

        <app-speak-to-prompt [repoId]="repoId" [worktreeId]="worktreeId" />
      </div>
    </app-page-layout>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorktreeWipPage {
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
