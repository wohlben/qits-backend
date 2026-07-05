import { TestBed } from '@angular/core/testing';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { WorkspaceDaemonControllerService } from '@/api/api/workspaceDaemonController.service';
import { DaemonInstanceDto } from '@/api/model/daemonInstanceDto';
import { DaemonStatus } from '@/api/model/daemonStatus';
import { DaemonWebviewComponent } from './daemon-webview.component';

function instance(overrides: Partial<DaemonInstanceDto> = {}): DaemonInstanceDto {
  return {
    daemon: { id: 'd-1', name: 'dev server' },
    status: DaemonStatus.Ready,
    restartCount: 0,
    commandId: 'cmd-1',
    proxyPath: '/daemon/wt-1/d-1/',
    ...overrides,
  } as DaemonInstanceDto;
}

describe('DaemonWebviewComponent', () => {
  const daemonService = {
    apiRepositoriesRepoIdWorkspacesWorkspaceIdDaemonsGet: vi
      .fn()
      .mockReturnValue(of({ entries: [] })),
  };
  let queryClient: QueryClient;

  beforeEach(async () => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          staleTime: Infinity,
          retry: false,
          refetchOnMount: false,
          refetchInterval: false,
        },
      },
    });
    await TestBed.configureTestingModule({
      imports: [DaemonWebviewComponent],
      providers: [
        provideTanStackQuery(queryClient),
        { provide: WorkspaceDaemonControllerService, useValue: daemonService },
      ],
    }).compileComponents();
  });

  function createComponent(instances: DaemonInstanceDto[]) {
    queryClient.setQueryData(['workspace-daemons', 'repo-1', 'wt-1'], instances);
    const fixture = TestBed.createComponent(DaemonWebviewComponent);
    fixture.componentRef.setInput('repoId', 'repo-1');
    fixture.componentRef.setInput('workspaceId', 'wt-1');
    fixture.detectChanges();
    return fixture;
  }

  it('shows the floaty button only for live web-viewable daemons', () => {
    const fixture = createComponent([instance()]);

    expect(fixture.componentInstance.webViewable().length).toBe(1);
    expect(fixture.nativeElement.querySelector('button')).not.toBeNull();
  });

  it('stays hidden without a proxyPath or without a live status', () => {
    const fixture = createComponent([
      instance({ proxyPath: undefined }),
      instance({ daemon: { id: 'd-2', name: 'stopped one' }, status: DaemonStatus.Stopped }),
      instance({ daemon: { id: 'd-3', name: 'crashed one' }, status: DaemonStatus.Crashed }),
    ]);

    expect(fixture.componentInstance.webViewable().length).toBe(0);
    expect(fixture.nativeElement.querySelector('button')).toBeNull();
  });

  it('selects the first web-viewable daemon and lets a picked id override it', () => {
    const fixture = createComponent([
      instance({ daemon: { id: 'd-0', name: 'not web' }, proxyPath: undefined }),
      instance(),
      instance({
        daemon: { id: 'd-2', name: 'second' },
        proxyPath: '/daemon/wt-1/d-2/',
        status: DaemonStatus.Starting,
      }),
    ]);

    expect(fixture.componentInstance.selected()?.daemon?.id).toBe('d-1');
    fixture.componentInstance.selectedDaemonId.set('d-2');
    expect(fixture.componentInstance.selected()?.daemon?.id).toBe('d-2');
  });
});
