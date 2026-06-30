import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { PageLayoutComponent } from '@/layout/page-layout/page-layout.component';
import { WorktreeHistoryListComponent } from '@/pattern/repository/worktree-history-list.component';
import { ZardButtonComponent } from '@/shared/components/button';

@Component({
  selector: 'app-worktree-history-page',
  imports: [PageLayoutComponent, WorktreeHistoryListComponent, ZardButtonComponent, RouterLink],
  template: `
    <app-page-layout>
      <div pageTitle>
        <h1 class="text-2xl font-bold">Worktree history</h1>
        <p class="text-sm text-muted-foreground">
          Every worktree that flowed through this repository — its goal, outcome, and what ran in it.
        </p>
      </div>
      <div pageActions>
        <a z-button zType="secondary" [routerLink]="['/repositories', repoId]">Back to repository</a>
      </div>
      <app-worktree-history-list [repoId]="repoId" />
    </app-page-layout>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorktreeHistoryPage {
  private readonly route = inject(ActivatedRoute);
  readonly repoId = this.route.snapshot.paramMap.get('repoId')!;
}
