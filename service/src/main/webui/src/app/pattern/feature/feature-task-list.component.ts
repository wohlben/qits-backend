import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { FeatureControllerService } from '@/api/api/featureController.service';
import { ZardButtonComponent } from '@/shared/components/button';
import { EmptyStateComponent } from '@/ui/components/empty-state/empty-state.component';
import { TaskCardComponent } from '@/ui/components/task/task-card.component';

@Component({
  selector: 'app-feature-task-list',
  imports: [EmptyStateComponent, RouterLink, TaskCardComponent, ZardButtonComponent],
  template: `
    <div class="flex flex-col gap-4">
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold">Tasks</h2>
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
            featureId(),
            'tasks',
            'new',
          ]"
        >
          New Task
        </a>
      </div>

      @if (tasksQuery.isPending()) {
        <div class="text-sm text-muted-foreground">Loading tasks…</div>
      } @else if (tasksQuery.isError()) {
        <div class="text-sm text-destructive">Failed to load tasks</div>
      } @else {
        @let tasks = tasksQuery.data() ?? [];
        @if (tasks.length === 0) {
          <app-empty-state>
            <span title>No tasks</span>
            <span description>This feature has no tasks yet</span>
          </app-empty-state>
        } @else {
          <div class="flex flex-col gap-2">
            @for (task of tasks; track task.id) {
              <app-task-card [task]="task" [projectId]="projectId()" [epicId]="epicId()" />
            }
          </div>
        }
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FeatureTaskListComponent {
  readonly projectId = input.required<string>();
  readonly epicId = input.required<string>();
  readonly featureId = input.required<string>();

  private readonly featureService = inject(FeatureControllerService);

  readonly tasksQuery = injectQuery(() => ({
    queryKey: ['feature-tasks', this.featureId()],
    queryFn: () =>
      lastValueFrom(this.featureService.apiFeaturesFeatureIdTasksGet(this.featureId())).then(
        (r) => r.entries?.map((e) => e.task!).filter((p): p is NonNullable<typeof p> => !!p) ?? []
      ),
  }));
}
