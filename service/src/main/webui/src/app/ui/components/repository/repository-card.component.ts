import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { RepositoryDto } from '@/api/model/repositoryDto';
import { ZardButtonComponent } from '@/shared/components/button';
import { CardLayoutComponent } from '@/layout/card-layout/card-layout.component';

@Component({
  selector: 'app-repository-card',
  imports: [RouterLink, CardLayoutComponent, ZardButtonComponent],
  template: `
    <app-card-layout>
      <div cardTitle>
        <h3 class="font-semibold">{{ repository().url }}</h3>
      </div>

      <p class="text-sm text-muted-foreground">{{ repository().archetype }}</p>

      <div cardActions>
        <a
          z-button
          zType="secondary"
          zSize="sm"
          [routerLink]="['/repositories', repository().id]"
        >
          View
        </a>
      </div>
    </app-card-layout>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RepositoryCardComponent {
  readonly repository = input.required<RepositoryDto>();
}
