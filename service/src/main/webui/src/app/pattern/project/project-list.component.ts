import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { ProjectControllerService } from '@/api/api/projectController.service';
import { EmptyStateComponent } from '@/ui/components/empty-state/empty-state.component';
import { ProjectCardComponent } from '@/ui/components/project/project-card.component';

@Component({
  selector: 'app-project-list',
  imports: [ProjectCardComponent, EmptyStateComponent],
  template: `
    @if (projectsQuery.isPending()) {
      <div class="py-12 text-center text-muted-foreground">Loading projects…</div>
    } @else if (projectsQuery.isError()) {
      <div class="py-12 text-center text-destructive">Failed to load projects</div>
    } @else {
      @let projects = projectsQuery.data() ?? [];
      @if (projects.length === 0) {
        <app-empty-state>
          <span title>No projects yet</span>
          <span description>Create your first project to get started</span>
        </app-empty-state>
      } @else {
        <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          @for (project of projects; track project.id) {
            <app-project-card [project]="project" />
          }
        </div>
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectListComponent {
  private readonly projectService = inject(ProjectControllerService);

  readonly projectsQuery = injectQuery(() => ({
    queryKey: ['projects'],
    queryFn: () =>
      lastValueFrom(this.projectService.apiProjectsGet()).then(
        (r) => r.entries?.map((e) => e.project!).filter((p): p is NonNullable<typeof p> => !!p) ?? []
      ),
  }));
}
