import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { injectMutation, injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { AgentControllerService } from '@/api/api/agentController.service';
import { ProjectControllerService } from '@/api/api/projectController.service';
import { WorkspaceControllerService } from '@/api/api/workspaceController.service';
import { AgentMcpScope } from '@/api/model/agentMcpScope';
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
        <!-- Launches Claude Code in a repository's main workspace with the repository MCP scoped to
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
  private readonly workspaceService = inject(WorkspaceControllerService);
  private readonly agentService = inject(AgentControllerService);
  private readonly queryClient = inject(QueryClient);

  readonly projectId = this.route.snapshot.paramMap.get('id')!;

  readonly projectQuery = injectQuery(() => ({
    queryKey: ['project', this.projectId],
    queryFn: () =>
      lastValueFrom(this.projectService.apiProjectsIdGet(this.projectId)).then((r) => r.project!),
  }));

  // The project's repositories — same key/shape as app-project-repository-list so they share a
  // cache entry. Used to pick a main workspace to start the project-scoped Claude session in.
  readonly repositoriesQuery = injectQuery(() => ({
    queryKey: ['project-repositories', this.projectId],
    queryFn: () =>
      lastValueFrom(this.projectService.apiProjectsProjectIdRepositoriesGet(this.projectId)).then(
        (r) =>
          r.entries?.map((e) => e.repository!).filter((p): p is RepositoryDto => !!p) ?? [],
      ),
  }));

  // The project session still runs in a checkout, so pick the first repository that has a main
  // branch to host the terminal — the MCP scope spans the whole project regardless of which one.
  readonly launchTarget = computed(
    () => (this.repositoriesQuery.data() ?? []).find((r) => !!r.id && !!r.mainBranch) ?? null,
  );

  readonly canConfigureWithClaude = computed(() => !!this.launchTarget());

  readonly deleteMutation = injectMutation(() => ({
    mutationFn: () =>
      lastValueFrom(this.projectService.apiProjectsIdDelete(this.projectId)),
    onSuccess: () => {
      this.queryClient.invalidateQueries({ queryKey: ['projects'] });
      this.router.navigate(['/projects']);
    },
  }));

  // Launch the project-scoped Claude session in a host repository's main workspace (resolving the
  // workspace from its branch), then open its command terminal. The process is owned by the registry.
  readonly agentMutation = injectMutation(() => ({
    mutationFn: async (vars: { repoId: string; branch: string }) => {
      const workspaces = await lastValueFrom(
        this.workspaceService.apiRepositoriesRepoIdWorkspacesGet(vars.repoId),
      );
      const workspaceId = workspaces.entries
        ?.map((e) => e.workspace)
        .find((w) => w?.branch === vars.branch)?.workspaceId;
      if (!workspaceId) {
        throw new Error('No workspace backs branch ' + vars.branch);
      }
      return lastValueFrom(
        this.agentService.apiRepositoriesRepoIdWorkspacesWorkspaceIdAgentsPost(
          vars.repoId,
          workspaceId,
          { scope: AgentMcpScope.Project },
        ),
      );
    },
    onSuccess: (res) => {
      const commandId = res.command?.id;
      if (commandId) {
        this.router.navigate(['/commands', commandId]);
      }
    },
  }));

  /** Open the project-scoped Claude session in a host repository's main workspace. */
  configureWithClaude() {
    const target = this.launchTarget();
    if (!target?.id || !target.mainBranch) return;
    this.agentMutation.mutate({ repoId: target.id, branch: target.mainBranch });
  }

  onDelete() {
    if (confirm('Are you sure you want to delete this project?')) {
      this.deleteMutation.mutate();
    }
  }
}
