import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { FeatureFlowConfigurationControllerService } from '@/api/api/featureFlowConfigurationController.service';
import { PageLayoutComponent } from '@/layout/page-layout/page-layout.component';
import { FeatureFlowCreateUpdateFormComponent } from '@/pattern/feature-flow/feature-flow-create-update-form.component';

@Component({
  selector: 'app-feature-flow-form-page',
  imports: [PageLayoutComponent, FeatureFlowCreateUpdateFormComponent],
  template: `
    <app-page-layout [hasActions]="false">
      <div pageTitle>
        <h1 class="text-2xl font-bold">{{ isEdit() ? 'Edit Feature Flow' : 'New Feature Flow' }}</h1>
      </div>
      @if (isEdit() && featureFlowQuery.isPending()) {
        <div class="text-muted-foreground">Loading feature flow…</div>
      } @else if (isEdit() && featureFlowQuery.isError()) {
        <div class="text-destructive">Failed to load feature flow</div>
      } @else {
        <app-feature-flow-create-update-form [featureFlow]="featureFlow()" />
      }
    </app-page-layout>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FeatureFlowFormPage {
  private readonly route = inject(ActivatedRoute);
  private readonly featureFlowService = inject(FeatureFlowConfigurationControllerService);

  readonly featureFlowId = this.route.snapshot.paramMap.get('id');

  readonly featureFlowQuery = injectQuery(() => ({
    queryKey: ['feature-flow', this.featureFlowId ?? ''],
    queryFn: () =>
      lastValueFrom(this.featureFlowService.apiFeatureFlowConfigurationsIdGet(this.featureFlowId!)).then(
        (r) => r.featureFlowConfiguration!
      ),
    enabled: () => !!this.featureFlowId,
  }));

  readonly featureFlow = computed(() => this.featureFlowQuery.data());
  readonly isEdit = computed(() => !!this.featureFlowId);
}
