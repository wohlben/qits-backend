import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

import { PageLayoutComponent } from '@/layout/page-layout/page-layout.component';
import { WebTerminalComponent } from '@/pattern/repository/web-terminal.component';
import { ZardButtonComponent } from '@/shared/components/button';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-branch-terminal-page',
  imports: [PageLayoutComponent, WebTerminalComponent, ZardButtonComponent, RouterLink],
  template: `
    <app-page-layout>
      <div pageTitle class="flex flex-col gap-1">
        <span class="text-sm text-muted-foreground">Terminal on</span>
        <h1 class="text-2xl font-semibold">{{ branchName }}</h1>
      </div>

      <div pageActions>
        <a z-button zType="secondary" [routerLink]="['/repositories', repoId]">Back to repository</a>
      </div>

      <app-web-terminal [repoId]="repoId" [branchName]="branchName" />
    </app-page-layout>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BranchTerminalPage {
  private readonly route = inject(ActivatedRoute);

  readonly repoId = this.route.snapshot.paramMap.get('repoId')!;
  readonly branchName = this.route.snapshot.paramMap.get('branchName')!;
}
