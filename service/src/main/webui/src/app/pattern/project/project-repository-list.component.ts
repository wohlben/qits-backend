import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { ProjectControllerService } from '@/api/api/projectController.service';
import { EmptyStateComponent } from '@/ui/components/empty-state/empty-state.component';
import { RepositoryCardComponent } from '@/ui/components/repository/repository-card.component';

@Component({
  selector: 'app-project-repository-list',
  imports: [RepositoryCardComponent, EmptyStateComponent],
  template: `
    <div class="flex flex-col gap-4">
      <h2 class="text-lg font-semibold">Repositories</h2>

      @if (repositoriesQuery.isPending()) {
        <div class="text-sm text-muted-foreground">Loading repositories…</div>
      } @else if (repositoriesQuery.isError()) {
        <div class="text-sm text-destructive">Failed to load repositories</div>
      } @else {
        @let repos = repositoriesQuery.data() ?? [];
        @if (repos.length === 0) {
          <app-empty-state>
            <span title>No repositories</span>
            <span description>This project has no repositories yet</span>
          </app-empty-state>
        } @else {
          <div class="flex flex-col gap-2">
            @for (repo of repos; track repo.id) {
              <app-repository-card [repository]="repo" />
            }
          </div>
        }
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectRepositoryListComponent {
  readonly projectId = input.required<string>();

  private readonly projectService = inject(ProjectControllerService);

  readonly repositoriesQuery = injectQuery(() => ({
    queryKey: ['project-repositories', this.projectId()],
    queryFn: () =>
      lastValueFrom(
        this.projectService.apiProjectsProjectIdRepositoriesGet(this.projectId())
      ).then(
        (r) =>
          r.entries?.map((e) => e.repository!).filter((p): p is NonNullable<typeof p> => !!p) ??
          []
      ),
  }));
}
