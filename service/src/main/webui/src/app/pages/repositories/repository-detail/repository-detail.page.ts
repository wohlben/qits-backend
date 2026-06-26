import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { injectMutation, injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { RepositoryControllerService } from '@/api/api/repositoryController.service';
import { PageLayoutComponent } from '@/layout/page-layout/page-layout.component';
import { RepositoryDetailHeaderComponent } from '@/ui/components/repository/repository-detail-header.component';
import { BranchListComponent } from '@/pattern/repository/branch-list.component';
import { RepositorySyncComponent } from '@/pattern/repository/repository-sync.component';
import { ZardButtonComponent } from '@/shared/components/button';

@Component({
  selector: 'app-repository-detail-page',
  imports: [
    PageLayoutComponent,
    RepositoryDetailHeaderComponent,
    BranchListComponent,
    RepositorySyncComponent,
    ZardButtonComponent,
  ],
  template: `
    <app-page-layout
      [request]="repositoryQuery"
      pendingText="Loading repository…"
      errorText="Failed to load repository"
    >
      <ng-template #pageTitle let-repository>
        <app-repository-detail-header [repository]="repository" />
      </ng-template>

      <div pageActions>
        <button
          z-button
          zType="destructive"
          (click)="onDelete()"
          [zLoading]="deleteMutation.isPending()"
        >
          Delete
        </button>
      </div>

      <div class="flex flex-col gap-6">
        <app-repository-sync [repoId]="repoId" />
        <app-branch-list [repoId]="repoId" />
      </div>
    </app-page-layout>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RepositoryDetailPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly repositoryService = inject(RepositoryControllerService);
  private readonly queryClient = inject(QueryClient);

  readonly repoId = this.route.snapshot.paramMap.get('repoId')!;

  readonly repositoryQuery = injectQuery(() => ({
    queryKey: ['repository', this.repoId],
    queryFn: () =>
      lastValueFrom(
        this.repositoryService.apiRepositoriesRepoIdGet(this.repoId)
      ).then((r) => r.repository!),
  }));

  readonly deleteMutation = injectMutation(() => ({
    mutationFn: () =>
      lastValueFrom(this.repositoryService.apiRepositoriesRepoIdDelete(this.repoId)),
    onSuccess: () => {
      this.queryClient.invalidateQueries({ queryKey: ['projects'] });
      this.queryClient.invalidateQueries({ queryKey: ['project-repositories'] });
      this.router.navigate(['/projects']);
    },
  }));

  onDelete() {
    if (confirm('Are you sure you want to delete this repository?')) {
      this.deleteMutation.mutate();
    }
  }
}
