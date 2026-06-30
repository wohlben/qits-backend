import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { PageLayoutComponent } from '@/layout/page-layout/page-layout.component';
import { WorktreeHistoryDetailComponent } from '@/pattern/repository/worktree-history-detail.component';
import { ZardButtonComponent } from '@/shared/components/button';

@Component({
  selector: 'app-worktree-history-detail-page',
  imports: [PageLayoutComponent, WorktreeHistoryDetailComponent, ZardButtonComponent, RouterLink],
  template: `
    <app-page-layout>
      <div pageTitle>
        <h1 class="text-2xl font-bold">Worktree history</h1>
      </div>
      <div pageActions>
        <a z-button zType="secondary" [routerLink]="['/repositories', repoId, 'history']">
          Back to history
        </a>
      </div>
      <app-worktree-history-detail [repoId]="repoId" [worktreeRowId]="rowId" />
    </app-page-layout>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorktreeHistoryDetailPage {
  private readonly route = inject(ActivatedRoute);
  readonly repoId = this.route.snapshot.paramMap.get('repoId')!;
  readonly rowId = Number(this.route.snapshot.paramMap.get('id'));
}
