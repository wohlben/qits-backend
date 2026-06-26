import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

import { PageLayoutComponent } from '@/layout/page-layout/page-layout.component';
import { FeatureFlowListComponent } from '@/pattern/feature-flow/feature-flow-list.component';
import { ZardButtonComponent } from '@/shared/components/button';

@Component({
  selector: 'app-feature-flow-list-page',
  imports: [PageLayoutComponent, FeatureFlowListComponent, RouterLink, ZardButtonComponent],
  template: `
    <app-page-layout>
      <div pageTitle>
        <h1 class="text-2xl font-bold">Feature Flows</h1>
        <p class="text-sm text-muted-foreground">Manage feature flow configurations</p>
      </div>
      <div pageActions>
        <a z-button zType="secondary" routerLink="/action-configurations">Actions</a>
      </div>
      <app-feature-flow-list />
    </app-page-layout>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FeatureFlowListPage {}
