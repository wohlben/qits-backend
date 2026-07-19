import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { WorkspaceBootstrapControllerService } from '@/api/api/workspaceBootstrapController.service';
import { BootstrapOutcome } from '@/api/model/bootstrapOutcome';
import { WorkspaceBootstrapComponent } from './workspace-bootstrap.component';

/** Mutation callbacks land on the next macrotask; flush before asserting. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('WorkspaceBootstrapComponent', () => {
  const bootstrapService = {
    apiRepositoriesRepoIdWorkspacesWorkspaceIdBootstrapCommandsGet: vi
      .fn()
      .mockReturnValue(of({ chainRunning: false, entries: [] })),
    apiRepositoriesRepoIdWorkspacesWorkspaceIdBootstrapCommandsRunPost: vi
      .fn()
      .mockReturnValue(of({ started: true })),
    apiRepositoriesRepoIdWorkspacesWorkspaceIdBootstrapCommandsCommandIdRunPost: vi
      .fn()
      .mockReturnValue(of({ started: true })),
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
      imports: [WorkspaceBootstrapComponent],
      providers: [
        provideRouter([]),
        provideTanStackQuery(queryClient),
        { provide: WorkspaceBootstrapControllerService, useValue: bootstrapService },
      ],
    }).compileComponents();
  });

  function createComponent() {
    const fixture = TestBed.createComponent(WorkspaceBootstrapComponent);
    fixture.componentRef.setInput('repoId', 'repo-1');
    fixture.componentRef.setInput('workspaceId', 'wt-1');
    fixture.detectChanges();
    return fixture;
  }

  it('lists the chain in order with last-run outcome, timestamp and logs link', () => {
    queryClient.setQueryData(['workspace-bootstrap', 'repo-1', 'wt-1'], {
      chainRunning: false,
      entries: [
        {
          command: { id: 'cmd-1', name: 'install@qits-config', description: 'build it' },
          lastRun: {
            bootstrapCommandId: 'cmd-1',
            outcome: BootstrapOutcome.Succeeded,
            commandId: 'audit-1',
            exitCode: 0,
            ranAt: '2026-07-18T10:00:00Z',
          },
        },
        { command: { id: 'cmd-2', name: 'seed' }, lastRun: null },
      ],
    });
    const fixture = createComponent();
    const element = fixture.nativeElement as HTMLElement;

    // Config-suffixed names render as their base name; the never-ran entry says so.
    expect(element.textContent).toContain('install');
    expect(element.textContent).not.toContain('@qits-config');
    expect(element.textContent).toContain('SUCCEEDED');
    expect(element.textContent).toContain('never ran');
    expect(element.querySelector('a[href="/commands/audit-1"]')).not.toBeNull();
    const buttons = Array.from(element.querySelectorAll('button')).map((b) => b.textContent?.trim());
    expect(buttons).toContain('Run all');
    expect(buttons.filter((b) => b === 'Run')).toHaveLength(2);
  });

  it('a running chain disables the triggers and shows the transient indicator', () => {
    queryClient.setQueryData(['workspace-bootstrap', 'repo-1', 'wt-1'], {
      chainRunning: true,
      entries: [{ command: { id: 'cmd-1', name: 'install' }, lastRun: null }],
    });
    const fixture = createComponent();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.textContent).toContain('Chain running…');
    const buttons = Array.from(element.querySelectorAll('button'));
    expect(buttons.every((b) => b.disabled)).toBe(true);
  });

  it('a failed last run shows the outcome and its exit code', () => {
    queryClient.setQueryData(['workspace-bootstrap', 'repo-1', 'wt-1'], {
      chainRunning: false,
      entries: [
        {
          command: { id: 'cmd-1', name: 'install' },
          lastRun: {
            bootstrapCommandId: 'cmd-1',
            outcome: BootstrapOutcome.Failed,
            commandId: 'audit-2',
            exitCode: 7,
            ranAt: '2026-07-18T10:00:00Z',
          },
        },
      ],
    });
    const fixture = createComponent();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.textContent).toContain('FAILED');
    expect(element.textContent).toContain('exit 7');
  });

  it('Run all posts the chain trigger with the (repoId, workspaceId) arg order', async () => {
    queryClient.setQueryData(['workspace-bootstrap', 'repo-1', 'wt-1'], {
      chainRunning: false,
      entries: [{ command: { id: 'cmd-1', name: 'install' }, lastRun: null }],
    });
    const fixture = createComponent();

    const runAll = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ).find((b) => b.textContent?.trim() === 'Run all');
    runAll!.click();
    await flush();

    expect(
      bootstrapService.apiRepositoriesRepoIdWorkspacesWorkspaceIdBootstrapCommandsRunPost,
    ).toHaveBeenCalledWith('repo-1', 'wt-1');
  });

  it('a single Run posts with the generated (commandId, repoId, workspaceId) arg order', async () => {
    queryClient.setQueryData(['workspace-bootstrap', 'repo-1', 'wt-1'], {
      chainRunning: false,
      entries: [{ command: { id: 'cmd-1', name: 'install' }, lastRun: null }],
    });
    const fixture = createComponent();

    const run = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Run',
    );
    run!.click();
    await flush();

    // The generated client orders path params alphabetically — the arg order guards against the
    // scrambled-URL 404 regression.
    expect(
      bootstrapService.apiRepositoriesRepoIdWorkspacesWorkspaceIdBootstrapCommandsCommandIdRunPost,
    ).toHaveBeenCalledWith('cmd-1', 'repo-1', 'wt-1');
  });
});
