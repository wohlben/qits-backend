import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { injectMutation, injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { FeatureControllerService } from '@/api/api/featureController.service';
import { RepositoryControllerService } from '@/api/api/repositoryController.service';
import { TaskControllerService } from '@/api/api/taskController.service';
import { UpdateTaskRequest } from '@/api/model/updateTaskRequest';
import { PageLayoutComponent } from '@/layout/page-layout/page-layout.component';
import { TaskDetailHeaderComponent } from '@/ui/components/task/task-detail-header.component';
import { ZardButtonComponent } from '@/shared/components/button';

@Component({
  selector: 'app-task-detail-page',
  imports: [PageLayoutComponent, RouterLink, TaskDetailHeaderComponent, ZardButtonComponent],
  template: `
    <app-page-layout
      [request]="taskQuery"
      pendingText="Loading task…"
      errorText="Failed to load task"
    >
      <ng-template #pageTitle let-task>
        <app-task-detail-header
          [task]="task"
          [projectId]="projectId"
          [epicId]="epicId"
          [repositoryUrl]="repositoryUrl()"
          [dependsOnTitle]="dependsOnTitle()"
        />
      </ng-template>

      <div pageActions>
        <button
          z-button
          zType="secondary"
          (click)="onToggleImplemented()"
          [zLoading]="implementedMutation.isPending()"
        >
          {{ taskQuery.data()?.implementedAt ? 'Unmark implemented' : 'Mark implemented' }}
        </button>
        <a
          z-button
          [routerLink]="[
            '/projects',
            projectId,
            'epics',
            epicId,
            'features',
            featureId,
            'tasks',
            taskId,
            'edit',
          ]"
        >
          Edit
        </a>
        <button
          z-button
          zType="destructive"
          (click)="onDelete()"
          [zLoading]="deleteMutation.isPending()"
        >
          Delete
        </button>
      </div>
    </app-page-layout>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TaskDetailPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly featureService = inject(FeatureControllerService);
  private readonly taskService = inject(TaskControllerService);
  private readonly repositoryService = inject(RepositoryControllerService);
  private readonly queryClient = inject(QueryClient);

  readonly projectId = this.route.snapshot.paramMap.get('projectId')!;
  readonly epicId = this.route.snapshot.paramMap.get('epicId')!;
  readonly featureId = this.route.snapshot.paramMap.get('featureId')!;
  readonly taskId = this.route.snapshot.paramMap.get('taskId')!;

  readonly taskQuery = injectQuery(() => ({
    queryKey: ['task', this.taskId],
    queryFn: () => lastValueFrom(this.taskService.apiTasksIdGet(this.taskId)).then((r) => r.task!),
  }));

  // Same key/shape as the repository detail page; resolves the bound repository's display URL.
  readonly repositoryQuery = injectQuery(() => ({
    queryKey: ['repository', this.taskQuery.data()?.repositoryId ?? ''],
    queryFn: () =>
      lastValueFrom(
        this.repositoryService.apiRepositoriesRepoIdGet(this.taskQuery.data()!.repositoryId!)
      ).then((r) => r.repository!),
    enabled: () => !!this.taskQuery.data()?.repositoryId,
  }));

  readonly repositoryUrl = computed(() => this.repositoryQuery.data()?.url);

  // Same key/shape as app-feature-task-list; resolves the depended-on sibling's title.
  readonly siblingsQuery = injectQuery(() => ({
    queryKey: ['feature-tasks', this.featureId],
    queryFn: () =>
      lastValueFrom(this.featureService.apiFeaturesFeatureIdTasksGet(this.featureId)).then(
        (r) => r.entries?.map((e) => e.task!).filter((p): p is NonNullable<typeof p> => !!p) ?? []
      ),
  }));

  readonly dependsOnTitle = computed(() => {
    const dependsOnId = this.taskQuery.data()?.dependsOnTaskId;
    if (!dependsOnId) return undefined;
    return this.siblingsQuery.data()?.find((t) => t.id === dependsOnId)?.title;
  });

  readonly implementedMutation = injectMutation(() => ({
    mutationFn: (req: UpdateTaskRequest) =>
      lastValueFrom(this.taskService.apiTasksIdPut(this.taskId, req)),
    onSuccess: () => this.invalidate(),
  }));

  readonly deleteMutation = injectMutation(() => ({
    mutationFn: () => lastValueFrom(this.taskService.apiTasksIdDelete(this.taskId)),
    onSuccess: () => {
      this.invalidate();
      this.router.navigate([
        '/projects',
        this.projectId,
        'epics',
        this.epicId,
        'features',
        this.featureId,
      ]);
    },
  }));

  onToggleImplemented() {
    if (this.taskQuery.data()?.implementedAt) {
      this.implementedMutation.mutate({ clearImplementedAt: true });
    } else {
      this.implementedMutation.mutate({ implementedAt: new Date().toISOString() });
    }
  }

  onDelete() {
    if (confirm('Are you sure you want to delete this task?')) {
      this.deleteMutation.mutate();
    }
  }

  private invalidate() {
    this.queryClient.invalidateQueries({ queryKey: ['feature-tasks', this.featureId] });
    this.queryClient.invalidateQueries({ queryKey: ['task', this.taskId] });
    this.queryClient.invalidateQueries({ queryKey: ['epic-audit', this.epicId] });
  }
}
