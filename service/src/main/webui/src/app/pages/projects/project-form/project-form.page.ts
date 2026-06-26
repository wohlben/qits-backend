import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { ProjectControllerService } from '@/api/api/projectController.service';
import { PageLayoutComponent } from '@/layout/page-layout/page-layout.component';
import { ProjectCreateUpdateFormComponent } from '@/pattern/project/project-create-update-form.component';

@Component({
  selector: 'app-project-form-page',
  imports: [PageLayoutComponent, ProjectCreateUpdateFormComponent],
  template: `
    <app-page-layout [hasActions]="false">
      <div pageTitle>
        <h1 class="text-2xl font-bold">{{ isEdit() ? 'Edit Project' : 'New Project' }}</h1>
      </div>
      @if (isEdit() && projectQuery.isPending()) {
        <div class="text-muted-foreground">Loading project…</div>
      } @else if (isEdit() && projectQuery.isError()) {
        <div class="text-destructive">Failed to load project</div>
      } @else {
        <app-project-create-update-form [project]="project()" />
      }
    </app-page-layout>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectFormPage {
  private readonly route = inject(ActivatedRoute);
  private readonly projectService = inject(ProjectControllerService);

  readonly projectId = this.route.snapshot.paramMap.get('id');

  readonly projectQuery = injectQuery(() => ({
    queryKey: ['project', this.projectId ?? ''],
    queryFn: () =>
      lastValueFrom(this.projectService.apiProjectsIdGet(this.projectId!)).then((r) => r.project!),
    enabled: () => !!this.projectId,
  }));

  readonly project = computed(() => this.projectQuery.data());
  readonly isEdit = computed(() => !!this.projectId);
}
