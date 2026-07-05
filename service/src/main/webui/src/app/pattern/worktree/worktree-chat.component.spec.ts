import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { CommandControllerService } from '@/api/api/commandController.service';
import { CommandDto } from '@/api/model/commandDto';
import { CommandKind } from '@/api/model/commandKind';
import { CommandStatus } from '@/api/model/commandStatus';
import { ZardDialogService } from '@/shared/components/dialog';
import { WorktreeChatComponent } from './worktree-chat.component';

/** Cache updates and mutation callbacks land on the next macrotask; flush before asserting. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function chat(overrides: Partial<CommandDto>): CommandDto {
  return {
    id: 'cmd-1',
    worktreeId: 'wt-1',
    kind: CommandKind.Chat,
    status: CommandStatus.Running,
    launchedAt: '2026-07-04T10:00:00Z',
    ...overrides,
  } as CommandDto;
}

describe('WorktreeChatComponent', () => {
  const commandService = {
    apiCommandsGet: vi.fn().mockReturnValue(of({ entries: [] })),
    apiCommandsCommandIdTerminatePost: vi.fn().mockReturnValue(of({})),
    // Default: a launched command resolves as a chat (echoing the requested id).
    apiCommandsCommandIdGet: vi
      .fn()
      .mockImplementation((id: string) => of({ command: chat({ id }) })),
  };
  const dialog = { create: vi.fn().mockReturnValue({ close: vi.fn() }) };
  const router = { navigate: vi.fn() };
  let queryClient: QueryClient;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Seeded data is the source of truth — never let it go stale and refetch from the mock.
    queryClient = new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity, retry: false, refetchOnMount: false } },
    });

    await TestBed.configureTestingModule({
      imports: [WorktreeChatComponent],
      providers: [
        provideTanStackQuery(queryClient),
        { provide: CommandControllerService, useValue: commandService },
        { provide: ZardDialogService, useValue: dialog },
        { provide: Router, useValue: router },
      ],
    }).compileComponents();
  });

  function createComponent() {
    const fixture = TestBed.createComponent(WorktreeChatComponent);
    fixture.componentRef.setInput('repoId', 'repo-1');
    fixture.componentRef.setInput('worktreeId', 'wt-1');
    fixture.detectChanges();
    return fixture;
  }

  it('shows the running-session dot only when a chat runs in this worktree', async () => {
    queryClient.setQueryData(['commands'], [chat({})]);
    const fixture = createComponent();

    expect(fixture.componentInstance.hasRunningSession()).toBe(true);
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[title="A chat session is running"]'),
    ).not.toBeNull();

    // A running chat elsewhere, or a finished one here, does not count.
    queryClient.setQueryData(
      ['commands'],
      [chat({ worktreeId: 'wt-2' }), chat({ id: 'cmd-2', status: CommandStatus.Exited })],
    );
    await flush();
    fixture.detectChanges();
    expect(fixture.componentInstance.hasRunningSession()).toBe(false);
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[title="A chat session is running"]'),
    ).toBeNull();
  });

  it('opens a full-size dialog that cannot be closed by a backdrop click', () => {
    const fixture = createComponent();
    (fixture.nativeElement as HTMLElement).querySelector('button')!.click();

    expect(dialog.create).toHaveBeenCalledWith(
      expect.objectContaining({ zHideFooter: true, zMaskClosable: false }),
    );
  });

  it('resolves the newest running chat for this worktree as the active session', () => {
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

  it('keeps the same command id across close and reopen — persistence is re-attach, not restart', () => {
    queryClient.setQueryData(['commands'], [chat({})]);
    const fixture = createComponent();
    const cmp = fixture.componentInstance;

    cmp.open();
    const idWhileOpen = cmp.activeChatId();
    dialog.create.mock.results[0].value.close();
    cmp.open();

    expect(dialog.create).toHaveBeenCalledTimes(2);
    expect(cmp.activeChatId()).toBe(idWhileOpen);
    expect(cmp.activeChatId()).toBe('cmd-1');
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
    cmp.open(); // establishes the dialog ref so it can be closed on redirect

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
    expect(cmp.activeChatId()).toBeNull();
  });
});
