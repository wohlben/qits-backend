import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { injectMutation, injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { ActionConfigurationControllerService } from '@/api/api/actionConfigurationController.service';
import { CommandControllerService } from '@/api/api/commandController.service';
import { ProjectControllerService } from '@/api/api/projectController.service';
import { WorktreeControllerService } from '@/api/api/worktreeController.service';
import { ActionConfigurationDto } from '@/api/model/actionConfigurationDto';
import { ActionVariant } from '@/api/model/actionVariant';
import { RepositoryDto } from '@/api/model/repositoryDto';
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
        <!-- Launches Claude Code in a repository's main worktree with the repository MCP scoped to
             the whole project (no single-repository narrowing), so every repository is in reach. -->
        <button
          z-button
          zType="secondary"
          (click)="configureWithClaude()"
          [zDisabled]="!canConfigureWithClaude()"
        >
          Configure project with Claude
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

      <app-project-repository-list [projectId]="projectId" />
    </app-page-layout>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectDetailPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly projectService = inject(ProjectControllerService);
  private readonly worktreeService = inject(WorktreeControllerService);
  private readonly commandService = inject(CommandControllerService);
  private readonly actionConfigService = inject(ActionConfigurationControllerService);
  private readonly queryClient = inject(QueryClient);

  readonly projectId = this.route.snapshot.paramMap.get('id')!;

  readonly projectQuery = injectQuery(() => ({
    queryKey: ['project', this.projectId],
    queryFn: () =>
      lastValueFrom(this.projectService.apiProjectsIdGet(this.projectId)).then((r) => r.project!),
  }));

  // The project's repositories — same key/shape as app-project-repository-list so they share a
  // cache entry. Used to pick a main worktree to start the project-scoped Claude session in.
  readonly repositoriesQuery = injectQuery(() => ({
    queryKey: ['project-repositories', this.projectId],
    queryFn: () =>
      lastValueFrom(this.projectService.apiProjectsProjectIdRepositoriesGet(this.projectId)).then(
        (r) =>
          r.entries?.map((e) => e.repository!).filter((p): p is RepositoryDto => !!p) ?? [],
      ),
  }));

  // Global actions, same key/shape as elsewhere — used to find the CLAUDE_PROJECT_MCP action.
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

  /** The seeded "Claude Code (project MCP)" action, found by its typed variant (not its name). */
  readonly claudeProjectActionId = computed(
    () =>
      (this.actionConfigsQuery.data() ?? []).find(
        (a) => a.variant === ActionVariant.ClaudeProjectMcp,
      )?.id ?? null,
  );

  // The project session still runs in a checkout, so pick the first repository that has a main
  // branch to host the terminal — the MCP scope spans the whole project regardless of which one.
  readonly launchTarget = computed(
    () => (this.repositoriesQuery.data() ?? []).find((r) => !!r.id && !!r.mainBranch) ?? null,
  );

  readonly canConfigureWithClaude = computed(
    () => !!this.claudeProjectActionId() && !!this.launchTarget(),
  );

  readonly deleteMutation = injectMutation(() => ({
    mutationFn: () =>
      lastValueFrom(this.projectService.apiProjectsIdDelete(this.projectId)),
    onSuccess: () => {
      this.queryClient.invalidateQueries({ queryKey: ['projects'] });
      this.router.navigate(['/projects']);
    },
  }));

  // Launch the project-scoped Claude session in a host repository's main worktree (resolving the
  // worktree from its branch), then open its command terminal. The process is owned by the registry.
  readonly launchMutation = injectMutation(() => ({
    mutationFn: async (vars: { repoId: string; branch: string; actionId: string }) => {
      const worktrees = await lastValueFrom(
        this.worktreeService.apiRepositoriesRepoIdWorktreesGet(vars.repoId),
      );
      const worktreeId = worktrees.entries
        ?.map((e) => e.worktree)
        .find((w) => w?.branch === vars.branch)?.worktreeId;
      if (!worktreeId) {
        throw new Error('No worktree backs branch ' + vars.branch);
      }
      return lastValueFrom(
        this.commandService.apiCommandsPost({
          repoId: vars.repoId,
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

  /** Open the project-scoped Claude session in a host repository's main worktree. */
  configureWithClaude() {
    const actionId = this.claudeProjectActionId();
    const target = this.launchTarget();
    if (!actionId || !target?.id || !target.mainBranch) return;
    this.launchMutation.mutate({ repoId: target.id, branch: target.mainBranch, actionId });
  }

  onDelete() {
    if (confirm('Are you sure you want to delete this project?')) {
      this.deleteMutation.mutate();
    }
  }
}
