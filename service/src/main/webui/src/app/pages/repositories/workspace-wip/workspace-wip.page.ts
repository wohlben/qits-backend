import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { WorkspaceControllerService } from '@/api/api/workspaceController.service';
import { WorkspaceDto } from '@/api/model/workspaceDto';
import { PageLayoutComponent } from '@/layout/page-layout/page-layout.component';
import { WorkspacePromptPanelComponent } from '@/pattern/speech/workspace-prompt-panel.component';

/**
 * The "work in progress" page of a workspace: decide what to do in it by speaking. Speech is
 * transcribed locally in the browser, refined into a coherent prompt by a small Claude model, and
 * launched as this workspace's agent.
 */
@Component({
  selector: 'app-workspace-wip-page',
  imports: [PageLayoutComponent, WorkspacePromptPanelComponent],
  template: `
    <app-page-layout
      [request]="workspacesQuery"
      pendingText="Loading workspace…"
      errorText="Failed to load workspace"
    >
      <ng-template #pageTitle>
        <div class="flex flex-col gap-1">
          <h1 class="text-2xl font-semibold">{{ workspaceId }}</h1>
          @if (workspace(); as wt) {
            <span class="text-sm text-muted-foreground">
              {{ wt.branch }}
              @if (wt.parent) {
                <span> · forked from {{ wt.parent }}</span>
              }
            </span>
          }
        </div>
      </ng-template>

      <app-workspace-prompt-panel
        [repoId]="repoId"
        [workspaceId]="workspaceId"
        [preamble]="workspace()?.preamble ?? null"
      />
    </app-page-layout>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkspaceWipPage {
  private readonly route = inject(ActivatedRoute);
  private readonly workspaceService = inject(WorkspaceControllerService);

  readonly repoId = this.route.snapshot.paramMap.get('repoId')!;
  readonly workspaceId = this.route.snapshot.paramMap.get('workspaceId')!;

  // Same key AND shape as the branch list's workspaces query, so both share one cache entry.
  readonly workspacesQuery = injectQuery(() => ({
    queryKey: ['workspaces', this.repoId],
    queryFn: () =>
      lastValueFrom(this.workspaceService.apiRepositoriesRepoIdWorkspacesGet(this.repoId)).then(
        (r) => r.entries?.map((e) => e.workspace!).filter((w): w is WorkspaceDto => !!w) ?? [],
      ),
  }));

  readonly workspace = computed(
    () => (this.workspacesQuery.data() ?? []).find((w) => w.workspaceId === this.workspaceId) ?? null,
  );
}
