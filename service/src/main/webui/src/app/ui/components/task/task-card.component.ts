import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { TaskDto } from '@/api/model/taskDto';
import { ZardBadgeComponent } from '@/shared/components/badge';
import { ZardButtonComponent } from '@/shared/components/button';
import { CardLayoutComponent } from '@/layout/card-layout/card-layout.component';

@Component({
  selector: 'app-task-card',
  imports: [RouterLink, CardLayoutComponent, ZardBadgeComponent, ZardButtonComponent],
  template: `
    <app-card-layout>
      <div cardTitle>
        <div class="flex items-center gap-2">
          <h3 class="font-semibold">{{ task().title }}</h3>
          @if (task().implementedAt) {
            <z-badge>Implemented</z-badge>
          }
        </div>
      </div>

      @if (task().description) {
        <p class="text-sm text-muted-foreground line-clamp-2">{{ task().description }}</p>
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
            epicId(),
            'features',
            task().featureId,
            'tasks',
            task().id,
          ]"
        >
          View
        </a>
      </div>
    </app-card-layout>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TaskCardComponent {
  readonly task = input.required<TaskDto>();
  readonly projectId = input.required<string>();
  readonly epicId = input.required<string>();
}
