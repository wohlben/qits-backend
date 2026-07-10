import { TestBed } from '@angular/core/testing';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { WorkspaceDaemonControllerService } from '@/api/api/workspaceDaemonController.service';
import { DaemonInstanceDto } from '@/api/model/daemonInstanceDto';
import { DaemonStatus } from '@/api/model/daemonStatus';
import { NewSnippet, PromptContextStore } from '@/shared/state/prompt-context.store';
import { DaemonWebviewComponent } from './daemon-webview.component';

const snippet: NewSnippet = {
  html: '<button>Go</button>',
  selector: 'button:nth-of-type(1)',
  url: 'http://localhost/daemon/wt-1/d-1/',
  tag: 'button',
  textPreview: 'Go',
};

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

  function createComponent(instances: DaemonInstanceDto[], activated = true) {
    queryClient.setQueryData(['workspace-daemons', 'repo-1', 'wt-1'], instances);
    const fixture = TestBed.createComponent(DaemonWebviewComponent);
    fixture.componentRef.setInput('repoId', 'repo-1');
    fixture.componentRef.setInput('workspaceId', 'wt-1');
    fixture.componentRef.setInput('activated', activated);
    fixture.detectChanges();
    return fixture;
  }

  it('frames a live web-viewable daemon once the tab has been activated', () => {
    const fixture = createComponent([instance()]);

    expect(fixture.componentInstance.webViewable().length).toBe(1);
    expect(fixture.nativeElement.querySelector('iframe')).not.toBeNull();
  });

  it('mounts no iframe before the first tab activation — the framed app must not load eagerly', () => {
    const fixture = createComponent([instance()], false);

    expect(fixture.nativeElement.querySelector('iframe')).toBeNull();

    // First selection of the tab flips the gate; from then on the iframe stays.
    fixture.componentRef.setInput('activated', true);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('iframe')).not.toBeNull();
  });

  it('shows the empty state without a proxyPath or without a live status', () => {
    const fixture = createComponent([
      instance({ proxyPath: undefined }),
      instance({ daemon: { id: 'd-2', name: 'stopped one' }, status: DaemonStatus.Stopped }),
      instance({ daemon: { id: 'd-3', name: 'crashed one' }, status: DaemonStatus.Crashed }),
    ]);

    expect(fixture.componentInstance.webViewable().length).toBe(0);
    expect(fixture.nativeElement.querySelector('iframe')).toBeNull();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'No web-viewable daemon is running',
    );
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

  it('drops pick mode after a plain pick — the pick lands, the picking UX turns off', () => {
    const fixture = createComponent([instance()]);
    const component = fixture.componentInstance;
    component.togglePickMode();
    expect(component.pickMode()).toBe(true);

    component.onPicked(snippet, { keepPicking: false });

    expect(component.pickMode()).toBe(false);
    expect(TestBed.inject(PromptContextStore).count()).toBe(1);
  });

  it('keeps pick mode on for a keepPicking pick (shift-click / touch long press)', () => {
    const fixture = createComponent([instance()]);
    const component = fixture.componentInstance;
    component.togglePickMode();

    component.onPicked(snippet, { keepPicking: true });

    expect(component.pickMode()).toBe(true);
    expect(TestBed.inject(PromptContextStore).count()).toBe(1);
  });

  it('picking an already picked element unpicks it', () => {
    const fixture = createComponent([instance()]);
    const component = fixture.componentInstance;
    component.togglePickMode();

    component.onPicked(snippet, { keepPicking: true });
    expect(TestBed.inject(PromptContextStore).count()).toBe(1);

    component.onPicked(snippet, { keepPicking: true });
    expect(TestBed.inject(PromptContextStore).count()).toBe(0);
    expect(component.pickMode()).toBe(true);
  });

  it('opens the frame at proxyPath + entryPath, and at the bare proxyPath without one', () => {
    const fixture = createComponent([
      instance({
        daemon: { id: 'd-1', name: 'dev server', webView: { port: 4200, entryPath: 'greeting' } },
      }),
      instance({
        daemon: { id: 'd-2', name: 'no entry', webView: { port: 8080 } },
        proxyPath: '/daemon/wt-1/d-2/',
      }),
    ]);
    const frameUrl = () =>
      String(fixture.componentInstance.frameSrc()).replace(/^SafeValue.*?: (.*)\.?$/, '$1');

    expect(String(fixture.componentInstance.frameSrc())).toContain('/daemon/wt-1/d-1/greeting');

    fixture.componentInstance.selectedDaemonId.set('d-2');
    expect(frameUrl()).toContain('/daemon/wt-1/d-2/');
    expect(frameUrl()).not.toContain('greeting');
  });
});
