import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { WorkspaceServiceControllerService } from '@/api/api/workspaceServiceController.service';
import { ServiceInstanceDto } from '@/api/model/serviceInstanceDto';
import { ServiceStatus } from '@/api/model/serviceStatus';
import { WorkspaceServicesComponent } from './workspace-services.component';

/** Mutation callbacks land on the next macrotask; flush before asserting. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function instance(overrides: Partial<ServiceInstanceDto>): ServiceInstanceDto {
  return {
    daemon: { id: 'daemon-1', name: 'dev server', restartPolicy: 'ON_FAILURE' },
    status: ServiceStatus.Stopped,
    restartCount: 0,
    ...overrides,
  } as ServiceInstanceDto;
}

describe('WorkspaceServicesComponent', () => {
  const serviceApi = {
    apiRepositoriesRepoIdWorkspacesWorkspaceIdServicesGet: vi
      .fn()
      .mockReturnValue(of({ entries: [] })),
    apiRepositoriesRepoIdWorkspacesWorkspaceIdServicesDaemonIdStartPost: vi
      .fn()
      .mockReturnValue(of({})),
    apiRepositoriesRepoIdWorkspacesWorkspaceIdServicesDaemonIdStopPost: vi
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
      imports: [WorkspaceServicesComponent],
      providers: [
        provideRouter([]),
        provideTanStackQuery(queryClient),
        { provide: WorkspaceServiceControllerService, useValue: serviceApi },
      ],
    }).compileComponents();
  });

  function createComponent() {
    const fixture = TestBed.createComponent(WorkspaceServicesComponent);
    fixture.componentRef.setInput('repoId', 'repo-1');
    fixture.componentRef.setInput('workspaceId', 'wt-1');
    fixture.detectChanges();
    return fixture;
  }

  it('shows every effective service with status chip and the right start/stop control', () => {
    queryClient.setQueryData(
      ['workspace-services', 'repo-1', 'wt-1'],
      [
        instance({}),
        instance({
          daemon: { id: 'daemon-2', name: 'watcher' },
          status: ServiceStatus.Ready,
          restartCount: 2,
          commandId: 'cmd-9',
        }),
      ],
    );
    const fixture = createComponent();
    const element = fixture.nativeElement as HTMLElement;

    // Everything-visible: the stopped service still shows, with a Start button.
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

  it('renders the health dots beside the status chip and omits them without checks', () => {
    queryClient.setQueryData(
      ['workspace-services', 'repo-1', 'wt-1'],
      [
        instance({
          status: ServiceStatus.Ready,
          health: [
            { name: 'Quarkus', kind: 'HTTP', state: 'HEALTHY' },
            { name: 'Angular', kind: 'HTTP', state: 'UNHEALTHY' },
          ],
        } as Partial<ServiceInstanceDto>),
        instance({ daemon: { id: 'daemon-2', name: 'checkless' } }),
      ],
    );
    const fixture = createComponent();
    const element = fixture.nativeElement as HTMLElement;

    // The crux of the feature: the chip says READY while a health dot shows Angular down.
    expect(element.textContent).toContain('READY');
    const healthRows = element.querySelectorAll('app-service-health-checks');
    expect(healthRows).toHaveLength(1);
    expect(healthRows[0].textContent).toContain('Quarkus');
    expect(healthRows[0].textContent).toContain('Angular');
    expect(healthRows[0].querySelector('.bg-red-500')).not.toBeNull();
  });

  it('starting a service posts with the generated (daemonId, repoId, workspaceId) arg order', async () => {
    queryClient.setQueryData(['workspace-services', 'repo-1', 'wt-1'], [instance({})]);
    const fixture = createComponent();

    const startButton = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ).find((b) => b.textContent?.trim() === 'Start');
    startButton!.click();
    await flush();

    // The generated client orders path params alphabetically (daemonId, repoId, workspaceId), not in
    // path order — asserting the exact order guards against the scrambled-URL 404 regression.
    expect(
      serviceApi.apiRepositoriesRepoIdWorkspacesWorkspaceIdServicesDaemonIdStartPost,
    ).toHaveBeenCalledWith('daemon-1', 'repo-1', 'wt-1');
  });

  it('stopping a service posts with the generated (daemonId, repoId, workspaceId) arg order', async () => {
    queryClient.setQueryData(
      ['workspace-services', 'repo-1', 'wt-1'],
      [instance({ status: ServiceStatus.Ready })],
    );
    const fixture = createComponent();

    const stopButton = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ).find((b) => b.textContent?.trim() === 'Stop');
    stopButton!.click();
    await flush();

    expect(
      serviceApi.apiRepositoriesRepoIdWorkspacesWorkspaceIdServicesDaemonIdStopPost,
    ).toHaveBeenCalledWith('daemon-1', 'repo-1', 'wt-1');
  });

});
