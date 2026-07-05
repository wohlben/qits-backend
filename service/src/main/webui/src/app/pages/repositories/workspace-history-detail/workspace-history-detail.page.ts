import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { PageLayoutComponent } from '@/layout/page-layout/page-layout.component';
import { WorkspaceHistoryDetailComponent } from '@/pattern/repository/workspace-history-detail.component';
import { ZardButtonComponent } from '@/shared/components/button';

@Component({
  selector: 'app-workspace-history-detail-page',
  imports: [PageLayoutComponent, WorkspaceHistoryDetailComponent, ZardButtonComponent, RouterLink],
  template: `
    <app-page-layout>
      <div pageTitle>
        <h1 class="text-2xl font-bold">Workspace history</h1>
      </div>
      <div pageActions>
        <a z-button zType="secondary" [routerLink]="['/repositories', repoId, 'history']">
          Back to history
        </a>
      </div>
      <app-workspace-history-detail [repoId]="repoId" [workspaceRowId]="rowId" />
    </app-page-layout>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkspaceHistoryDetailPage {
  private readonly route = inject(ActivatedRoute);
  readonly repoId = this.route.snapshot.paramMap.get('repoId')!;
  readonly rowId = Number(this.route.snapshot.paramMap.get('id'));
}
