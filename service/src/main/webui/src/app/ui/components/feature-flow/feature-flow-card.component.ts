import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { FeatureFlowConfigurationDto } from '@/api/model/featureFlowConfigurationDto';
import { CardLayoutComponent } from '@/layout/card-layout/card-layout.component';

@Component({
  selector: 'app-feature-flow-card',
  imports: [RouterLink, CardLayoutComponent],
  template: `
    <app-card-layout [hasActions]="false">
      <a cardTitle [routerLink]="['/feature-flows', featureFlow().id]" class="hover:underline">
        <h3 class="font-semibold">{{ featureFlow().name }}</h3>
      </a>

      @if (featureFlow().projectId) {
        <p class="text-sm text-muted-foreground">Project: {{ featureFlow().projectId }}</p>
      }
    </app-card-layout>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FeatureFlowCardComponent {
  readonly featureFlow = input.required<FeatureFlowConfigurationDto>();
}
