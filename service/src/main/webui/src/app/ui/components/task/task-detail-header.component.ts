import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';

import { TaskDto } from '@/api/model/taskDto';
import { MarkdownComponent } from '@/ui/components/markdown/markdown.component';
import { ZardBadgeComponent } from '@/shared/components/badge';

@Component({
  selector: 'app-task-detail-header',
  imports: [DatePipe, MarkdownComponent, RouterLink, ZardBadgeComponent],
  template: `
    <div class="flex flex-col gap-1">
      <div class="flex items-center gap-2">
        <h1 class="text-2xl font-bold">{{ task().title }}</h1>
        @if (task().implementedAt) {
          <z-badge>Implemented {{ task().implementedAt | date: 'medium' }}</z-badge>
        }
      </div>
      <p class="text-xs text-muted-foreground">
        Repository
        <a
          class="underline underline-offset-2"
          [routerLink]="['/repositories', task().repositoryId]"
        >
          {{ repositoryUrl() ?? task().repositoryId }}
        </a>
      </p>
      @if (task().dependsOnTaskId) {
        <p class="text-xs text-muted-foreground">
          Depends on
          <a
            class="underline underline-offset-2"
            [routerLink]="[
              '/projects',
              projectId(),
              'epics',
              epicId(),
              'features',
              task().featureId,
              'tasks',
              task().dependsOnTaskId,
            ]"
          >
            {{ dependsOnTitle() ?? task().dependsOnTaskId }}
          </a>
        </p>
      }
      @if (task().description) {
        <div class="text-sm text-muted-foreground mt-1">
          <app-markdown [text]="task().description!" />
        </div>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TaskDetailHeaderComponent {
  readonly task = input.required<TaskDto>();
  readonly projectId = input.required<string>();
  readonly epicId = input.required<string>();
  /** Display URL of the bound repository, resolved by the page (fallback: the raw id). */
  readonly repositoryUrl = input<string>();
  /** Title of the depended-on sibling, resolved by the page (fallback: the raw id). */
  readonly dependsOnTitle = input<string>();
}
