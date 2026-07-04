import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { WorktreeDaemonControllerService } from '@/api/api/worktreeDaemonController.service';
import { DaemonEventSeverity } from '@/api/model/daemonEventSeverity';
import { DaemonInstanceDto } from '@/api/model/daemonInstanceDto';
import { DaemonStatus } from '@/api/model/daemonStatus';
import { WorktreeDaemonsComponent } from './worktree-daemons.component';

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

describe('WorktreeDaemonsComponent', () => {
  const daemonService = {
    apiRepositoriesRepoIdWorktreesWorktreeIdDaemonsGet: vi
      .fn()
      .mockReturnValue(of({ entries: [] })),
    apiRepositoriesRepoIdWorktreesWorktreeIdDaemonsEventsGet: vi
      .fn()
      .mockReturnValue(of({ events: [] })),
    apiRepositoriesRepoIdWorktreesWorktreeIdDaemonsDaemonIdStartPost: vi
      .fn()
      .mockReturnValue(of({})),
    apiRepositoriesRepoIdWorktreesWorktreeIdDaemonsDaemonIdStopPost: vi
      .fn()
      .mockReturnValue(of({})),
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
      imports: [WorktreeDaemonsComponent],
      providers: [
        provideRouter([]),
        provideTanStackQuery(queryClient),
        { provide: WorktreeDaemonControllerService, useValue: daemonService },
      ],
    }).compileComponents();
  });

  function createComponent() {
    const fixture = TestBed.createComponent(WorktreeDaemonsComponent);
    fixture.componentRef.setInput('repoId', 'repo-1');
    fixture.componentRef.setInput('worktreeId', 'wt-1');
    fixture.detectChanges();
    return fixture;
  }

  it('shows every effective daemon with status chip and the right start/stop control', () => {
    queryClient.setQueryData(
      ['worktree-daemons', 'repo-1', 'wt-1'],
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

  it('starting a daemon posts to the start endpoint for its id', async () => {
    queryClient.setQueryData(['worktree-daemons', 'repo-1', 'wt-1'], [instance({})]);
    const fixture = createComponent();

    const startButton = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ).find((b) => b.textContent?.trim() === 'Start');
    startButton!.click();
    await flush();

    expect(
      daemonService.apiRepositoriesRepoIdWorktreesWorktreeIdDaemonsDaemonIdStartPost,
    ).toHaveBeenCalledWith('repo-1', 'wt-1', 'daemon-1');
  });

  it('renders the events feed severity-colored with expandable excerpts', () => {
    queryClient.setQueryData(['worktree-daemons', 'repo-1', 'wt-1'], []);
    queryClient.setQueryData(
      ['worktree-daemon-events', 'repo-1', 'wt-1'],
      [
        {
          daemonName: 'dev server',
          severity: DaemonEventSeverity.Error,
          summary: 'crashed (exit 1)',
          logExcerpt: 'stacktrace-here',
          timestamp: '2026-07-04T10:00:00Z',
        },
      ],
    );
    const fixture = createComponent();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.textContent).toContain('Recent events');
    expect(element.textContent).toContain('crashed (exit 1)');
    expect(element.querySelector('details pre')?.textContent).toContain('stacktrace-here');
    expect(element.querySelector('.bg-red-500')).not.toBeNull();
  });
});
