import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { ActionConfigurationDto } from '@/api/model/actionConfigurationDto';
import { CardLayoutComponent } from '@/layout/card-layout/card-layout.component';

@Component({
  selector: 'app-action-configuration-card',
  imports: [RouterLink, CardLayoutComponent],
  template: `
    <app-card-layout [hasActions]="false">
      <a cardTitle [routerLink]="['/action-configurations', action().id]" class="hover:underline">
        <h3 class="font-semibold">{{ action().name }}</h3>
      </a>

      <p class="text-sm text-muted-foreground line-clamp-2">{{ action().description }}</p>
    </app-card-layout>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ActionConfigurationCardComponent {
  readonly action = input.required<ActionConfigurationDto>();
}
