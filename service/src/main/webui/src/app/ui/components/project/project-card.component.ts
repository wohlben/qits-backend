import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { ProjectControllerService } from '@/api/api/projectController.service';
import { ProjectDto } from '@/api/model/projectDto';
import { CardLayoutComponent } from '@/layout/card-layout/card-layout.component';

@Component({
  selector: 'app-project-card',
  imports: [RouterLink, CardLayoutComponent],
  template: `
    <app-card-layout [hasActions]="false">
      <a cardTitle [routerLink]="['/projects', project().id]" class="hover:underline">
        <h3 class="font-semibold">{{ project().name }}</h3>
      </a>

      <p class="text-sm text-muted-foreground line-clamp-2">{{ project().description }}</p>

      <div class="mt-2 flex items-center gap-1 text-sm text-muted-foreground">
        @if (reposQuery.isPending()) {
          <span>…</span>
        } @else {
          <span>{{ repoCount() }} repository{{ repoCount() === 1 ? '' : 'ies' }}</span>
        }
      </div>
    </app-card-layout>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectCardComponent {
  readonly project = input.required<ProjectDto>();

  private readonly projectService = inject(ProjectControllerService);

  readonly reposQuery = injectQuery(() => ({
    queryKey: ['project-repositories', this.project().id],
    queryFn: () =>
      lastValueFrom(
        this.projectService.apiProjectsProjectIdRepositoriesGet(this.project().id!)
      ).then((r) => r.entries ?? []),
  }));

  readonly repoCount = () => this.reposQuery.data()?.length ?? 0;
}
