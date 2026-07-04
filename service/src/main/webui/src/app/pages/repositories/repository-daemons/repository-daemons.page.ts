import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { PageLayoutComponent } from '@/layout/page-layout/page-layout.component';
import { RepositoryDaemonListComponent } from '@/pattern/daemon/repository-daemon-list.component';
import { ZardButtonComponent } from '@/shared/components/button';

@Component({
  selector: 'app-repository-daemons-page',
  imports: [PageLayoutComponent, RepositoryDaemonListComponent, RouterLink, ZardButtonComponent],
  template: `
    <app-page-layout>
      <div pageTitle>
        <h1 class="text-2xl font-bold">Daemons</h1>
        <p class="text-sm text-muted-foreground">
          This repository's managed long-running processes (dev servers, watchers) its worktrees
          can run
        </p>
      </div>
      <div pageActions class="flex items-center gap-2">
        <a z-button zType="secondary" [routerLink]="['/repositories', repoId]">Back</a>
        <a z-button [routerLink]="['/repositories', repoId, 'daemons', 'new']">New Daemon</a>
      </div>
      <app-repository-daemon-list [repoId]="repoId" />
    </app-page-layout>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RepositoryDaemonsPage {
  private readonly route = inject(ActivatedRoute);

  readonly repoId = this.route.snapshot.paramMap.get('repoId')!;
}
