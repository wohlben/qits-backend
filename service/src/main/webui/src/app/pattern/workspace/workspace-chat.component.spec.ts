import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { CommandControllerService } from '@/api/api/commandController.service';
import { CommandDto } from '@/api/model/commandDto';
import { CommandKind } from '@/api/model/commandKind';
import { CommandStatus } from '@/api/model/commandStatus';
import { PromptDraftSyncService } from '@/pattern/workspace/prompt-draft-sync.service';
import { WorkspaceChatComponent } from './workspace-chat.component';

/** Cache updates and mutation callbacks land on the next macrotask; flush before asserting. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function chat(overrides: Partial<CommandDto>): CommandDto {
  return {
    id: 'cmd-1',
    workspaceId: 'wt-1',
    kind: CommandKind.Chat,
    status: CommandStatus.Running,
    launchedAt: '2026-07-04T10:00:00Z',
    ...overrides,
  } as CommandDto;
}

describe('WorkspaceChatComponent', () => {
  const commandService = {
    apiCommandsGet: vi.fn().mockReturnValue(of({ entries: [] })),
    apiCommandsCommandIdTerminatePost: vi.fn().mockReturnValue(of({})),
    // Default: a launched command resolves as a chat (echoing the requested id).
    apiCommandsCommandIdGet: vi
      .fn()
      .mockImplementation((id: string) => of({ command: chat({ id }) })),
  };
  // The prompt panel's speak-to-prompt renders RouterLinks, which need a real router; the
  // navigation assertion spies on the real instance instead.
  let router: Router;
  let queryClient: QueryClient;

  beforeEach(async () => {
    vi.clearAllMocks();
    // The tab renders app-command-chat inline for a running session; keep its socket out of jsdom.
    vi.stubGlobal(
      'WebSocket',
      class {
        send() {}
        close() {}
      },
    );
    // Seeded data is the source of truth — never let it go stale and refetch from the mock.
    queryClient = new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity, retry: false, refetchOnMount: false } },
    });

    await TestBed.configureTestingModule({
      imports: [WorkspaceChatComponent],
      providers: [
        provideRouter([]),
        provideTanStackQuery(queryClient),
        { provide: CommandControllerService, useValue: commandService },
        // The nested speak-to-prompt flushes the draft before a launch; the page provides this
        // route-scoped service in production, so mock it here.
        { provide: PromptDraftSyncService, useValue: { flushNow: () => Promise.resolve() } },
      ],
    }).compileComponents();
    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function createComponent() {
    const fixture = TestBed.createComponent(WorkspaceChatComponent);
    fixture.componentRef.setInput('repoId', 'repo-1');
    fixture.componentRef.setInput('workspaceId', 'wt-1');
    fixture.detectChanges();
    return fixture;
  }

  it('reports a running session only when a chat runs in this workspace', async () => {
    queryClient.setQueryData(['commands'], [chat({})]);
    const fixture = createComponent();

    expect(fixture.componentInstance.hasRunningSession()).toBe(true);

    // A running chat elsewhere, or a finished one here, does not count.
    queryClient.setQueryData(
      ['commands'],
      [chat({ workspaceId: 'wt-2' }), chat({ id: 'cmd-2', status: CommandStatus.Exited })],
    );
    await flush();
    fixture.detectChanges();
    expect(fixture.componentInstance.hasRunningSession()).toBe(false);
  });

  it('renders the prompt panel without a session, the re-attached chat with one', async () => {
    const fixture = createComponent();
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelector('app-workspace-prompt-panel')).not.toBeNull();
    expect(el.querySelector('app-command-chat')).toBeNull();

    // A session appears (started from anywhere) → the chat attaches in place of the panel.
    queryClient.setQueryData(['commands'], [chat({})]);
    await flush();
    fixture.detectChanges();
    expect(el.querySelector('app-command-chat')).not.toBeNull();
    expect(el.querySelector('app-workspace-prompt-panel')).toBeNull();
  });

  it('resolves the newest running chat for this workspace as the active session', () => {
    queryClient.setQueryData(
      ['commands'],
      [
        chat({ id: 'cmd-old', launchedAt: '2026-07-04T09:00:00Z' }),
        chat({ id: 'cmd-new', launchedAt: '2026-07-04T11:00:00Z' }),
      ],
    );
    const fixture = createComponent();
    expect(fixture.componentInstance.activeChatId()).toBe('cmd-new');
  });

  it('has no active session without a running chat', () => {
    const fixture = createComponent();
    expect(fixture.componentInstance.activeChatId()).toBeNull();
  });

  it('bridges a just-launched chat until the registry reports it', async () => {
    const fixture = createComponent();
    const cmp = fixture.componentInstance;

    cmp.onLaunched('cmd-9');
    await flush(); // onLaunched resolves the command's kind before bridging
    expect(cmp.activeChatId()).toBe('cmd-9');

    // The registry catches up and reports it as already finished → the bridge drops.
    queryClient.setQueryData(['commands'], [chat({ id: 'cmd-9', status: CommandStatus.Exited })]);
    await flush();
    expect(cmp.activeChatId()).toBeNull();
  });

  it('redirects to the command page when the launch is a login terminal, not a chat', async () => {
    const fixture = createComponent();
    const cmp = fixture.componentInstance;

    // Not signed in → the backend returns an interactive `claude` REPL login terminal.
    commandService.apiCommandsCommandIdGet.mockReturnValueOnce(
      of({
        command: {
          id: 'login-1',
          kind: CommandKind.Terminal,
          status: CommandStatus.Running,
        } as CommandDto,
      }),
    );

    cmp.onLaunched('login-1');
    await flush();

    expect(router.navigate).toHaveBeenCalledWith(['/commands', 'login-1']);
    // A terminal is never bridged as a chat.
    expect(cmp.activeChatId()).toBeNull();
  });

  it('terminates the session and falls back to the prompt panel', async () => {
    queryClient.setQueryData(['commands'], [chat({})]);
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const fixture = createComponent();
    const cmp = fixture.componentInstance;
    cmp.launchedCommandId.set('cmd-1');

    cmp.terminateMutation.mutate('cmd-1');
    await fixture.whenStable();
    await flush();

    expect(commandService.apiCommandsCommandIdTerminatePost).toHaveBeenCalledWith('cmd-1');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['commands'] });
    expect(cmp.launchedCommandId()).toBeNull();

    // Once the registry reflects the termination, the session is gone.
    queryClient.setQueryData(['commands'], [chat({ status: CommandStatus.Terminated })]);
    await flush();
    fixture.detectChanges();
    expect(cmp.activeChatId()).toBeNull();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('app-workspace-prompt-panel'),
    ).not.toBeNull();
  });
});
