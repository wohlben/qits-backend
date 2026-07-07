import { ChangeDetectionStrategy, Component, computed, inject, viewChild } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { WorkspaceControllerService } from '@/api/api/workspaceController.service';
import { WorkspaceDto } from '@/api/model/workspaceDto';
import { PageLayoutComponent } from '@/layout/page-layout/page-layout.component';
import { DaemonWebviewComponent } from '@/pattern/daemon/webview/daemon-webview.component';
import {
  DaemonEventFileAnchor,
  WorkspaceDaemonEventsComponent,
} from '@/pattern/daemon/workspace-daemon-events.component';
import { WorkspaceDaemonsComponent } from '@/pattern/daemon/workspace-daemons.component';
import { WorkspaceTelemetryComponent } from '@/pattern/telemetry/workspace-telemetry.component';
import { WorkspaceChatComponent } from '@/pattern/workspace/workspace-chat.component';
import { WorkspaceFileBrowserComponent } from '@/pattern/workspace/workspace-file-browser.component';
import { WorkspaceLiveService } from '@/pattern/workspace/workspace-live.service';
import { WorkspacePluginsComponent } from '@/pattern/workspace/workspace-plugins.component';
import { ZardTabComponent, ZardTabGroupComponent } from '@/shared/components/tabs';

/**
 * The workspace detail page: browse the workspace's files with a tree + syntax-highlighted viewer,
 * and chat with the workspace's agent in a full-size dialog (the header's Chat button). The older
 * speak-to-prompt page stays reachable at `…/wip` (unlinked, kept for prototyping).
 */
@Component({
  selector: 'app-workspace-detail-page',
  imports: [
    DaemonWebviewComponent,
    PageLayoutComponent,
    WorkspaceChatComponent,
    WorkspaceDaemonEventsComponent,
    WorkspaceDaemonsComponent,
    WorkspaceFileBrowserComponent,
    WorkspacePluginsComponent,
    WorkspaceTelemetryComponent,
    ZardTabComponent,
    ZardTabGroupComponent,
  ],
  providers: [WorkspaceLiveService],
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

      <ng-template #pageActions>
        <app-workspace-chat
          [repoId]="repoId"
          [workspaceId]="workspaceId"
          [preamble]="workspace()?.preamble ?? null"
        />
      </ng-template>

      <div class="flex flex-col gap-6">
        <app-workspace-daemons [repoId]="repoId" [workspaceId]="workspaceId" />
        <!-- The file browser stays mounted on its hidden tab so openFile anchors keep working. -->
        <z-tab-group>
          <z-tab label="Files">
            <app-workspace-file-browser [repoId]="repoId" [workspaceId]="workspaceId" />
          </z-tab>
          <z-tab label="Events">
            <app-workspace-daemon-events
              [repoId]="repoId"
              [workspaceId]="workspaceId"
              (openFile)="openFileFromEvent($event)"
            />
          </z-tab>
          <z-tab label="Telemetry">
            <app-workspace-telemetry [repoId]="repoId" [workspaceId]="workspaceId" />
          </z-tab>
          <z-tab label="Plugins">
            <app-workspace-plugins [repoId]="repoId" [workspaceId]="workspaceId" />
          </z-tab>
        </z-tab-group>
      </div>

      <!-- Floaty web-view button (bottom-right) — renders only while a live web-viewable daemon
           exists in this workspace. -->
      <app-daemon-webview [repoId]="repoId" [workspaceId]="workspaceId" />
    </app-page-layout>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkspaceDetailPage {
  private readonly route = inject(ActivatedRoute);
  private readonly workspaceService = inject(WorkspaceControllerService);
  private readonly live = inject(WorkspaceLiveService);

  readonly repoId = this.route.snapshot.paramMap.get('repoId')!;
  readonly workspaceId = this.route.snapshot.paramMap.get('workspaceId')!;

  constructor() {
    // Push freshness over one SSE channel; the child queries no longer poll (see WorkspaceLiveService).
    this.live.connect(this.repoId, this.workspaceId);
  }

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

  private readonly tabGroup = viewChild(ZardTabGroupComponent);
  private readonly fileBrowser = viewChild(WorkspaceFileBrowserComponent);

  /** An event's "open in source": make the jump visible by switching to Files, then anchor. */
  openFileFromEvent(anchor: DaemonEventFileAnchor): void {
    this.tabGroup()?.selectTabByIndex(0);
    this.fileBrowser()?.openAtLine(anchor.path, anchor.startLine, anchor.endLine);
  }
}
