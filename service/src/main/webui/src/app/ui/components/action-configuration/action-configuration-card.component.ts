import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { ActionConfigurationDto } from '@/api/model/actionConfigurationDto';
import { CardLayoutComponent } from '@/layout/card-layout/card-layout.component';
import { configBaseName, isConfigManaged } from '@/shared/utils/config-origin';

@Component({
  selector: 'app-action-configuration-card',
  imports: [RouterLink, CardLayoutComponent],
  template: `
    <app-card-layout [hasActions]="false">
      <!-- Config-managed actions are read-only (edit the committed .qits-config.yml instead). -->
      @if (isConfig()) {
        <div cardTitle class="flex items-center gap-2">
          <h3 class="font-semibold">{{ displayName() }}</h3>
          <span
            class="inline-flex w-fit items-center rounded-full border border-amber-500/40 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-700 dark:text-amber-400"
          >
            .qits-config
          </span>
        </div>
      } @else {
        <a cardTitle [routerLink]="['/action-configurations', action().id]" class="hover:underline">
          <h3 class="font-semibold">{{ displayName() }}</h3>
        </a>
      }

      <p class="text-sm text-muted-foreground line-clamp-2">{{ action().description }}</p>
    </app-card-layout>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ActionConfigurationCardComponent {
  readonly action = input.required<ActionConfigurationDto>();

  readonly isConfig = computed(() => isConfigManaged(this.action().origin, this.action().name));
  readonly displayName = computed(() => configBaseName(this.action().name));
}
