import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, convertToParamMap, Router, type ParamMap } from '@angular/router';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { BehaviorSubject, of } from 'rxjs';
import { vi } from 'vitest';

import { AgentControllerService } from '@/api/api/agentController.service';
import { AgentPluginControllerService } from '@/api/api/agentPluginController.service';
import { AgentSessionControllerService } from '@/api/api/agentSessionController.service';
import { CommandControllerService } from '@/api/api/commandController.service';
import { RepositoryActionsControllerService } from '@/api/api/repositoryActionsController.service';
import { WorkspaceControllerService } from '@/api/api/workspaceController.service';
import { CommandKind } from '@/api/model/commandKind';
import { CommandStatus } from '@/api/model/commandStatus';
import { DaemonStatus } from '@/api/model/daemonStatus';
import { WorkspaceFileBrowserComponent } from '@/pattern/workspace/workspace-file-browser.component';
import { EDarkModes, ZardDarkMode } from '@/shared/services/dark-mode';
import { WorkspaceDetailPage } from './workspace-detail.page';

/** Cache updates land on the next macrotask; flush before asserting. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('WorkspaceDetailPage', () => {
  const workspaceService = {
    apiRepositoriesRepoIdWorkspacesGet: vi.fn().mockReturnValue(of({ entries: [] })),
    apiRepositoriesRepoIdWorkspacesWorkspaceIdFilesGet: vi.fn().mockReturnValue(of({ paths: [] })),
  };
  const commandService = { apiCommandsGet: vi.fn().mockReturnValue(of({ entries: [] })) };
  const actionsService = {
    apiRepositoriesRepositoryIdActionsGet: vi.fn().mockReturnValue(of({ entries: [] })),
  };
  const pluginService = {
    apiRepositoriesRepoIdWorkspacesWorkspaceIdAgentPluginsGet: vi
      .fn()
      .mockReturnValue(of({ installed: [] })),
  };
  const agentService = {
    apiRepositoriesRepoIdWorkspacesWorkspaceIdAgentsPost: vi.fn().mockReturnValue(of({})),
  };
  const agentSessionService = {
    apiRepositoriesRepoIdWorkspacesWorkspaceIdAgentSessionsGet: vi
      .fn()
      .mockReturnValue(of({ sessions: [] })),
  };
  // Subject-backed so tests can deep-link (set before creating) or emit in-page URL changes.
  let paramMap$: BehaviorSubject<ParamMap>;
  let queryParamMap$: BehaviorSubject<ParamMap>;
  const route = {
    get paramMap() {
      return paramMap$.asObservable();
    },
    get queryParamMap() {
      return queryParamMap$.asObservable();
    },
    snapshot: {
      get paramMap() {
        return paramMap$.value;
      },
      get queryParamMap() {
        return queryParamMap$.value;
      },
    },
  };
  const router = { navigate: vi.fn().mockResolvedValue(true) };
  let queryClient: QueryClient;

  beforeEach(async () => {
    vi.clearAllMocks();
    paramMap$ = new BehaviorSubject(convertToParamMap({ repoId: 'repo-1', workspaceId: 'wt-1' }));
    queryParamMap$ = new BehaviorSubject(convertToParamMap({}));
    localStorage.clear(); // the page persists its tab order under qits.workspace-detail.tab-order
    // A seeded running chat mounts app-command-chat inline; keep its socket out of jsdom.
    vi.stubGlobal(
      'WebSocket',
      class {
        send() {}
        close() {}
      },
    );
    // A seeded running agent run mounts the embedded xterm terminal, which needs matchMedia +
    // ResizeObserver that jsdom doesn't provide.
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      media: '',
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
    }));
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    queryClient = new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity, retry: false, refetchOnMount: false } },
    });
    queryClient.setQueryData(
      ['workspaces', 'repo-1'],
      [{ workspaceId: 'wt-1', branch: 'feature/x', preamble: 'Do the thing' }],
    );
    queryClient.setQueryData(['workspace-files', 'repo-1', 'wt-1'], { paths: [], lazyDirs: [] });
    queryClient.setQueryData(['workspace-daemons', 'repo-1', 'wt-1'], []);
    queryClient.setQueryData(['workspace-agent-sessions', 'repo-1', 'wt-1'], []);

    await TestBed.configureTestingModule({
      imports: [WorkspaceDetailPage],
      providers: [
        provideTanStackQuery(queryClient),
        { provide: ActivatedRoute, useValue: route },
        { provide: Router, useValue: router },
        { provide: WorkspaceControllerService, useValue: workspaceService },
        { provide: CommandControllerService, useValue: commandService },
        { provide: RepositoryActionsControllerService, useValue: actionsService },
        { provide: AgentPluginControllerService, useValue: pluginService },
        { provide: AgentControllerService, useValue: agentService },
        { provide: AgentSessionControllerService, useValue: agentSessionService },
        { provide: ZardDarkMode, useValue: { themeMode: () => EDarkModes.LIGHT } },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  function tabButton(el: HTMLElement, label: string): HTMLButtonElement {
    const button = Array.from(el.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find((b) =>
      b.textContent?.trim().startsWith(label),
    );
    expect(button, `tab "${label}"`).toBeDefined();
    return button!;
  }

  it('hosts everything as sibling tabs — no header actions, no floaty web-view button', () => {
    const fixture = TestBed.createComponent(WorkspaceDetailPage);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    // role="tab" (not the z-button default role="button") — regression for the clobbered-role bug.
    // First tablist only: the Telemetry panel hosts its own nested sub-tab group.
    const tabLabels = Array.from(
      el.querySelector('nav[role="tablist"]')!.querySelectorAll('[role="tab"]'),
    ).map((b) => b.textContent?.trim());
    expect(tabLabels).toEqual([
      'Chat',
      'Files',
      'Daemons',
      'Actions',
      'Web view',
      'Telemetry',
      'Agents',
    ]);
    // Chat, daemons and web view live in tab panels — not in the header, not floating.
    expect(el.querySelector('[role="tabpanel"] app-workspace-chat')).not.toBeNull();
    expect(el.querySelector('[role="tabpanel"] app-workspace-daemons')).not.toBeNull();
    expect(el.querySelector('[role="tabpanel"] app-workspace-actions')).not.toBeNull();
    expect(el.querySelector('[role="tabpanel"] app-daemon-webview')).not.toBeNull();
    expect(el.querySelector('header app-workspace-chat')).toBeNull();
    expect(el.querySelector('[aria-label="Open the daemon web view"]')).toBeNull();
    // The events feed shares the Daemons tab panel, rendered beside (not inside) the panel.
    const daemonsPanel = el.querySelector('app-workspace-daemons')!.closest('[role="tabpanel"]')!;
    expect(daemonsPanel.querySelector('app-workspace-daemon-events')).not.toBeNull();
    expect(el.querySelector('app-workspace-daemons app-workspace-daemon-events')).toBeNull();
  });

  it('restores a drag-reordered tab row persisted in localStorage', () => {
    localStorage.setItem(
      'qits.workspace-detail.tab-order',
      JSON.stringify(['Chat', 'Web view', 'Files']),
    );
    const fixture = TestBed.createComponent(WorkspaceDetailPage);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    // First tablist only — the Telemetry panel's nested sub-tab group is not part of this row.
    const tabLabels = Array.from(
      el.querySelector('nav[role="tablist"]')!.querySelectorAll('[role="tab"]'),
    ).map((b) => b.textContent?.trim());
    // Persisted labels lead; tabs the saved order doesn't know keep their template order behind.
    expect(tabLabels).toEqual([
      'Chat',
      'Web view',
      'Files',
      'Daemons',
      'Actions',
      'Telemetry',
      'Agents',
    ]);
    // The first displayed tab is the selected one.
    expect(tabButton(el, 'Chat').getAttribute('aria-selected')).toBe('true');
  });

  it('an openFile from the events feed selects the Files tab and anchors the file browser', () => {
    const fixture = TestBed.createComponent(WorkspaceDetailPage);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    const fileBrowser = fixture.debugElement.query(
      By.directive(WorkspaceFileBrowserComponent),
    ).componentInstance;
    const openAtLine = vi.spyOn(fileBrowser, 'openAtLine').mockImplementation(() => undefined);

    // Start on the Daemons tab (where the events feed lives) so the jump to Files is observable.
    const daemonsTab = tabButton(el, 'Daemons');
    daemonsTab.click();
    fixture.detectChanges();
    expect(daemonsTab.getAttribute('aria-selected')).toBe('true');

    fixture.componentInstance.openFileFromEvent({ path: 'src/app.ts', startLine: 3, endLine: 5 });
    fixture.detectChanges();

    expect(openAtLine).toHaveBeenCalledWith('src/app.ts', 3, 5);
    expect(tabButton(el, 'Files').getAttribute('aria-selected')).toBe('true');
  });

  it('marks the Chat tab with the running-session dot the header button used to carry', async () => {
    const fixture = TestBed.createComponent(WorkspaceDetailPage);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    expect(tabButton(el, 'Chat').querySelector('[title="A chat session is running"]')).toBeNull();

    queryClient.setQueryData(
      ['commands'],
      [
        {
          id: 'cmd-1',
          workspaceId: 'wt-1',
          kind: CommandKind.Chat,
          status: CommandStatus.Running,
          launchedAt: '2026-07-04T10:00:00Z',
        },
      ],
    );
    await flush();
    fixture.detectChanges();

    expect(
      tabButton(el, 'Chat').querySelector('[title="A chat session is running"]'),
    ).not.toBeNull();
  });

  it('marks the Actions tab while a terminal command runs here — but not for a chat', async () => {
    const fixture = TestBed.createComponent(WorkspaceDetailPage);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    expect(tabButton(el, 'Actions').querySelector('[title="A command is running"]')).toBeNull();

    // A running chat lights the Chat dot, not the Actions one.
    queryClient.setQueryData(
      ['commands'],
      [
        {
          id: 'cmd-1',
          workspaceId: 'wt-1',
          kind: CommandKind.Chat,
          status: CommandStatus.Running,
          launchedAt: '2026-07-09T10:00:00Z',
        },
      ],
    );
    await flush();
    fixture.detectChanges();
    expect(tabButton(el, 'Actions').querySelector('[title="A command is running"]')).toBeNull();

    queryClient.setQueryData(
      ['commands'],
      [
        {
          id: 'cmd-2',
          workspaceId: 'wt-1',
          kind: CommandKind.Terminal,
          status: CommandStatus.Running,
          actionName: 'build-project',
          launchedAt: '2026-07-09T10:01:00Z',
        },
      ],
    );
    await flush();
    fixture.detectChanges();
    expect(
      tabButton(el, 'Actions').querySelector('[title="A command is running"]'),
    ).not.toBeNull();
  });

  it('marks the Agents tab for a running interactive agent run — and keeps the Actions dot off', async () => {
    const fixture = TestBed.createComponent(WorkspaceDetailPage);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    expect(
      tabButton(el, 'Agents').querySelector('[title="An agent session is running"]'),
    ).toBeNull();

    // A running TERMINAL command with a session lineage is an agent run: it lights the Agents
    // dot, and no longer the Actions one (each dot points at its owner tab).
    queryClient.setQueryData(
      ['commands'],
      [
        {
          id: 'cmd-3',
          workspaceId: 'wt-1',
          kind: CommandKind.Terminal,
          status: CommandStatus.Running,
          actionName: 'Claude Code (repository MCP)',
          launchedAt: '2026-07-10T10:00:00Z',
          agentSessions: [{ sessionId: 'sess-1', source: 'PINNED' }],
        },
      ],
    );
    await flush();
    fixture.detectChanges();

    expect(
      tabButton(el, 'Agents').querySelector('[title="An agent session is running"]'),
    ).not.toBeNull();
    expect(tabButton(el, 'Actions').querySelector('[title="A command is running"]')).toBeNull();
  });

  it('resolves the embedded session only on the Agents tab first selection', async () => {
    queryClient.setQueryData(['commands'], []);
    const fixture = TestBed.createComponent(WorkspaceDetailPage);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    // Mounted hidden with the other tabs, but nothing launches on page load.
    expect(el.querySelector('app-workspace-agent-session')).not.toBeNull();
    await flush();
    expect(agentService.apiRepositoriesRepoIdWorkspacesWorkspaceIdAgentsPost).not.toHaveBeenCalled();

    tabButton(el, 'Agents').click();
    fixture.detectChanges();
    await flush();
    expect(agentService.apiRepositoriesRepoIdWorkspacesWorkspaceIdAgentsPost).toHaveBeenCalledTimes(1);
  });

  it('marks the Daemons tab with an aggregate status dot', async () => {
    const fixture = TestBed.createComponent(WorkspaceDetailPage);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    // All stopped → no dot.
    expect(tabButton(el, 'Daemons').querySelector('span[title]')).toBeNull();

    queryClient.setQueryData(
      ['workspace-daemons', 'repo-1', 'wt-1'],
      [{ daemon: { id: 'd-1', name: 'dev server' }, status: DaemonStatus.Ready, restartCount: 0 }],
    );
    await flush();
    fixture.detectChanges();
    expect(
      tabButton(el, 'Daemons').querySelector('[title="A daemon is running"]'),
    ).not.toBeNull();

    queryClient.setQueryData(
      ['workspace-daemons', 'repo-1', 'wt-1'],
      [
        {
          daemon: { id: 'd-1', name: 'dev server' },
          status: DaemonStatus.Degraded,
          restartCount: 0,
        },
      ],
    );
    await flush();
    fixture.detectChanges();
    expect(
      tabButton(el, 'Daemons').querySelector('[title="A daemon is degraded or restarting"]'),
    ).not.toBeNull();
  });

  it('mounts the web view iframe on first tab activation, then keeps it across switches', () => {
    queryClient.setQueryData(
      ['workspace-daemons', 'repo-1', 'wt-1'],
      [
        {
          daemon: { id: 'd-1', name: 'dev server' },
          status: DaemonStatus.Ready,
          restartCount: 0,
          proxyPath: '/daemon/wt-1/d-1/',
        },
      ],
    );
    const fixture = TestBed.createComponent(WorkspaceDetailPage);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    // Hidden-but-mounted panels must not load the framed app before the tab is opened.
    expect(el.querySelector('app-daemon-webview iframe')).toBeNull();

    tabButton(el, 'Web view').click();
    fixture.detectChanges();
    expect(el.querySelector('app-daemon-webview iframe')).not.toBeNull();

    // Switching away keeps the iframe mounted (hidden), so the framed app doesn't reload.
    tabButton(el, 'Files').click();
    fixture.detectChanges();
    expect(el.querySelector('app-daemon-webview iframe')).not.toBeNull();
  });

  it('deep-links a tab: the :tab slug selects it and trips its activation latch', () => {
    queryClient.setQueryData(
      ['workspace-daemons', 'repo-1', 'wt-1'],
      [
        {
          daemon: { id: 'd-1', name: 'dev server' },
          status: DaemonStatus.Ready,
          restartCount: 0,
          proxyPath: '/daemon/wt-1/d-1/',
        },
      ],
    );
    paramMap$.next(
      convertToParamMap({ repoId: 'repo-1', workspaceId: 'wt-1', tab: 'web-view' }),
    );
    const fixture = TestBed.createComponent(WorkspaceDetailPage);
    fixture.detectChanges();
    fixture.detectChanges(); // effect selects the tab → second pass renders the selection
    const el = fixture.nativeElement as HTMLElement;

    expect(tabButton(el, 'Web view').getAttribute('aria-selected')).toBe('true');
    // The latch tripped: the deep link mounts the iframe just like a click would.
    expect(el.querySelector('app-daemon-webview iframe')).not.toBeNull();
    // The URL already says web-view — the echoed selection must not navigate again.
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('a user tab switch pushes the slug into the URL — the initial default selection does not', () => {
    const fixture = TestBed.createComponent(WorkspaceDetailPage);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    // Bare URL: the group's own default selection stays URL-less.
    expect(router.navigate).not.toHaveBeenCalled();

    tabButton(el, 'Telemetry').click();
    fixture.detectChanges();

    expect(router.navigate).toHaveBeenCalledWith(
      ['/repositories', 'repo-1', 'workspaces', 'wt-1', 'telemetry'],
      { queryParamsHandling: 'preserve' },
    );
  });

  it('normalizes an unknown tab slug back to the bare URL', () => {
    paramMap$.next(convertToParamMap({ repoId: 'repo-1', workspaceId: 'wt-1', tab: 'bogus' }));
    const fixture = TestBed.createComponent(WorkspaceDetailPage);
    fixture.detectChanges();

    expect(router.navigate).toHaveBeenCalledWith(
      ['/repositories', 'repo-1', 'workspaces', 'wt-1'],
      { replaceUrl: true, queryParamsHandling: 'preserve' },
    );
  });

  it('an in-page URL change switches the tab without navigating again (loop guard)', () => {
    const fixture = TestBed.createComponent(WorkspaceDetailPage);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    paramMap$.next(convertToParamMap({ repoId: 'repo-1', workspaceId: 'wt-1', tab: 'daemons' }));
    fixture.detectChanges();
    fixture.detectChanges();

    expect(tabButton(el, 'Daemons').getAttribute('aria-selected')).toBe('true');
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('seeds the file browser from a ?path= present at load', () => {
    queryParamMap$.next(convertToParamMap({ path: 'src/app/greeting.ts' }));
    const fixture = TestBed.createComponent(WorkspaceDetailPage);
    fixture.detectChanges();

    const fileBrowser = fixture.debugElement.query(
      By.directive(WorkspaceFileBrowserComponent),
    ).componentInstance;
    expect(fileBrowser.nameQuery()).toBe('src/app/greeting.ts');
  });

  it('hands each distinct ?path= value to the file browser exactly once', () => {
    const fixture = TestBed.createComponent(WorkspaceDetailPage);
    fixture.detectChanges();
    const fileBrowser = fixture.debugElement.query(
      By.directive(WorkspaceFileBrowserComponent),
    ).componentInstance;
    const openClosestMatch = vi
      .spyOn(fileBrowser, 'openClosestMatch')
      .mockImplementation(() => undefined);

    queryParamMap$.next(convertToParamMap({ path: 'src/a.ts' }));
    fixture.detectChanges();
    queryParamMap$.next(convertToParamMap({ path: 'src/a.ts' })); // re-emit, same value
    fixture.detectChanges();
    expect(openClosestMatch).toHaveBeenCalledTimes(1);
    expect(openClosestMatch).toHaveBeenCalledWith('src/a.ts');

    queryParamMap$.next(convertToParamMap({ path: 'src/b.ts' }));
    fixture.detectChanges();
    expect(openClosestMatch).toHaveBeenCalledTimes(2);
    expect(openClosestMatch).toHaveBeenLastCalledWith('src/b.ts');
  });
});
