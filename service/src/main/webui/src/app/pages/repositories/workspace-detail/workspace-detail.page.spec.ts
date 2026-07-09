import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { AgentPluginControllerService } from '@/api/api/agentPluginController.service';
import { CommandControllerService } from '@/api/api/commandController.service';
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
  const pluginService = {
    apiRepositoriesRepoIdWorkspacesWorkspaceIdAgentPluginsGet: vi
      .fn()
      .mockReturnValue(of({ installed: [] })),
  };
  const route = {
    snapshot: { paramMap: convertToParamMap({ repoId: 'repo-1', workspaceId: 'wt-1' }) },
  };
  let queryClient: QueryClient;

  beforeEach(async () => {
    vi.clearAllMocks();
    // A seeded running chat mounts app-command-chat inline; keep its socket out of jsdom.
    vi.stubGlobal(
      'WebSocket',
      class {
        send() {}
        close() {}
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

    await TestBed.configureTestingModule({
      imports: [WorkspaceDetailPage],
      providers: [
        provideTanStackQuery(queryClient),
        { provide: ActivatedRoute, useValue: route },
        { provide: WorkspaceControllerService, useValue: workspaceService },
        { provide: CommandControllerService, useValue: commandService },
        { provide: AgentPluginControllerService, useValue: pluginService },
        { provide: ZardDarkMode, useValue: { themeMode: () => EDarkModes.LIGHT } },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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
    const tabLabels = Array.from(el.querySelectorAll('nav[role="tablist"] [role="tab"]')).map((b) =>
      b.textContent?.trim(),
    );
    expect(tabLabels).toEqual([
      'Files',
      'Chat',
      'Daemons',
      'Web view',
      'Events',
      'Telemetry',
      'Plugins',
    ]);
    // Chat, daemons and web view live in tab panels — not in the header, not floating.
    expect(el.querySelector('[role="tabpanel"] app-workspace-chat')).not.toBeNull();
    expect(el.querySelector('[role="tabpanel"] app-workspace-daemons')).not.toBeNull();
    expect(el.querySelector('[role="tabpanel"] app-daemon-webview')).not.toBeNull();
    expect(el.querySelector('header app-workspace-chat')).toBeNull();
    expect(el.querySelector('[aria-label="Open the daemon web view"]')).toBeNull();
    // The events feed lives in its tab, not in the daemons panel.
    expect(el.querySelector('app-workspace-daemons app-workspace-daemon-events')).toBeNull();
  });

  it('an openFile from the Events tab selects the Files tab and anchors the file browser', () => {
    const fixture = TestBed.createComponent(WorkspaceDetailPage);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    const fileBrowser = fixture.debugElement.query(
      By.directive(WorkspaceFileBrowserComponent),
    ).componentInstance;
    const openAtLine = vi.spyOn(fileBrowser, 'openAtLine').mockImplementation(() => undefined);

    // Start on the Events tab so the jump back to Files is observable.
    const eventsTab = tabButton(el, 'Events');
    eventsTab.click();
    fixture.detectChanges();
    expect(eventsTab.getAttribute('aria-selected')).toBe('true');

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
});
