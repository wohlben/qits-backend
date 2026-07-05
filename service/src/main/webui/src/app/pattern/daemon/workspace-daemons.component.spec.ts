import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { DaemonEventControllerService } from '@/api/api/daemonEventController.service';
import { WorkspaceDaemonControllerService } from '@/api/api/workspaceDaemonController.service';
import { DaemonEventSeverity } from '@/api/model/daemonEventSeverity';
import { DaemonInstanceDto } from '@/api/model/daemonInstanceDto';
import { DaemonStatus } from '@/api/model/daemonStatus';
import { DaemonEventFileAnchor, WorkspaceDaemonsComponent } from './workspace-daemons.component';

/** Mutation callbacks land on the next macrotask; flush before asserting. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function instance(overrides: Partial<DaemonInstanceDto>): DaemonInstanceDto {
  return {
    daemon: { id: 'daemon-1', name: 'dev server', restartPolicy: 'ON_FAILURE' },
    status: DaemonStatus.Stopped,
    restartCount: 0,
    ...overrides,
  } as DaemonInstanceDto;
}

describe('WorkspaceDaemonsComponent', () => {
  const daemonService = {
    apiRepositoriesRepoIdWorkspacesWorkspaceIdDaemonsGet: vi
      .fn()
      .mockReturnValue(of({ entries: [] })),
    apiRepositoriesRepoIdWorkspacesWorkspaceIdDaemonsDaemonIdStartPost: vi
      .fn()
      .mockReturnValue(of({})),
    apiRepositoriesRepoIdWorkspacesWorkspaceIdDaemonsDaemonIdStopPost: vi
      .fn()
      .mockReturnValue(of({})),
  };
  const eventService = {
    apiDaemonEventsGet: vi.fn().mockReturnValue(of({ events: [] })),
  };
  let queryClient: QueryClient;

  beforeEach(async () => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { staleTime: Infinity, retry: false, refetchOnMount: false, refetchInterval: false },
      },
    });

    await TestBed.configureTestingModule({
      imports: [WorkspaceDaemonsComponent],
      providers: [
        provideRouter([]),
        provideTanStackQuery(queryClient),
        { provide: WorkspaceDaemonControllerService, useValue: daemonService },
        { provide: DaemonEventControllerService, useValue: eventService },
      ],
    }).compileComponents();
  });

  function createComponent() {
    const fixture = TestBed.createComponent(WorkspaceDaemonsComponent);
    fixture.componentRef.setInput('repoId', 'repo-1');
    fixture.componentRef.setInput('workspaceId', 'wt-1');
    fixture.detectChanges();
    return fixture;
  }

  it('shows every effective daemon with status chip and the right start/stop control', () => {
    queryClient.setQueryData(
      ['workspace-daemons', 'repo-1', 'wt-1'],
      [
        instance({}),
        instance({
          daemon: { id: 'daemon-2', name: 'watcher' },
          status: DaemonStatus.Ready,
          restartCount: 2,
          commandId: 'cmd-9',
        }),
      ],
    );
    const fixture = createComponent();
    const element = fixture.nativeElement as HTMLElement;

    // Everything-visible: the stopped daemon still shows, with a Start button.
    expect(element.textContent).toContain('dev server');
    expect(element.textContent).toContain('STOPPED');
    // The running one shows READY with its restart count, a Stop button and a logs link.
    expect(element.textContent).toContain('READY');
    expect(element.textContent).toContain('(2 restarts)');
    const buttons = Array.from(element.querySelectorAll('button')).map((b) => b.textContent?.trim());
    expect(buttons).toContain('Start');
    expect(buttons).toContain('Stop');
    expect(element.querySelector('a[href="/commands/cmd-9"]')).not.toBeNull();
  });

  it('starting a daemon posts with the generated (daemonId, repoId, workspaceId) arg order', async () => {
    queryClient.setQueryData(['workspace-daemons', 'repo-1', 'wt-1'], [instance({})]);
    const fixture = createComponent();

    const startButton = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ).find((b) => b.textContent?.trim() === 'Start');
    startButton!.click();
    await flush();

    // The generated client orders path params alphabetically (daemonId, repoId, workspaceId), not in
    // path order — asserting the exact order guards against the scrambled-URL 404 regression.
    expect(
      daemonService.apiRepositoriesRepoIdWorkspacesWorkspaceIdDaemonsDaemonIdStartPost,
    ).toHaveBeenCalledWith('daemon-1', 'repo-1', 'wt-1');
  });

  it('stopping a daemon posts with the generated (daemonId, repoId, workspaceId) arg order', async () => {
    queryClient.setQueryData(
      ['workspace-daemons', 'repo-1', 'wt-1'],
      [instance({ status: DaemonStatus.Ready })],
    );
    const fixture = createComponent();

    const stopButton = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ).find((b) => b.textContent?.trim() === 'Stop');
    stopButton!.click();
    await flush();

    expect(
      daemonService.apiRepositoriesRepoIdWorkspacesWorkspaceIdDaemonsDaemonIdStopPost,
    ).toHaveBeenCalledWith('daemon-1', 'repo-1', 'wt-1');
  });

  it('renders the events feed severity-colored with expandable excerpts and source badges', () => {
    queryClient.setQueryData(['workspace-daemons', 'repo-1', 'wt-1'], []);
    queryClient.setQueryData(
      ['workspace-daemon-events', 'repo-1', 'wt-1'],
      [
        {
          daemonName: 'dev server',
          severity: DaemonEventSeverity.Error,
          summary: 'crashed (exit 1)',
          logExcerpt: 'stacktrace-here',
          timestamp: '2026-07-04T10:00:00Z',
        },
        {
          daemonName: 'dev server',
          severity: DaemonEventSeverity.Error,
          summary: 'NPE in handler',
          logExcerpt: 'boom',
          source: 'output',
          commandId: 'cmd-9',
          anchorFrom: 12,
          anchorTo: 14,
          timestamp: '2026-07-04T10:01:00Z',
        },
      ],
    );
    const fixture = createComponent();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.textContent).toContain('Recent events');
    expect(element.textContent).toContain('crashed (exit 1)');
    expect(element.querySelector('details pre')?.textContent).toContain('stacktrace-here');
    expect(element.querySelector('.bg-red-500')).not.toBeNull();
    // The anchored output event carries a source badge and an "open in command log" link with
    // the anchored sequence range as query params.
    expect(element.textContent).toContain('output');
    // The "open in command log" link carries the anchored sequence range as query params.
    const hrefs = Array.from(element.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/commands/cmd-9?seq=12&seqTo=14');
  });

  it('file events emit an openFile anchor instead of routing', () => {
    queryClient.setQueryData(['workspace-daemons', 'repo-1', 'wt-1'], []);
    queryClient.setQueryData(
      ['workspace-daemon-events', 'repo-1', 'wt-1'],
      [
        {
          daemonName: 'dev server',
          severity: DaemonEventSeverity.Error,
          summary: 'kaboom',
          logExcerpt: 'ERROR: kaboom',
          source: 'logs/app.log',
          anchorFrom: 7,
          anchorTo: 9,
          timestamp: '2026-07-04T10:02:00Z',
        },
      ],
    );
    const fixture = createComponent();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.textContent).toContain('logs/app.log:7');
    const anchors: DaemonEventFileAnchor[] = [];
    fixture.componentInstance.openFile.subscribe((a) => anchors.push(a));
    const openButton = Array.from(element.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Open logs/app.log:7'),
    );
    expect(openButton).toBeDefined();
    openButton!.click();
    expect(anchors).toEqual([{ path: 'logs/app.log', startLine: 7, endLine: 9 }]);
  });
});
