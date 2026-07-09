import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { CommandControllerService } from '@/api/api/commandController.service';
import { WorkspaceControllerService } from '@/api/api/workspaceController.service';
import { WorkspaceDaemonControllerService } from '@/api/api/workspaceDaemonController.service';
import { CommandDto } from '@/api/model/commandDto';
import { CommandKind } from '@/api/model/commandKind';
import { CommandStatus } from '@/api/model/commandStatus';
import { DaemonInstanceDto } from '@/api/model/daemonInstanceDto';
import { DaemonStatus } from '@/api/model/daemonStatus';
import { WorkspaceDto } from '@/api/model/workspaceDto';
import { PageLayoutComponent } from '@/layout/page-layout/page-layout.component';
import { newestRunningChat } from '@/pattern/command/running-chat';
import { DaemonWebviewComponent } from '@/pattern/daemon/webview/daemon-webview.component';
import {
  DaemonEventFileAnchor,
  WorkspaceDaemonEventsComponent,
} from '@/pattern/daemon/workspace-daemon-events.component';
import { WorkspaceDaemonsComponent } from '@/pattern/daemon/workspace-daemons.component';
import { WorkspaceTelemetryComponent } from '@/pattern/telemetry/workspace-telemetry.component';
import { WorkspaceActionsComponent } from '@/pattern/workspace/workspace-actions.component';
import { WorkspaceChatComponent } from '@/pattern/workspace/workspace-chat.component';
import { WorkspaceFileBrowserComponent } from '@/pattern/workspace/workspace-file-browser.component';
import { WorkspaceLiveService } from '@/pattern/workspace/workspace-live.service';
import { WorkspacePluginsComponent } from '@/pattern/workspace/workspace-plugins.component';
import {
  ZardTabComponent,
  ZardTabGroupComponent,
  type ZardTabIndicator,
} from '@/shared/components/tabs';

/**
 * The workspace detail page: everything the workspace offers as one tab row — Chat, Files,
 * Daemons (controls + events feed), Actions (effective actions + run history), Web view,
 * Telemetry, Agents (the plugins list). All panels
 * rely on the tab
 * group keeping hidden tabs mounted: the file browser's openFile anchors, the chat's WebSocket,
 * and the web view's
 * iframe survive tab switches. The tab row is drag-reorderable, persisted per browser under the
 * `qits.workspace-detail.tab-order` localStorage key. The older speak-to-prompt page stays
 * reachable at `…/wip` (unlinked, kept for prototyping).
 */
@Component({
  selector: 'app-workspace-detail-page',
  imports: [
    DaemonWebviewComponent,
    PageLayoutComponent,
    WorkspaceActionsComponent,
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
      [hasActions]="false"
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

      <!-- Tabs are drag-reorderable; the chosen order persists per browser (localStorage). -->
      <z-tab-group zReorderKey="qits.workspace-detail.tab-order" (zTabChange)="onTabChange($event.label)">
        <z-tab
          label="Chat"
          [indicator]="chatIndicator()"
          indicatorLabel="A chat session is running"
        >
          <app-workspace-chat
            [repoId]="repoId"
            [workspaceId]="workspaceId"
            [preamble]="workspace()?.preamble ?? null"
          />
        </z-tab>
        <z-tab label="Files">
          <app-workspace-file-browser [repoId]="repoId" [workspaceId]="workspaceId" />
        </z-tab>
        <z-tab
          label="Daemons"
          [indicator]="daemonIndicator()"
          [indicatorLabel]="daemonIndicatorLabel()"
        >
          <div class="flex flex-col gap-6">
            <app-workspace-daemons [repoId]="repoId" [workspaceId]="workspaceId" />
            <section class="flex flex-col gap-3" aria-label="Daemon events">
              <h2 class="text-lg font-semibold">Events</h2>
              <app-workspace-daemon-events
                [repoId]="repoId"
                [workspaceId]="workspaceId"
                (openFile)="openFileFromEvent($event)"
              />
            </section>
          </div>
        </z-tab>
        <z-tab
          label="Actions"
          [indicator]="actionsIndicator()"
          indicatorLabel="A command is running"
        >
          <app-workspace-actions [repoId]="repoId" [workspaceId]="workspaceId" />
        </z-tab>
        <z-tab label="Web view">
          <app-daemon-webview
            [repoId]="repoId"
            [workspaceId]="workspaceId"
            [activated]="webviewActivated()"
          />
        </z-tab>
        <z-tab label="Telemetry">
          <app-workspace-telemetry [repoId]="repoId" [workspaceId]="workspaceId" />
        </z-tab>
        <z-tab label="Agents">
          <app-workspace-plugins [repoId]="repoId" [workspaceId]="workspaceId" />
        </z-tab>
      </z-tab-group>
    </app-page-layout>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkspaceDetailPage {
  private readonly route = inject(ActivatedRoute);
  private readonly workspaceService = inject(WorkspaceControllerService);
  private readonly commandService = inject(CommandControllerService);
  private readonly daemonService = inject(WorkspaceDaemonControllerService);
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

  // Same key AND shape as the Chat tab's commands query, so both share one cache entry.
  readonly commandsQuery = injectQuery(() => ({
    queryKey: ['commands'],
    queryFn: () =>
      lastValueFrom(this.commandService.apiCommandsGet()).then(
        (r) => r.entries?.map((e) => e.command!).filter((c): c is CommandDto => !!c) ?? [],
      ),
  }));

  /** The running-session dot, moved from the old header chat button onto the tab label. */
  readonly chatIndicator = computed<ZardTabIndicator | null>(() =>
    newestRunningChat(this.commandsQuery.data(), this.workspaceId) ? 'primary' : null,
  );

  /**
   * "Something is running here" for the Actions tab: a RUNNING TERMINAL command in this workspace
   * — action-launched runs, not chats (the Chat dot) or daemons (the Daemons dot).
   */
  readonly actionsIndicator = computed<ZardTabIndicator | null>(() =>
    (this.commandsQuery.data() ?? []).some(
      (c) =>
        c.kind === CommandKind.Terminal &&
        c.status === CommandStatus.Running &&
        c.workspaceId === this.workspaceId,
    )
      ? 'primary'
      : null,
  );

  // Same key AND shape as the Daemons/Web view tabs' queries, so all three share one cache entry.
  readonly daemonsQuery = injectQuery(() => ({
    queryKey: ['workspace-daemons', this.repoId, this.workspaceId],
    queryFn: () =>
      lastValueFrom(
        this.daemonService.apiRepositoriesRepoIdWorkspacesWorkspaceIdDaemonsGet(
          this.repoId,
          this.workspaceId,
        ),
      ).then(
        (r) => r.entries?.map((e) => e.instance).filter((i): i is DaemonInstanceDto => !!i) ?? [],
      ),
  }));

  /** Aggregate daemon status on the tab label — the glance the always-visible panel used to give. */
  readonly daemonIndicator = computed<ZardTabIndicator | null>(() => {
    const instances = this.daemonsQuery.data() ?? [];
    if (
      instances.some(
        (i) => i.status === DaemonStatus.Degraded || i.status === DaemonStatus.Restarting,
      )
    ) {
      return 'warning';
    }
    const live = instances.some(
      (i) => i.status === DaemonStatus.Ready || i.status === DaemonStatus.Starting,
    );
    return live ? 'success' : null;
  });

  readonly daemonIndicatorLabel = computed(() =>
    this.daemonIndicator() === 'warning'
      ? 'A daemon is degraded or restarting'
      : 'A daemon is running',
  );

  /** Latched on the Web view tab's first selection; gates the iframe (see DaemonWebviewComponent). */
  readonly webviewActivated = signal(false);

  onTabChange(label: string): void {
    if (label === 'Web view') {
      this.webviewActivated.set(true);
    }
  }

  /** An event's "open in source": make the jump visible by switching to Files, then anchor. */
  openFileFromEvent(anchor: DaemonEventFileAnchor): void {
    this.tabGroup()?.selectTabByLabel('Files');
    this.fileBrowser()?.openAtLine(anchor.path, anchor.startLine, anchor.endLine);
  }
}
