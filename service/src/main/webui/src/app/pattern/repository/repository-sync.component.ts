import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
  TemplateRef,
  viewChild,
} from '@angular/core';
import { injectMutation, injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { RepositoryControllerService } from '@/api/api/repositoryController.service';
import { TechnicalProcessViewComponent } from '@/pattern/workspace/technical-process-view.component';
import { ZardButtonComponent } from '@/shared/components/button';
import { ZardDialogRef, ZardDialogService } from '@/shared/components/dialog';
import { RepositorySyncBarComponent } from '@/ui/components/repository/repository-sync-bar.component';
import { invalidateRepository } from './invalidate-repository';

/**
 * Smart wrapper for the repository sync bar. Fetches the main branch's sync status and the
 * branch list, and owns the Pull / Sync / Push and main-branch mutations. Sync / Push / main-branch
 * invalidate the sync status (and branch tree) on success so the header reflects the new state.
 *
 * Pull and Sync are asynchronous: the POST registers a technical process and returns its id
 * immediately, so `onSuccess` opens a "Pulling repository" / "Syncing repository" dialog around the
 * streamed, segmented log (one segment per pulled repository, incl. imported submodules; sync
 * appends a final push segment). Invalidation fires when that process reaches `done` — not on the
 * POST, which returns before anything ran. Closing the dialog does not stop the process. Push stays
 * synchronous.
 */
@Component({
  selector: 'app-repository-sync',
  imports: [RepositorySyncBarComponent, TechnicalProcessViewComponent, ZardButtonComponent],
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

    <!-- Pull / Sync: the live, segmented log of the recursive pull (one segment per repo, imported
         submodules included; sync appends a push segment), streamed from its technical process.
         Closing the dialog does not stop the process — reopening within the retention window replays
         and resumes. -->
    <ng-template #processTpl>
      @if (processId(); as pid) {
        <app-technical-process-view [processId]="pid" (finished)="onProcessFinished()" />
      }
      <div class="mt-3 flex items-center gap-2">
        <button z-button zType="secondary" type="button" (click)="closeDialog()">Close</button>
      </div>
    </ng-template>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RepositorySyncComponent {
  readonly repoId = input.required<string>();

  private readonly repositoryService = inject(RepositoryControllerService);
  private readonly queryClient = inject(QueryClient);
  private readonly dialog = inject(ZardDialogService);

  private readonly processTpl = viewChild.required<TemplateRef<unknown>>('processTpl');
  private activeDialogRef?: ZardDialogRef<unknown>;

  /** The id of the running pull's technical process; drives the dialog's process view. */
  readonly processId = signal<string | null>(null);

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
    onSuccess: (res) => {
      // The pull runs asynchronously — invalidation happens on the process's `done`, not here.
      if (res.technicalProcessId) {
        this.processId.set(res.technicalProcessId);
        this.openDialog('Pulling repository');
      }
    },
  }));

  readonly pushMutation = injectMutation(() => ({
    mutationFn: () =>
      lastValueFrom(this.repositoryService.apiRepositoriesRepoIdPushPost(this.repoId())),
    onSuccess: () => this.onMutationSuccess(),
  }));

  readonly syncMutation = injectMutation(() => ({
    mutationFn: () =>
      lastValueFrom(this.repositoryService.apiRepositoriesRepoIdSyncPost(this.repoId())),
    onSuccess: (res) => {
      // Like pull, sync runs asynchronously — invalidation happens on the process's `done`, not here.
      if (res.technicalProcessId) {
        this.processId.set(res.technicalProcessId);
        this.openDialog('Syncing repository');
      }
    },
  }));

  readonly setMainBranchMutation = injectMutation(() => ({
    mutationFn: (branch: string) =>
      lastValueFrom(
        this.repositoryService.apiRepositoriesRepoIdMainBranchPut(this.repoId(), { branch }),
      ),
    onSuccess: () => this.onMutationSuccess(),
  }));

  /** The streamed pull reached `done`: refresh the header/tree so it shows the pulled state. */
  onProcessFinished() {
    invalidateRepository(this.queryClient, this.repoId());
  }

  /** Open the process dialog; hides the built-in footer (the template owns its Close button). */
  private openDialog(title: string) {
    this.activeDialogRef = this.dialog.create({
      zTitle: title,
      zContent: this.processTpl(),
      zHideFooter: true,
    });
  }

  closeDialog() {
    this.activeDialogRef?.close();
    this.activeDialogRef = undefined;
    this.processId.set(null);
    // Closing tears down the process view, so its (finished) invalidation may never fire. Refresh on
    // close too so the header/tree converge to the pulled state (a no-op refetch if it already did).
    invalidateRepository(this.queryClient, this.repoId());
  }

  private onMutationSuccess() {
    invalidateRepository(this.queryClient, this.repoId());
  }
}
