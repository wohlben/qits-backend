import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { injectMutation, injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { ActionConfigurationControllerService } from '@/api/api/actionConfigurationController.service';
import { CommandControllerService } from '@/api/api/commandController.service';
import { RepositoryControllerService } from '@/api/api/repositoryController.service';
import { WorktreeControllerService } from '@/api/api/worktreeController.service';
import { ActionConfigurationDto } from '@/api/model/actionConfigurationDto';
import { ActionVariant } from '@/api/model/actionVariant';
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
    RouterLink,
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

      <div pageActions class="flex items-center gap-2">
        <a z-button zType="secondary" [routerLink]="['/repositories', repoId, 'history']">History</a>
        <!-- Launches Claude Code in the main worktree with the actions MCP scoped to this repo, so
             repository-specific actions can be created from inside Claude. -->
        <button
          z-button
          zType="secondary"
          (click)="configureWithClaude()"
          [zDisabled]="!canConfigureWithClaude()"
        >
          Configure actions with Claude
        </button>
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
  private readonly worktreeService = inject(WorktreeControllerService);
  private readonly commandService = inject(CommandControllerService);
  private readonly actionConfigService = inject(ActionConfigurationControllerService);
  private readonly queryClient = inject(QueryClient);

  readonly repoId = this.route.snapshot.paramMap.get('repoId')!;

  readonly repositoryQuery = injectQuery(() => ({
    queryKey: ['repository', this.repoId],
    queryFn: () =>
      lastValueFrom(
        this.repositoryService.apiRepositoriesRepoIdGet(this.repoId)
      ).then((r) => r.repository!),
  }));

  // Global actions, same key/shape as elsewhere — used to find the CLAUDE_ACTIONS_MCP action.
  readonly actionConfigsQuery = injectQuery(() => ({
    queryKey: ['action-configurations'],
    queryFn: () =>
      lastValueFrom(this.actionConfigService.apiActionConfigurationsGet()).then(
        (r) =>
          r.entries
            ?.map((e) => e.actionConfiguration!)
            .filter((a): a is ActionConfigurationDto => !!a) ?? [],
      ),
  }));

  /** The seeded "Claude Code (actions MCP)" action, found by its typed variant (not its name). */
  readonly claudeActionId = computed(
    () =>
      (this.actionConfigsQuery.data() ?? []).find(
        (a) => a.variant === ActionVariant.ClaudeActionsMcp,
      )?.id ?? null,
  );

  readonly mainBranch = computed(() => this.repositoryQuery.data()?.mainBranch ?? null);

  readonly canConfigureWithClaude = computed(() => !!this.claudeActionId() && !!this.mainBranch());

  readonly deleteMutation = injectMutation(() => ({
    mutationFn: () =>
      lastValueFrom(this.repositoryService.apiRepositoriesRepoIdDelete(this.repoId)),
    onSuccess: () => {
      this.queryClient.invalidateQueries({ queryKey: ['projects'] });
      this.queryClient.invalidateQueries({ queryKey: ['project-repositories'] });
      this.router.navigate(['/projects']);
    },
  }));

  // Launch an action in the worktree backing a branch (resolving the worktree from the branch), then
  // open its command terminal. The process is owned by the backend registry and survives navigation.
  readonly launchMutation = injectMutation(() => ({
    mutationFn: async (vars: { branch: string; actionId: string }) => {
      const worktrees = await lastValueFrom(
        this.worktreeService.apiRepositoriesRepoIdWorktreesGet(this.repoId),
      );
      const worktreeId = worktrees.entries
        ?.map((e) => e.worktree)
        .find((w) => w?.branch === vars.branch)?.worktreeId;
      if (!worktreeId) {
        throw new Error('No worktree backs branch ' + vars.branch);
      }
      return lastValueFrom(
        this.commandService.apiCommandsPost({
          repoId: this.repoId,
          worktreeId,
          actionId: vars.actionId,
        }),
      );
    },
    onSuccess: (res) => {
      const commandId = res.command?.id;
      if (commandId) {
        this.router.navigate(['/commands', commandId]);
      }
    },
  }));

  /** Open Claude Code in the main worktree's terminal, scoped to this repo's actions MCP. */
  configureWithClaude() {
    const actionId = this.claudeActionId();
    const branch = this.mainBranch();
    if (!actionId || !branch) return;
    this.launchMutation.mutate({ branch, actionId });
  }

  onDelete() {
    if (confirm('Are you sure you want to delete this repository?')) {
      this.deleteMutation.mutate();
    }
  }
}
