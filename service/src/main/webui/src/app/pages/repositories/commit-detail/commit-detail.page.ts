import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { PageLayoutComponent } from '@/layout/page-layout/page-layout.component';
import { CommitDiffComponent } from '@/pattern/repository/commit-diff.component';
import { ZardButtonComponent } from '@/shared/components/button';

/**
 * Route shell for a single commit's diff view. Wires the `repoId`/`branchName`/`commitHash`
 * route params and the optional `parent` query param into {@link CommitDiffComponent}.
 */
@Component({
  selector: 'app-commit-detail-page',
  imports: [PageLayoutComponent, CommitDiffComponent, ZardButtonComponent, RouterLink],
  template: `
    <app-page-layout [hasActions]="true">
      <div pageTitle class="flex flex-col gap-1">
        <span class="text-sm text-muted-foreground">Commit on {{ branchName }}</span>
        <h1 class="font-mono text-xl font-semibold">{{ shortHash }}</h1>
      </div>

      <div pageActions>
        <a
          z-button
          zType="secondary"
          [routerLink]="['/repositories', repoId, 'branch', branchName, 'commits']"
        >
          Back to commits
        </a>
      </div>

      <app-commit-diff
        [repoId]="repoId"
        [branchName]="branchName"
        [commitHash]="commitHash"
        [parent]="parent"
      />
    </app-page-layout>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommitDetailPage {
  private readonly route = inject(ActivatedRoute);

  readonly repoId = this.route.snapshot.paramMap.get('repoId')!;
  readonly branchName = this.route.snapshot.paramMap.get('branchName')!;
  readonly commitHash = this.route.snapshot.paramMap.get('commitHash')!;
  readonly parent = this.route.snapshot.queryParamMap.get('parent') ?? undefined;

  readonly shortHash = this.commitHash.slice(0, 12);
}
