import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { injectMutation, injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { RepositoryControllerService } from '@/api/api/repositoryController.service';
import { RepositorySyncBarComponent } from '@/ui/components/repository/repository-sync-bar.component';
import { invalidateRepository } from './invalidate-repository';

/**
 * Smart wrapper for the repository sync bar. Fetches the main branch's sync status and the
 * branch list, and owns the Pull / Sync / Push and main-branch mutations. Every mutation
 * invalidates the sync status (and branch tree) so the header reflects the new state.
 */
@Component({
  selector: 'app-repository-sync',
  imports: [RepositorySyncBarComponent],
  template: `
    <app-repository-sync-bar
      [branch]="branch()"
      [branches]="branches()"
      [status]="syncStatusQuery.data() ?? null"
      [statusPending]="syncStatusQuery.isPending()"
      [pullPending]="pullMutation.isPending()"
      [syncPending]="syncMutation.isPending()"
      [pushPending]="pushMutation.isPending()"
      [mainBranchPending]="setMainBranchMutation.isPending()"
      (mainBranchChange)="setMainBranchMutation.mutate($event)"
      (pull)="pullMutation.mutate()"
      (sync)="syncMutation.mutate()"
      (push)="pushMutation.mutate()"
    />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RepositorySyncComponent {
  readonly repoId = input.required<string>();

  private readonly repositoryService = inject(RepositoryControllerService);
  private readonly queryClient = inject(QueryClient);

  readonly syncStatusQuery = injectQuery(() => ({
    queryKey: ['sync-status', this.repoId()],
    queryFn: () =>
      lastValueFrom(this.repositoryService.apiRepositoriesRepoIdSyncStatusGet(this.repoId())),
  }));

  // Shares the ['branches', repoId] cache entry with BranchListComponent, so the queryFn must
  // return the raw BranchDto[] (the API shape); the name list for the selector is derived below.
  readonly branchesQuery = injectQuery(() => ({
    queryKey: ['branches', this.repoId()],
    queryFn: () =>
      lastValueFrom(this.repositoryService.apiRepositoriesRepoIdBranchesGet(this.repoId())).then(
        (r) => r.branches ?? [],
      ),
  }));

  readonly branches = computed(() =>
    (this.branchesQuery.data() ?? []).map((b) => b.name).filter((n): n is string => !!n),
  );
  readonly branch = computed(() => this.syncStatusQuery.data()?.branch ?? '');

  readonly pullMutation = injectMutation(() => ({
    mutationFn: () =>
      lastValueFrom(this.repositoryService.apiRepositoriesRepoIdPullPost(this.repoId())),
    onSuccess: () => this.onMutationSuccess(),
  }));

  readonly pushMutation = injectMutation(() => ({
    mutationFn: () =>
      lastValueFrom(this.repositoryService.apiRepositoriesRepoIdPushPost(this.repoId())),
    onSuccess: () => this.onMutationSuccess(),
  }));

  readonly syncMutation = injectMutation(() => ({
    mutationFn: () =>
      lastValueFrom(this.repositoryService.apiRepositoriesRepoIdSyncPost(this.repoId())),
    onSuccess: () => this.onMutationSuccess(),
  }));

  readonly setMainBranchMutation = injectMutation(() => ({
    mutationFn: (branch: string) =>
      lastValueFrom(
        this.repositoryService.apiRepositoriesRepoIdMainBranchPut(this.repoId(), { branch }),
      ),
    onSuccess: () => this.onMutationSuccess(),
  }));

  private onMutationSuccess() {
    invalidateRepository(this.queryClient, this.repoId());
  }
}
