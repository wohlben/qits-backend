import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { FeatureDto } from '@/api/model/featureDto';
import { ZardBadgeComponent } from '@/shared/components/badge';
import { ZardButtonComponent } from '@/shared/components/button';
import { CardLayoutComponent } from '@/layout/card-layout/card-layout.component';

@Component({
  selector: 'app-feature-card',
  imports: [RouterLink, CardLayoutComponent, ZardBadgeComponent, ZardButtonComponent],
  template: `
    <app-card-layout>
      <div cardTitle>
        <div class="flex items-center gap-2">
          <h3 class="font-semibold">{{ feature().title }}</h3>
          @if (feature().implementedOn) {
            <z-badge>Implemented</z-badge>
          }
        </div>
      </div>

      @if (feature().description) {
        <p class="text-sm text-muted-foreground line-clamp-2">{{ feature().description }}</p>
      }

      <div cardActions>
        <a
          z-button
          zType="secondary"
          zSize="sm"
          [routerLink]="[
            '/projects',
            projectId(),
            'epics',
            feature().epicId,
            'features',
            feature().id,
          ]"
        >
          View
        </a>
      </div>
    </app-card-layout>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FeatureCardComponent {
  readonly feature = input.required<FeatureDto>();
  readonly projectId = input.required<string>();
}
