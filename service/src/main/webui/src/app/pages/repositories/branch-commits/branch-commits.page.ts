import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { PageLayoutComponent } from '@/layout/page-layout/page-layout.component';
import { CommitListComponent } from '@/pattern/repository/commit-list.component';
import { ZardButtonComponent } from '@/shared/components/button';

@Component({
  selector: 'app-branch-commits-page',
  imports: [PageLayoutComponent, CommitListComponent, ZardButtonComponent, RouterLink],
  template: `
    <app-page-layout>
      <div pageTitle class="flex flex-col gap-1">
        <span class="text-sm text-muted-foreground">Commits on</span>
        <h1 class="text-2xl font-semibold">{{ branchName }}</h1>
      </div>

      <div pageActions>
        <a z-button zType="secondary" [routerLink]="['/repositories', repoId]">Back to repository</a>
      </div>

      <app-commit-list [repoId]="repoId" [branchName]="branchName" />
    </app-page-layout>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BranchCommitsPage {
  private readonly route = inject(ActivatedRoute);

  readonly repoId = this.route.snapshot.paramMap.get('repoId')!;
  readonly branchName = this.route.snapshot.paramMap.get('branchName')!;
}
