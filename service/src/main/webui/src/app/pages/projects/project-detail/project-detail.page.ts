import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { injectMutation, injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { ProjectControllerService } from '@/api/api/projectController.service';
import { PageLayoutComponent } from '@/layout/page-layout/page-layout.component';
import { ProjectDetailHeaderComponent } from '@/ui/components/project/project-detail-header.component';
import { ProjectRepositoryListComponent } from '@/pattern/project/project-repository-list.component';
import { ZardButtonComponent } from '@/shared/components/button';

@Component({
  selector: 'app-project-detail-page',
  imports: [
    PageLayoutComponent,
    ProjectDetailHeaderComponent,
    ProjectRepositoryListComponent,
    RouterLink,
    ZardButtonComponent,
  ],
  template: `
    <app-page-layout
      [request]="projectQuery"
      pendingText="Loading project…"
      errorText="Failed to load project"
    >
      <ng-template #pageTitle let-project>
        <app-project-detail-header [project]="project" />
      </ng-template>

      <div pageActions>
        <a
          z-button
          zType="secondary"
          [routerLink]="['/projects', projectId, 'repositories', 'new']"
        >
          Add Repository
        </a>
        <a
          z-button
          zType="secondary"
          [routerLink]="['/projects', projectId, 'feature-flows', 'new']"
        >
          New Feature Flow
        </a>
        <a z-button [routerLink]="['/projects', projectId, 'edit']">Edit</a>
        <button
          z-button
          zType="destructive"
          (click)="onDelete()"
          [zLoading]="deleteMutation.isPending()"
        >
          Delete
        </button>
      </div>

      <app-project-repository-list [projectId]="projectId" />
    </app-page-layout>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectDetailPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly projectService = inject(ProjectControllerService);
  private readonly queryClient = inject(QueryClient);

  readonly projectId = this.route.snapshot.paramMap.get('id')!;

  readonly projectQuery = injectQuery(() => ({
    queryKey: ['project', this.projectId],
    queryFn: () =>
      lastValueFrom(this.projectService.apiProjectsIdGet(this.projectId)).then((r) => r.project!),
  }));

  readonly deleteMutation = injectMutation(() => ({
    mutationFn: () =>
      lastValueFrom(this.projectService.apiProjectsIdDelete(this.projectId)),
    onSuccess: () => {
      this.queryClient.invalidateQueries({ queryKey: ['projects'] });
      this.router.navigate(['/projects']);
    },
  }));

  onDelete() {
    if (confirm('Are you sure you want to delete this project?')) {
      this.deleteMutation.mutate();
    }
  }
}
