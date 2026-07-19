import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { PageLayoutComponent } from '@/layout/page-layout/page-layout.component';
import { RepositoryBootstrapListComponent } from '@/pattern/bootstrap/repository-bootstrap-list.component';
import { ZardButtonComponent } from '@/shared/components/button';

@Component({
  selector: 'app-repository-bootstrap-page',
  imports: [PageLayoutComponent, RepositoryBootstrapListComponent, RouterLink, ZardButtonComponent],
  template: `
    <app-page-layout>
      <div pageTitle>
        <h1 class="text-2xl font-bold">Bootstrap</h1>
        <p class="text-sm text-muted-foreground">
          The ordered one-shot commands a freshly provisioned workspace container runs before its
          daemons start (install, build, seed)
        </p>
      </div>
      <div pageActions class="flex items-center gap-2">
        <a z-button zType="secondary" [routerLink]="['/repositories', repoId]">Back</a>
        <a z-button [routerLink]="['/repositories', repoId, 'bootstrap', 'new']">New Command</a>
      </div>
      <app-repository-bootstrap-list [repoId]="repoId" />
    </app-page-layout>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RepositoryBootstrapPage {
  private readonly route = inject(ActivatedRoute);

  readonly repoId = this.route.snapshot.paramMap.get('repoId')!;
}
