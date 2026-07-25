import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { Router } from '@angular/router';
import { injectMutation, injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { FeatureControllerService } from '@/api/api/featureController.service';
import { ProjectControllerService } from '@/api/api/projectController.service';
import { TaskControllerService } from '@/api/api/taskController.service';
import { CreateTaskRequest } from '@/api/model/createTaskRequest';
import { TaskDto } from '@/api/model/taskDto';
import { UpdateTaskRequest } from '@/api/model/updateTaskRequest';
import { ZardButtonComponent } from '@/shared/components/button';
import { errorMessage } from '@/shared/utils/error-message';
import { TaskFormComponent, TaskFormData } from '@/ui/forms/task/task-form.component';

@Component({
  selector: 'app-task-create-update-form',
  imports: [TaskFormComponent, ZardButtonComponent],
  template: `
    @if (error(); as err) {
      <div class="mb-4 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
        {{ err }}
      </div>
    }
    <app-task-form
      [initialData]="initialData()"
      [loading]="createMutation.isPending() || updateMutation.isPending()"
      [mode]="task() ? 'edit' : 'create'"
      [repositoryOptions]="repositoryOptions()"
      [dependencyOptions]="dependencyOptions()"
      (submitted)="onSubmitted($event)"
    >
      <button formActions z-button zType="secondary" type="button" (click)="onCancel()">
        Cancel
      </button>
    </app-task-form>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TaskCreateUpdateFormComponent {
  readonly projectId = input.required<string>();
  readonly epicId = input.required<string>();
  readonly featureId = input.required<string>();
  readonly task = input<TaskDto>();
  readonly saved = output<void>();

  private readonly featureService = inject(FeatureControllerService);
  private readonly taskService = inject(TaskControllerService);
  private readonly projectService = inject(ProjectControllerService);
  private readonly queryClient = inject(QueryClient);
  private readonly router = inject(Router);

  readonly initialData = computed(() => {
    const t = this.task();
    return t
      ? {
          title: t.title ?? '',
          description: t.description ?? '',
          repositoryId: t.repositoryId ?? '',
          dependsOnTaskId: t.dependsOnTaskId ?? '',
        }
      : undefined;
  });

  // Same key/shape as app-project-repository-list so they share a cache entry.
  readonly repositoriesQuery = injectQuery(() => ({
    queryKey: ['project-repositories', this.projectId()],
    queryFn: () =>
      lastValueFrom(this.projectService.apiProjectsProjectIdRepositoriesGet(this.projectId())).then(
        (r) =>
          r.entries?.map((e) => e.repository!).filter((p): p is NonNullable<typeof p> => !!p) ?? []
      ),
  }));

  readonly repositoryOptions = computed(() =>
    (this.repositoriesQuery.data() ?? []).map((r) => ({ id: r.id!, url: r.url ?? r.id! }))
  );

  // Same key/shape as app-feature-task-list so they share a cache entry.
  readonly siblingsQuery = injectQuery(() => ({
    queryKey: ['feature-tasks', this.featureId()],
    queryFn: () =>
      lastValueFrom(this.featureService.apiFeaturesFeatureIdTasksGet(this.featureId())).then(
        (r) => r.entries?.map((e) => e.task!).filter((p): p is NonNullable<typeof p> => !!p) ?? []
      ),
  }));

  readonly dependencyOptions = computed(() =>
    (this.siblingsQuery.data() ?? [])
      .filter((t) => t.id !== this.task()?.id)
      .map((t) => ({ id: t.id!, title: t.title ?? t.id! }))
  );

  readonly error = computed(() => {
    const err = this.createMutation.error() ?? this.updateMutation.error();
    return err ? errorMessage(err, 'Failed to save the task') : null;
  });

  readonly createMutation = injectMutation(() => ({
    mutationFn: (req: CreateTaskRequest) =>
      lastValueFrom(this.featureService.apiFeaturesFeatureIdTasksPost(this.featureId(), req)),
    onSuccess: () => {
      this.queryClient.invalidateQueries({ queryKey: ['feature-tasks', this.featureId()] });
      this.queryClient.invalidateQueries({ queryKey: ['epic-audit', this.epicId()] });
      this.router.navigate([
        '/projects',
        this.projectId(),
        'epics',
        this.epicId(),
        'features',
        this.featureId(),
      ]);
      this.saved.emit();
    },
  }));

  readonly updateMutation = injectMutation(() => ({
    mutationFn: (req: UpdateTaskRequest) =>
      lastValueFrom(this.taskService.apiTasksIdPut(this.task()!.id!, req)),
    onSuccess: () => {
      const id = this.task()!.id!;
      this.queryClient.invalidateQueries({ queryKey: ['feature-tasks', this.featureId()] });
      this.queryClient.invalidateQueries({ queryKey: ['task', id] });
      this.queryClient.invalidateQueries({ queryKey: ['epic-audit', this.epicId()] });
      this.router.navigate([
        '/projects',
        this.projectId(),
        'epics',
        this.epicId(),
        'features',
        this.featureId(),
        'tasks',
        id,
      ]);
      this.saved.emit();
    },
  }));

  onSubmitted(data: TaskFormData) {
    if (this.task()) {
      // The repository binding is immutable after create (UpdateTaskRequest has no repositoryId);
      // clearing a previously-set dependency needs the explicit flag (PUT is a partial update).
      this.updateMutation.mutate({
        title: data.title,
        description: data.description || undefined,
        dependsOnTaskId: data.dependsOnTaskId || undefined,
        clearDependsOn: !data.dependsOnTaskId && !!this.task()!.dependsOnTaskId ? true : undefined,
      });
    } else {
      this.createMutation.mutate({
        repositoryId: data.repositoryId,
        title: data.title,
        description: data.description || undefined,
        dependsOnTaskId: data.dependsOnTaskId || undefined,
      });
    }
  }

  onCancel() {
    const t = this.task();
    const base = ['/projects', this.projectId(), 'epics', this.epicId(), 'features', this.featureId()];
    if (t) {
      this.router.navigate([...base, 'tasks', t.id]);
    } else {
      this.router.navigate(base);
    }
  }
}
