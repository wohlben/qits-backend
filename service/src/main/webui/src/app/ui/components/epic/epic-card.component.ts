import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { EpicDto } from '@/api/model/epicDto';
import { ZardButtonComponent } from '@/shared/components/button';
import { CardLayoutComponent } from '@/layout/card-layout/card-layout.component';

@Component({
  selector: 'app-epic-card',
  imports: [RouterLink, CardLayoutComponent, ZardButtonComponent],
  template: `
    <app-card-layout>
      <div cardTitle>
        <h3 class="font-semibold">{{ epic().title }}</h3>
      </div>

      @if (epic().description) {
        <p class="text-sm text-muted-foreground line-clamp-2">{{ epic().description }}</p>
      }

      <div cardActions>
        <a
          z-button
          zType="secondary"
          zSize="sm"
          [routerLink]="['/projects', projectId(), 'epics', epic().id]"
        >
          View
        </a>
      </div>
    </app-card-layout>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EpicCardComponent {
  readonly epic = input.required<EpicDto>();
  readonly projectId = input.required<string>();
}
