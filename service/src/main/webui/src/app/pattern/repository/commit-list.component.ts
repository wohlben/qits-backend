import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { Router } from '@angular/router';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { RepositoryControllerService } from '@/api/api/repositoryController.service';
import { CommitDto } from '@/api/model/commitDto';
import { EmptyStateComponent } from '@/ui/components/empty-state/empty-state.component';
import { CommitRowComponent } from '@/ui/components/repository/commit-row.component';

/**
 * Smart list of the commits unique to a branch (i.e. {@code parent..branch}). Fetches the
 * commit log for `repoId`/`branchName` and renders a reusable {@link CommitRowComponent} per
 * commit, with the same pending/error/empty states as the other lists in the app.
 */
@Component({
  selector: 'app-commit-list',
  imports: [EmptyStateComponent, CommitRowComponent],
  template: `
    <div class="flex flex-col gap-4">
      @if (commitsQuery.isPending()) {
        <div class="text-sm text-muted-foreground">Loading commits…</div>
      } @else if (commitsQuery.isError()) {
        <div class="text-sm text-destructive">Failed to load commits</div>
      } @else {
        @let commits = commitsQuery.data() ?? [];
        @if (commits.length === 0) {
          <app-empty-state>
            <span title>No commits</span>
            <span description>This branch has no commits beyond its parent</span>
          </app-empty-state>
        } @else {
          <div class="flex flex-col gap-2">
            @for (commit of commits; track commit.hash) {
              <app-commit-row [commit]="commit" (view)="openCommit(commit)" />
            }
          </div>
        }
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommitListComponent {
  readonly repoId = input.required<string>();
  readonly branchName = input.required<string>();

  private readonly repositoryService = inject(RepositoryControllerService);
  private readonly router = inject(Router);

  readonly commitsQuery = injectQuery(() => ({
    queryKey: ['commits', this.repoId(), this.branchName()],
    queryFn: () =>
      lastValueFrom(
        this.repositoryService.apiRepositoriesRepoIdCommitsGet(this.repoId(), this.branchName()),
      ).then((r) => r.commits ?? []),
  }));

  /** Open a commit's diff view. No `parent` is passed, so it diffs against its own first parent. */
  openCommit(commit: CommitDto) {
    if (commit.hash) {
      this.router.navigate([
        '/repositories',
        this.repoId(),
        'branch',
        this.branchName(),
        'commits',
        commit.hash,
      ]);
    }
  }
}
