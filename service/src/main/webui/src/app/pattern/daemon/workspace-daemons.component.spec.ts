import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { WorkspaceControllerService } from '@/api/api/workspaceController.service';
import { WorkspaceDaemonControllerService } from '@/api/api/workspaceDaemonController.service';
import { DaemonInstanceDto } from '@/api/model/daemonInstanceDto';
import { DaemonStatus } from '@/api/model/daemonStatus';
import { WorkspaceDaemonsComponent } from './workspace-daemons.component';

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
  const workspaceService = {
    apiRepositoriesRepoIdWorkspacesWorkspaceIdStopContainerPost: vi
      .fn()
      .mockReturnValue(of({})),
    apiRepositoriesRepoIdWorkspacesWorkspaceIdEnsureContainerPost: vi
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
      imports: [WorkspaceDaemonsComponent],
      providers: [
        provideRouter([]),
        provideTanStackQuery(queryClient),
        { provide: WorkspaceDaemonControllerService, useValue: daemonService },
        { provide: WorkspaceControllerService, useValue: workspaceService },
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

  it('empty state names only the repository — no removed global daemon library', () => {
    queryClient.setQueryData(['workspace-daemons', 'repo-1', 'wt-1'], []);
    const fixture = createComponent();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('No daemons defined for this repository.');
    expect(text).not.toContain('global library');
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

  it('offers container recreation only when the instance flags an unpublished web-view port', async () => {
    queryClient.setQueryData(
      ['workspace-daemons', 'repo-1', 'wt-1'],
      [
        instance({
          daemon: { id: 'daemon-1', name: 'dev server', webView: { port: 4200 } },
          status: DaemonStatus.Ready,
          needsContainerRecreate: true,
        }),
        instance({ daemon: { id: 'daemon-2', name: 'fine one' }, status: DaemonStatus.Ready }),
      ],
    );
    const fixture = createComponent();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.textContent).toContain('does not publish port');
    const recreateButtons = Array.from(element.querySelectorAll('button')).filter((b) =>
      b.textContent?.includes('Recreate container'),
    );
    expect(recreateButtons.length).toBe(1);

    recreateButtons[0].click();
    await flush();
    // Recreate = stop (pushes the branch, removes the container) then ensure (reprovisions with
    // the current daemon ports published).
    expect(
      workspaceService.apiRepositoriesRepoIdWorkspacesWorkspaceIdStopContainerPost,
    ).toHaveBeenCalledWith('repo-1', 'wt-1');
    expect(
      workspaceService.apiRepositoriesRepoIdWorkspacesWorkspaceIdEnsureContainerPost,
    ).toHaveBeenCalledWith('repo-1', 'wt-1');
  });

});
