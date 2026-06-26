import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { FeatureFlowConfigurationControllerService } from '@/api/api/featureFlowConfigurationController.service';
import { FeatureFlowCardComponent } from '@/ui/components/feature-flow/feature-flow-card.component';
import { EmptyStateComponent } from '@/ui/components/empty-state/empty-state.component';

@Component({
  selector: 'app-feature-flow-list',
  imports: [FeatureFlowCardComponent, EmptyStateComponent],
  template: `
    @if (featureFlowsQuery.isPending()) {
      <div class="py-12 text-center text-muted-foreground">Loading feature flows…</div>
    } @else if (featureFlowsQuery.isError()) {
      <div class="py-12 text-center text-destructive">Failed to load feature flows</div>
    } @else {
      @let featureFlows = featureFlowsQuery.data() ?? [];
      @if (featureFlows.length === 0) {
        <app-empty-state>
          <span title>No feature flows yet</span>
          <span description>Create your first feature flow to get started</span>
        </app-empty-state>
      } @else {
        <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          @for (featureFlow of featureFlows; track featureFlow.id) {
            <app-feature-flow-card [featureFlow]="featureFlow" />
          }
        </div>
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FeatureFlowListComponent {
  private readonly featureFlowService = inject(FeatureFlowConfigurationControllerService);

  readonly featureFlowsQuery = injectQuery(() => ({
    queryKey: ['feature-flows'],
    queryFn: () =>
      lastValueFrom(this.featureFlowService.apiFeatureFlowConfigurationsGet()).then(
        (r) => r.entries?.map((e) => e.featureFlowConfiguration!).filter((f): f is NonNullable<typeof f> => !!f) ?? []
      ),
  }));
}
