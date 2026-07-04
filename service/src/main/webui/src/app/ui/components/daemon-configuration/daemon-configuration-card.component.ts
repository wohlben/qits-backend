import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { DaemonConfigurationDto } from '@/api/model/daemonConfigurationDto';
import { CardLayoutComponent } from '@/layout/card-layout/card-layout.component';

@Component({
  selector: 'app-daemon-configuration-card',
  imports: [RouterLink, CardLayoutComponent],
  template: `
    <app-card-layout [hasActions]="false">
      <a
        cardTitle
        [routerLink]="['/daemon-configurations', daemon().id, 'edit']"
        class="hover:underline"
      >
        <h3 class="font-semibold">{{ daemon().name }}</h3>
      </a>

      <p class="text-sm text-muted-foreground line-clamp-2">{{ daemon().description }}</p>
      <p class="mt-1 text-xs text-muted-foreground">
        {{ daemon().restartPolicy }} · {{ daemon().observers?.length ?? 0 }} observer(s)
      </p>
    </app-card-layout>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DaemonConfigurationCardComponent {
  readonly daemon = input.required<DaemonConfigurationDto>();
}
