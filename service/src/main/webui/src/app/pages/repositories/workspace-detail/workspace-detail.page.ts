import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { CommandControllerService } from '@/api/api/commandController.service';
import { WorkspaceBootstrapControllerService } from '@/api/api/workspaceBootstrapController.service';
import { WorkspaceControllerService } from '@/api/api/workspaceController.service';
import { WorkspaceServiceControllerService } from '@/api/api/workspaceServiceController.service';
import { BootstrapOutcome } from '@/api/model/bootstrapOutcome';
import { CommandDto } from '@/api/model/commandDto';
import { CommandKind } from '@/api/model/commandKind';
import { CommandStatus } from '@/api/model/commandStatus';
import { ServiceInstanceDto } from '@/api/model/serviceInstanceDto';
import { ServiceStatus } from '@/api/model/serviceStatus';
import { WorkspaceDto } from '@/api/model/workspaceDto';
import { PageLayoutComponent } from '@/layout/page-layout/page-layout.component';
import {
  newestRunningChat,
  newestRunningInteractiveAgent,
} from '@/pattern/command/running-chat';
import { WorkspaceBootstrapComponent } from '@/pattern/bootstrap/workspace-bootstrap.component';
import { ServiceWebviewComponent } from '@/pattern/service/webview/service-webview.component';
import {
  ServiceEventFileAnchor,
  WorkspaceServiceEventsComponent,
} from '@/pattern/service/workspace-service-events.component';
import { WorkspaceServicesComponent } from '@/pattern/service/workspace-services.component';
import { WorkspaceTelemetryComponent } from '@/pattern/telemetry/workspace-telemetry.component';
import { WorkspaceActionsComponent } from '@/pattern/workspace/workspace-actions.component';
import { WorkspaceActivityBarComponent } from '@/pattern/workspace/workspace-activity-bar.component';
import { WorkspaceAgentActivityComponent } from '@/pattern/workspace/workspace-agent-activity.component';
import { WorkspaceAgentSessionComponent } from '@/pattern/workspace/workspace-agent-session.component';
import { WorkspaceChatComponent } from '@/pattern/workspace/workspace-chat.component';
import { WorkspaceFileBrowserComponent } from '@/pattern/workspace/workspace-file-browser.component';
import { WorkspaceLiveService } from '@/pattern/workspace/workspace-live.service';
import { PromptDraftSyncService } from '@/pattern/workspace/prompt-draft-sync.service';
import { WorkspacePluginsComponent } from '@/pattern/workspace/workspace-plugins.component';
import { TechnicalProcessViewComponent } from '@/pattern/workspace/technical-process-view.component';
import { WorkspaceSessionTreeComponent } from '@/pattern/workspace/workspace-session-tree.component';
import { WorkspaceSketchComponent } from '@/pattern/workspace/workspace-sketch.component';
import {
  ZardTabComponent,
  ZardTabGroupComponent,
  type ZardTabIndicator,
} from '@/shared/components/tabs';

/**
 * The active tab's URL slug per tab label. The slug is an optional trailing URL segment
 * (`…/workspaces/:workspaceId/web-view`) matched by `workspaceDetailMatcher`, which reserves
 * `wip` for the legacy page — never add a `wip` slug here. No segment = the tab group's own
 * default (the user-reordered first tab), deliberately unpinned.
 */
const TAB_SLUG_BY_LABEL = new Map([
  ['Chat', 'chat'],
  ['Files', 'files'],
  ['Sketch', 'sketch'],
  ['Services', 'services'],
  ['Bootstrap', 'bootstrap'],
  ['Actions', 'actions'],
  ['Web view', 'web-view'],
  ['Telemetry', 'telemetry'],
  ['Agents', 'agents'],
]);

const TAB_LABEL_BY_SLUG = new Map([...TAB_SLUG_BY_LABEL].map(([label, slug]) => [slug, label]));

/**
 * The transient process tab's label — deliberately NOT in {@link TAB_SLUG_BY_LABEL}: the tab is
 * URL-unpinned ("no slug = default tab" is already supported) and unmounts when the process ends.
 */
const PROCESS_TAB_LABEL = 'Starting';

/**
 * The workspace detail page: everything the workspace offers as one tab row — Chat, Files,
 * Services (controls + events feed), Actions (effective actions + run history), Web view,
 * Telemetry, Agents (the embedded agent session + session history + plugins). All panels
 * rely on the tab
 * group keeping hidden tabs mounted: the file browser's openFile anchors, the chat's WebSocket,
 * and the web view's
 * iframe survive tab switches. The tab row is drag-reorderable, persisted per browser under the
 * `qits.workspace-detail.tab-order` localStorage key. The older speak-to-prompt page stays
 * reachable at `…/wip` (unlinked, kept for prototyping).
 *
 * The active tab is mirrored into the URL as a trailing slug segment (see {@link TAB_SLUG_BY_LABEL})
 * so every tab is shareable, and a `?path=` query param deep-links into the Files tab's browser
 * (see the constructor effects).
 */
@Component({
  selector: 'app-workspace-detail-page',
  imports: [
    ServiceWebviewComponent,
    PageLayoutComponent,
    WorkspaceActionsComponent,
    WorkspaceActivityBarComponent,
    WorkspaceBootstrapComponent,
    WorkspaceAgentActivityComponent,
    WorkspaceAgentSessionComponent,
    WorkspaceChatComponent,
    WorkspaceServiceEventsComponent,
    WorkspaceServicesComponent,
    WorkspaceFileBrowserComponent,
    WorkspacePluginsComponent,
    WorkspaceSessionTreeComponent,
    WorkspaceSketchComponent,
    WorkspaceTelemetryComponent,
    TechnicalProcessViewComponent,
    ZardTabComponent,
    ZardTabGroupComponent,
  ],
  providers: [WorkspaceLiveService, PromptDraftSyncService],
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

      <!-- Sticky row of buttons for every workspace in this repo with a live agent session, newest
           activity first — jump to whichever one just stopped and needs your next prompt. Bleeds the
           ancestor page padding (-mx-6 px-6) so it spans the content width when pinned. -->
      <app-workspace-activity-bar
        class="sticky top-0 z-20 -mx-6 mb-2 block border-b border-border bg-background/95 px-6 py-1 backdrop-blur supports-[backdrop-filter]:bg-background/80"
        [repoId]="repoId"
        [currentWorkspaceId]="workspaceId"
      />

      <!-- Tabs are drag-reorderable; the chosen order persists per browser (localStorage). -->
      <z-tab-group zReorderKey="qits.workspace-detail.tab-order" (zTabChange)="onTabChange($event.label)">
        <!-- Transient: mounted (pinned first, auto-selected) only while a technical process runs
             against this workspace; unmounts when the PROCESS hint reports it gone. -->
        @if (activeProcessId(); as processId) {
          <z-tab [label]="processTabLabel" [zPinFirst]="true">
            <app-technical-process-view [processId]="processId" (finished)="onProcessFinished()" />
          </z-tab>
        }
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
        <z-tab label="Sketch">
          <app-workspace-sketch [repoId]="repoId" [workspaceId]="workspaceId" />
        </z-tab>
        <z-tab
          label="Services"
          [indicator]="serviceIndicator()"
          [indicatorLabel]="serviceIndicatorLabel()"
        >
          <div class="flex flex-col gap-6">
            <app-workspace-services [repoId]="repoId" [workspaceId]="workspaceId" />
            <section class="flex flex-col gap-3" aria-label="Service events">
              <h2 class="text-lg font-semibold">Events</h2>
              <app-workspace-service-events
                [repoId]="repoId"
                [workspaceId]="workspaceId"
                (openFile)="openFileFromEvent($event)"
              />
            </section>
          </div>
        </z-tab>
        <z-tab
          label="Bootstrap"
          [indicator]="bootstrapIndicator()"
          [indicatorLabel]="bootstrapIndicatorLabel()"
        >
          <app-workspace-bootstrap [repoId]="repoId" [workspaceId]="workspaceId" />
        </z-tab>
        <z-tab
          label="Actions"
          [indicator]="actionsIndicator()"
          indicatorLabel="A command is running"
        >
          <app-workspace-actions [repoId]="repoId" [workspaceId]="workspaceId" />
        </z-tab>
        <z-tab label="Web view">
          <app-service-webview
            [repoId]="repoId"
            [workspaceId]="workspaceId"
            [activated]="webviewActivated()"
          />
        </z-tab>
        <z-tab label="Telemetry">
          <app-workspace-telemetry [repoId]="repoId" [workspaceId]="workspaceId" />
        </z-tab>
        <z-tab
          label="Agents"
          [indicator]="agentsIndicator()"
          indicatorLabel="An agent session is running"
        >
          <div class="flex flex-col gap-6">
            <app-workspace-agent-session
              [repoId]="repoId"
              [workspaceId]="workspaceId"
              [activated]="agentsActivated()"
              (jumpToChat)="jumpToChat()"
            />
            <app-workspace-agent-activity [repoId]="repoId" [workspaceId]="workspaceId" />
            <app-workspace-session-tree
              [repoId]="repoId"
              [workspaceId]="workspaceId"
              [currentSessionId]="currentAgentSessionId()"
            />
            <app-workspace-plugins [repoId]="repoId" [workspaceId]="workspaceId" />
          </div>
        </z-tab>
      </z-tab-group>
    </app-page-layout>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkspaceDetailPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly workspaceService = inject(WorkspaceControllerService);
  private readonly commandService = inject(CommandControllerService);
  private readonly serviceApi = inject(WorkspaceServiceControllerService);
  private readonly bootstrapService = inject(WorkspaceBootstrapControllerService);
  private readonly queryClient = inject(QueryClient);
  private readonly live = inject(WorkspaceLiveService);
  private readonly promptDraftSync = inject(PromptDraftSyncService);

  protected readonly processTabLabel = PROCESS_TAB_LABEL;

  readonly repoId = this.route.snapshot.paramMap.get('repoId')!;
  readonly workspaceId = this.route.snapshot.paramMap.get('workspaceId')!;

  /** Reactive: tab switches navigate within this same route, only the `:tab` segment changes. */
  private readonly params = toSignal(this.route.paramMap, {
    initialValue: this.route.snapshot.paramMap,
  });

  /** Reactive: a picked-element file link re-targets `?path=` without leaving the route. */
  private readonly queryParams = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });

  /**
   * Mirror of the tab group's active label, written by {@link onTabChange} (the group's own
   * `activeTab` is protected, and it emits `zTabChange` for every selection). Null until the
   * group's `ngAfterViewInit` default-selects the first displayed tab — the URL→tab effect keys
   * on that: it must apply the URL's tab *after* the unconditional default selection, whatever
   * the effect/hook flush order of the pass that mounts the group.
   */
  private readonly activeLabel = signal<string | null>(null);

  /**
   * False until the URL→tab effect has applied (or skipped) the initial slug. Selections that
   * fire earlier are the group's own init default or URL-driven — neither may write the URL
   * (a bare URL deliberately stays bare).
   */
  private urlSyncReady = false;

  /** One-shot guard: each distinct `?path=`+`?lines=` target seeds the file browser exactly once. */
  private lastHandledFileTarget: string | null = null;

  constructor() {
    // Push freshness over one SSE channel; the child queries no longer poll (see WorkspaceLiveService).
    this.live.connect(this.repoId, this.workspaceId);

    // Hydrate + autosave this workspace's prompt draft (refresh- and device-resilient composition).
    this.promptDraftSync.connect(this.repoId, this.workspaceId);

    // Discovery → displayed process id, with the unmount linger described on activeProcessId.
    effect(() => {
      const id = this.activeProcessQuery.data() ?? null;
      if (id) {
        if (this.processLinger) {
          clearTimeout(this.processLinger);
          this.processLinger = null;
        }
        this.activeProcessId.set(id);
      } else if (this.activeProcessId() !== null && !this.processLinger) {
        this.processLinger = setTimeout(() => {
          this.processLinger = null;
          this.activeProcessId.set(null);
        }, 5000);
      }
    });

    // URL → tab: resolve the `:tab` slug against the group once it is mounted *and* has made its
    // own default selection (activeLabel non-null — see its doc). Unknown slugs normalize back to
    // the bare URL (keeping the default selection); a missing segment is deliberate ("no tab
    // pinned") and leaves the current selection alone.
    effect(() => {
      const group = this.tabGroup(); // re-runs when the success template mounts it
      const slug = this.params().get('tab');
      const active = this.activeLabel(); // re-runs after the group's init default selection
      if (!group || active === null) {
        return;
      }
      if (slug !== null) {
        const label = TAB_LABEL_BY_SLUG.get(slug);
        if (!label) {
          void this.router.navigate(
            ['/repositories', this.repoId, 'workspaces', this.workspaceId],
            { replaceUrl: true, queryParamsHandling: 'preserve' },
          );
        } else if (label !== active) {
          group.selectTabByLabel(label);
        }
      }
      this.urlSyncReady = true;
    });

    // ?path= → file browser: hand each distinct target to the browser once. The browser panel is
    // always mounted (hidden-tab mounting), so this works whatever tab is active. A valid
    // `?lines=start-end` (from a Chat-tab reference row, whose path is exact by construction)
    // anchors the exact file at those lines; without one, fuzzy-match the path (picked-element
    // attributions can be stale).
    effect(() => {
      const browser = this.fileBrowser(); // mounts with the success template
      const path = this.queryParams().get('path');
      const lines = this.queryParams().get('lines');
      if (!browser || path === null) {
        return;
      }
      const target = path + '\n' + (lines ?? '');
      if (target === this.lastHandledFileTarget) {
        return;
      }
      this.lastHandledFileTarget = target;
      const range = lines ? /^(\d+)-(\d+)$/.exec(lines) : null;
      if (range && +range[1] >= 1 && +range[2] >= +range[1]) {
        browser.openAtLine(path, +range[1], +range[2]);
      } else {
        browser.openClosestMatch(path);
      }
    });
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

  // Discovery for the transient process tab: the workspace's currently-running technical process.
  // Kept fresh by the PROCESS hint on the live channel (start → id appears, done → null again).
  readonly activeProcessQuery = injectQuery(() => ({
    queryKey: ['workspace-active-process', this.repoId, this.workspaceId],
    queryFn: () =>
      lastValueFrom(
        this.workspaceService.apiRepositoriesRepoIdWorkspacesWorkspaceIdActiveProcessGet(
          this.repoId,
          this.workspaceId,
        ),
      ).then((r) => r.technicalProcessId ?? null),
  }));

  /**
   * The process id the transient tab renders. Follows the discovery query, but lingers for a few
   * seconds after the query goes null so the user can read the frozen final state (the view itself
   * already stopped streaming on `done`) before the tab unmounts.
   */
  readonly activeProcessId = signal<string | null>(null);

  private processLinger: ReturnType<typeof setTimeout> | null = null;

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
   * — action-launched runs, not chats (the Chat dot), services (the Services dot), or agent runs
   * (the Agents dot; a session lineage marks a command as agent-driven). Each dot points at its
   * owner tab; the run-history list still shows everything.
   */
  readonly actionsIndicator = computed<ZardTabIndicator | null>(() =>
    (this.commandsQuery.data() ?? []).some(
      (c) =>
        c.kind === CommandKind.Terminal &&
        c.status === CommandStatus.Running &&
        c.workspaceId === this.workspaceId &&
        (c.agentSessions?.length ?? 0) === 0,
    )
      ? 'primary'
      : null,
  );

  /**
   * The Agents-tab dot: primary (attention) when a tracked agent is actively cooking, success when
   * an interactive agent is running but idle/waiting, else no dot. Upgrades the old binary
   * running/not-running dot into a real busy signal off {@code WorkspaceDto.agentActivity}.
   */
  readonly agentsIndicator = computed<ZardTabIndicator | null>(() => {
    if (this.workspace()?.agentActivity === 'BUSY') {
      return 'primary';
    }
    return newestRunningInteractiveAgent(this.commandsQuery.data(), this.workspaceId)
      ? 'success'
      : null;
  });

  /** The embedded run's current session (its list's last entry) — highlights its tree row. */
  readonly currentAgentSessionId = computed(() => {
    const running = newestRunningInteractiveAgent(this.commandsQuery.data(), this.workspaceId);
    const sessions = running?.agentSessions ?? [];
    return sessions[sessions.length - 1]?.sessionId ?? null;
  });

  // Same key AND shape as the Services/Web view tabs' queries, so all three share one cache entry.
  readonly servicesQuery = injectQuery(() => ({
    queryKey: ['workspace-services', this.repoId, this.workspaceId],
    queryFn: () =>
      lastValueFrom(
        this.serviceApi.apiRepositoriesRepoIdWorkspacesWorkspaceIdServicesGet(
          this.repoId,
          this.workspaceId,
        ),
      ).then(
        (r) => r.entries?.map((e) => e.instance).filter((i): i is ServiceInstanceDto => !!i) ?? [],
      ),
  }));

  /** Aggregate service status on the tab label — the glance the always-visible panel used to give. */
  readonly serviceIndicator = computed<ZardTabIndicator | null>(() => {
    const instances = this.servicesQuery.data() ?? [];
    if (
      instances.some((i) => i.status === ServiceStatus.Restarting)
    ) {
      return 'warning';
    }
    const live = instances.some(
      (i) => i.status === ServiceStatus.Ready || i.status === ServiceStatus.Starting,
    );
    return live ? 'success' : null;
  });

  readonly serviceIndicatorLabel = computed(() =>
    this.serviceIndicator() === 'warning'
      ? 'A service is restarting'
      : 'A service is running',
  );

  // Same key AND shape as the Bootstrap tab panel's query, so both share one cache entry.
  readonly workspaceBootstrapQuery = injectQuery(() => ({
    queryKey: ['workspace-bootstrap', this.repoId, this.workspaceId],
    queryFn: () =>
      lastValueFrom(
        this.bootstrapService.apiRepositoriesRepoIdWorkspacesWorkspaceIdBootstrapCommandsGet(
          this.repoId,
          this.workspaceId,
        ),
      ),
  }));

  /** Chain running (dot) or a failed last run (warning) on the Bootstrap tab label. */
  readonly bootstrapIndicator = computed<ZardTabIndicator | null>(() => {
    const data = this.workspaceBootstrapQuery.data();
    if (!data) {
      return null;
    }
    if (data.chainRunning) {
      return 'primary';
    }
    const failed = (data.entries ?? []).some(
      (e) => e.lastRun?.outcome === BootstrapOutcome.Failed,
    );
    return failed ? 'warning' : null;
  });

  readonly bootstrapIndicatorLabel = computed(() =>
    this.bootstrapIndicator() === 'warning'
      ? 'A bootstrap command failed'
      : 'The bootstrap chain is running',
  );

  /** Latched on the Web view tab's first selection; gates the iframe (see ServiceWebviewComponent). */
  readonly webviewActivated = signal(false);

  /**
   * Latched on the Agents tab's first selection; gates the embedded session's launch side effect
   * (see WorkspaceAgentSessionComponent) — the session is expensive to materialize, so nothing
   * launches on page load.
   */
  readonly agentsActivated = signal(false);

  onTabChange(label: string): void {
    if (label === 'Web view') {
      this.webviewActivated.set(true);
    }
    if (label === 'Agents') {
      this.agentsActivated.set(true);
    }
    this.activeLabel.set(label);
    // Mirror the selection into the URL (push — back walks through tabs). Guard 1 skips
    // everything before the URL→tab effect settled (the group's init default selection, and the
    // initial URL-driven selection); guard 2 skips the echo when the URL already says this.
    if (!this.urlSyncReady) {
      return;
    }
    const slug = TAB_SLUG_BY_LABEL.get(label);
    if (!slug || slug === this.params().get('tab')) {
      return;
    }
    void this.router.navigate(
      ['/repositories', this.repoId, 'workspaces', this.workspaceId, slug],
      { queryParamsHandling: 'preserve' },
    );
  }

  /**
   * The streamed process reached `done`: refresh the discovery query (the tab unmounts when it
   * answers null) plus the states the start just changed. The PROCESS hint usually triggers the
   * same refetch, but the local signal makes the handoff robust without a live SSE connection.
   */
  onProcessFinished(): void {
    void this.queryClient.invalidateQueries({
      queryKey: ['workspace-active-process', this.repoId, this.workspaceId],
    });
    void this.queryClient.invalidateQueries({ queryKey: ['workspaces', this.repoId] });
    void this.queryClient.invalidateQueries({
      queryKey: ['workspace-services', this.repoId, this.workspaceId],
    });
  }

  /** The embedded session's deferred state jumps to the live conversation. */
  jumpToChat(): void {
    this.tabGroup()?.selectTabByLabel('Chat');
  }

  /** An event's "open in source": make the jump visible by switching to Files, then anchor. */
  openFileFromEvent(anchor: ServiceEventFileAnchor): void {
    this.tabGroup()?.selectTabByLabel('Files');
    this.fileBrowser()?.openAtLine(anchor.path, anchor.startLine, anchor.endLine);
  }
}
