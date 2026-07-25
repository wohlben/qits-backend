import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { TaskControllerService } from '@/api/api/taskController.service';
import { PageLayoutComponent } from '@/layout/page-layout/page-layout.component';
import { TaskCreateUpdateFormComponent } from '@/pattern/task/task-create-update-form.component';

@Component({
  selector: 'app-task-form-page',
  imports: [PageLayoutComponent, TaskCreateUpdateFormComponent],
  template: `
    <app-page-layout [hasActions]="false">
      <div pageTitle>
        <h1 class="text-2xl font-bold">{{ isEdit() ? 'Edit Task' : 'New Task' }}</h1>
      </div>
      @if (isEdit() && taskQuery.isPending()) {
        <div class="text-muted-foreground">Loading task…</div>
      } @else if (isEdit() && taskQuery.isError()) {
        <div class="text-destructive">Failed to load task</div>
      } @else {
        <app-task-create-update-form
          [projectId]="projectId"
          [epicId]="epicId"
          [featureId]="featureId"
          [task]="task()"
        />
      }
    </app-page-layout>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TaskFormPage {
  private readonly route = inject(ActivatedRoute);
  private readonly taskService = inject(TaskControllerService);

  readonly projectId = this.route.snapshot.paramMap.get('projectId')!;
  readonly epicId = this.route.snapshot.paramMap.get('epicId')!;
  readonly featureId = this.route.snapshot.paramMap.get('featureId')!;
  readonly taskId = this.route.snapshot.paramMap.get('taskId');

  readonly taskQuery = injectQuery(() => ({
    queryKey: ['task', this.taskId ?? ''],
    queryFn: () =>
      lastValueFrom(this.taskService.apiTasksIdGet(this.taskId!)).then((r) => r.task!),
    enabled: () => !!this.taskId,
  }));

  readonly task = computed(() => this.taskQuery.data());
  readonly isEdit = computed(() => !!this.taskId);
}
