import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { injectMutation, injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { AgentControllerService } from '@/api/api/agentController.service';
import { RepositoryControllerService } from '@/api/api/repositoryController.service';
import { WorkspaceControllerService } from '@/api/api/workspaceController.service';
import { AgentMcpScope } from '@/api/model/agentMcpScope';
import { PageLayoutComponent } from '@/layout/page-layout/page-layout.component';
import { RepositoryDetailHeaderComponent } from '@/ui/components/repository/repository-detail-header.component';
import { BranchListComponent } from '@/pattern/repository/branch-list.component';
import { RepositorySubmodulesComponent } from '@/pattern/repository/repository-submodules.component';
import { RepositorySyncComponent } from '@/pattern/repository/repository-sync.component';
import { ZardButtonComponent } from '@/shared/components/button';

@Component({
  selector: 'app-repository-detail-page',
  imports: [
    PageLayoutComponent,
    RepositoryDetailHeaderComponent,
    BranchListComponent,
    RepositorySubmodulesComponent,
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
        <a z-button zType="secondary" [routerLink]="['/repositories', repoId, 'daemons']">Daemons</a>
        <a z-button zType="secondary" [routerLink]="['/repositories', repoId, 'bootstrap']">
          Bootstrap
        </a>
        <a z-button zType="secondary" [routerLink]="['/repositories', repoId, 'history']">History</a>
        <!-- Re-read and reconcile the repository's committed .qits-config.yml from the main branch.
             Also runs automatically on clone and on sync; this is the manual trigger. -->
        <button
          z-button
          zType="secondary"
          (click)="reloadConfigMutation.mutate()"
          [zLoading]="reloadConfigMutation.isPending()"
        >
          Reload config
        </button>
        <!-- Launches Claude Code in the main workspace with the actions MCP scoped to this repo plus
             the repository MCP narrowed to it, so both actions and repository-owned configuration
             (daemons) can be managed from inside Claude. -->
        <button
          z-button
          zType="secondary"
          (click)="configureWithClaude()"
          [zDisabled]="!canConfigureWithClaude()"
        >
          Configure with Claude
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

      <!-- Surface a failed agent launch instead of the old silent no-op: the usual cause is a lost
           container the backend now re-provisions, but a genuinely dead branch or unreachable
           git-host reports here so the button never just does nothing. -->
      @if (agentError(); as error) {
        <div class="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {{ error }}
        </div>
      }

      <!-- A .qits-config.yml parse or per-entry validation problem. Ingestion "degrades loudly,
           never blocks": the last-good declared config is kept and the problem surfaces here. -->
      @if (configWarning(); as warning) {
        <div
          class="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400"
        >
          <div class="font-medium">Problem in .qits-config.yml</div>
          <pre class="mt-1 whitespace-pre-wrap font-mono text-xs">{{ warning }}</pre>
        </div>
      }

      <div class="flex flex-col gap-6">
        <app-repository-sync [repoId]="repoId" />
        <app-repository-submodules [repoId]="repoId" />
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
  private readonly workspaceService = inject(WorkspaceControllerService);
  private readonly agentService = inject(AgentControllerService);
  private readonly queryClient = inject(QueryClient);

  readonly repoId = this.route.snapshot.paramMap.get('repoId')!;

  readonly repositoryQuery = injectQuery(() => ({
    queryKey: ['repository', this.repoId],
    queryFn: () =>
      lastValueFrom(
        this.repositoryService.apiRepositoriesRepoIdGet(this.repoId)
      ).then((r) => r.repository!),
  }));

  readonly mainBranch = computed(() => this.repositoryQuery.data()?.mainBranch ?? null);

  readonly configWarning = computed(() => this.repositoryQuery.data()?.configWarning ?? null);

  readonly canConfigureWithClaude = computed(() => !!this.mainBranch());

  /** Manually re-reads and reconciles .qits-config.yml, then refreshes the repository (warning). */
  readonly reloadConfigMutation = injectMutation(() => ({
    mutationFn: () =>
      lastValueFrom(this.repositoryService.apiRepositoriesRepoIdConfigReloadPost(this.repoId)),
    onSuccess: () =>
      this.queryClient.invalidateQueries({ queryKey: ['repository', this.repoId] }),
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

  // Launch a Claude agent in the workspace backing a branch (resolving the workspace from the branch),
  // then open its command terminal. The process is owned by the backend registry and survives
  // navigation.
  /** The last agent-launch failure, surfaced as a banner (cleared when a launch starts/succeeds). */
  readonly agentError = signal<string | null>(null);

  readonly agentMutation = injectMutation(() => ({
    mutationFn: async (vars: { branch: string; scope: AgentMcpScope }) => {
      const workspaces = await lastValueFrom(
        this.workspaceService.apiRepositoriesRepoIdWorkspacesGet(this.repoId),
      );
      const workspaceId = workspaces.entries
        ?.map((e) => e.workspace)
        .find((w) => w?.branch === vars.branch)?.workspaceId;
      if (!workspaceId) {
        throw new Error('No workspace backs branch ' + vars.branch);
      }
      return lastValueFrom(
        this.agentService.apiRepositoriesRepoIdWorkspacesWorkspaceIdAgentsPost(
          this.repoId,
          workspaceId,
          { scope: vars.scope },
        ),
      );
    },
    onSuccess: (res) => {
      this.agentError.set(null);
      const commandId = res.command?.id;
      if (commandId) {
        this.router.navigate(['/commands', commandId]);
      }
    },
    onError: (error: unknown) => this.agentError.set(this.errorMessage(error)),
  }));

  /** Open Claude Code in the main workspace, with the actions + repository MCP scoped to this repo. */
  configureWithClaude() {
    const branch = this.mainBranch();
    if (!branch) return;
    this.agentError.set(null);
    this.agentMutation.mutate({ branch, scope: AgentMcpScope.Actions });
  }

  /** A human-readable message from a failed launch: the backend {@code {message}} body, or fallback. */
  private errorMessage(error: unknown): string {
    const httpError = error as { error?: unknown; message?: string } | null;
    const body = httpError?.error;
    if (typeof body === 'string' && body.trim()) return body;
    if (body && typeof body === 'object') {
      const message = (body as { message?: unknown }).message;
      if (typeof message === 'string' && message.trim()) return message;
    }
    return httpError?.message ?? 'Failed to launch the agent';
  }

  onDelete() {
    if (confirm('Are you sure you want to delete this repository?')) {
      this.deleteMutation.mutate();
    }
  }
}
