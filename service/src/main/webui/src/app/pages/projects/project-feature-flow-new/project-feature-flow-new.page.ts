import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

import { PageLayoutComponent } from '@/layout/page-layout/page-layout.component';
import { FeatureFlowCreateUpdateFormComponent } from '@/pattern/feature-flow/feature-flow-create-update-form.component';

@Component({
  selector: 'app-project-feature-flow-new-page',
  imports: [PageLayoutComponent, FeatureFlowCreateUpdateFormComponent],
  template: `
    <app-page-layout [hasActions]="false">
      <div pageTitle>
        <h1 class="text-2xl font-bold">New Feature Flow</h1>
        <p class="text-sm text-muted-foreground">Create a new feature flow within this project</p>
      </div>
      <app-feature-flow-create-update-form [projectId]="projectId" />
    </app-page-layout>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectFeatureFlowNewPage {
  private readonly route = inject(ActivatedRoute);

  readonly projectId = this.route.snapshot.paramMap.get('projectId')!;
}
