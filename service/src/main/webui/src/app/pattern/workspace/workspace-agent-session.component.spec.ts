import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { AgentControllerService } from '@/api/api/agentController.service';
import { AgentsControllerService } from '@/api/api/agentsController.service';
import { CommandControllerService } from '@/api/api/commandController.service';
import { WorkspacePromptDraftControllerService } from '@/api/api/workspacePromptDraftController.service';
import { PromptDraftSyncService } from '@/pattern/workspace/prompt-draft-sync.service';
import { AgentLaunchMode } from '@/api/model/agentLaunchMode';
import { AgentMcpScope } from '@/api/model/agentMcpScope';
import { CommandDto } from '@/api/model/commandDto';
import { CommandKind } from '@/api/model/commandKind';
import { CommandStatus } from '@/api/model/commandStatus';
import { WorkspaceAgentSessionComponent } from './workspace-agent-session.component';

/** Cache updates and mutation callbacks land on the next macrotask; flush before asserting. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** xterm.js needs matchMedia + ResizeObserver, which jsdom doesn't provide. */
function stubXtermBrowserApis(): void {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    media: '',
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  }));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
}

/** A running interactive agent run (TERMINAL + session lineage) in this workspace. */
function agentRun(overrides: Partial<CommandDto>): CommandDto {
  return {
    id: 'run-1',
    workspaceId: 'wt-1',
    kind: CommandKind.Terminal,
    status: CommandStatus.Running,
    launchedAt: '2026-07-10T10:00:00Z',
    agentSessions: [{ sessionId: 'sess-1', source: 'PINNED' }],
    ...overrides,
  } as CommandDto;
}

function chat(overrides: Partial<CommandDto>): CommandDto {
  return agentRun({ id: 'chat-1', kind: CommandKind.Chat, ...overrides });
}

describe('WorkspaceAgentSessionComponent', () => {
  const commandService = {
    apiCommandsGet: vi.fn().mockReturnValue(of({ entries: [] })),
    apiCommandsCommandIdTerminatePost: vi.fn().mockReturnValue(of({})),
  };
  const agentService = {
    apiRepositoriesRepoIdWorkspacesWorkspaceIdAgentsPost: vi
      .fn()
      .mockImplementation(() => of({ command: agentRun({ id: 'launched-1' }) })),
  };
  // Empty availability: no default agent → fresh launches omit agentType, keeping the body
  // assertions here exact. (Production seeds the picker from a real defaultAgent.)
  const agentsService = {
    apiAgentsAvailableGet: vi.fn().mockReturnValue(of({})),
  };
  // No draft by default; individual tests override the GET to exercise auto-pickup. A fresh launch
  // flushes then refetches the draft before deciding delivery, so the GET (not just seeded cache) is
  // the source of truth.
  const draftService = {
    apiRepositoriesRepoIdWorkspacesWorkspaceIdPromptDraftGet: vi.fn().mockReturnValue(of(null)),
  };
  // The launch flushes the shared route-scoped sync service first; a mock that resolves.
  const promptDraftSync = { flushNow: vi.fn().mockResolvedValue(undefined) };
  let queryClient: QueryClient;

  beforeEach(async () => {
    vi.clearAllMocks();
    // clearAllMocks resets call history but not implementations — restore the per-test defaults.
    draftService.apiRepositoriesRepoIdWorkspacesWorkspaceIdPromptDraftGet.mockReturnValue(of(null));
    promptDraftSync.flushNow.mockResolvedValue(undefined);
    // The embedded terminal opens a PTY socket; keep it out of jsdom.
    vi.stubGlobal(
      'WebSocket',
      class {
        send() {}
        close() {}
      },
    );
    stubXtermBrowserApis();
    queryClient = new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity, retry: false, refetchOnMount: false } },
    });

    await TestBed.configureTestingModule({
      imports: [WorkspaceAgentSessionComponent],
      providers: [
        provideRouter([]),
        provideTanStackQuery(queryClient),
        { provide: CommandControllerService, useValue: commandService },
        { provide: AgentControllerService, useValue: agentService },
        { provide: AgentsControllerService, useValue: agentsService },
        { provide: WorkspacePromptDraftControllerService, useValue: draftService },
        { provide: PromptDraftSyncService, useValue: promptDraftSync },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function createComponent(activated = true) {
    const fixture = TestBed.createComponent(WorkspaceAgentSessionComponent);
    fixture.componentRef.setInput('repoId', 'repo-1');
    fixture.componentRef.setInput('workspaceId', 'wt-1');
    fixture.componentRef.setInput('activated', activated);
    fixture.detectChanges();
    return fixture;
  }

  it('attaches to a running interactive agent run instead of launching', async () => {
    queryClient.setQueryData(['commands'], [agentRun({})]);
    const fixture = createComponent();
    await flush();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-web-terminal')).not.toBeNull();
    expect(agentService.apiRepositoriesRepoIdWorkspacesWorkspaceIdAgentsPost).not.toHaveBeenCalled();
  });

  it('converges on the last-initiated run when several are running', async () => {
    queryClient.setQueryData(
      ['commands'],
      [
        agentRun({ id: 'run-old', launchedAt: '2026-07-10T09:00:00Z' }),
        agentRun({ id: 'run-new', launchedAt: '2026-07-10T11:00:00Z' }),
      ],
    );
    const fixture = createComponent();
    await flush();

    expect(fixture.componentInstance.attachedCommandId()).toBe('run-new');
  });

  it('defers to a live chat instead of launching a concurrent resume', async () => {
    queryClient.setQueryData(['commands'], [chat({})]);
    const fixture = createComponent();
    await flush();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("This workspace's conversation is live in the Chat tab");
    expect(agentService.apiRepositoriesRepoIdWorkspacesWorkspaceIdAgentsPost).not.toHaveBeenCalled();

    let jumped = false;
    fixture.componentInstance.jumpToChat.subscribe(() => (jumped = true));
    el.querySelector('button')!.click();
    expect(jumped).toBe(true);
  });

  it('idles on the explicit choice instead of auto-resuming when history exists', async () => {
    // The recorded last session can be gone from the agent's state (re-materialized container),
    // and an auto --resume of a vanished id exits instantly — so history never auto-launches.
    queryClient.setQueryData(
      ['commands'],
      [
        agentRun({
          id: 'cmd-new',
          status: CommandStatus.Exited,
          launchedAt: '2026-07-10T11:00:00Z',
          agentSessions: [{ sessionId: 'sess-b', source: 'PINNED' }],
        }),
      ],
    );
    const fixture = createComponent();
    await flush();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('No agent session is running');
    expect(agentService.apiRepositoriesRepoIdWorkspacesWorkspaceIdAgentsPost).not.toHaveBeenCalled();

    // The explicit fallback: a fresh session, no resumeSessionId.
    const startNew = Array.from(el.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Start new session',
    )!;
    startNew.click();
    await flush();

    expect(agentService.apiRepositoriesRepoIdWorkspacesWorkspaceIdAgentsPost).toHaveBeenCalledWith(
      'repo-1',
      'wt-1',
      { scope: AgentMcpScope.Repository, mode: AgentLaunchMode.Interactive },
    );
  });

  it('creates a fresh session when the workspace has no session history', async () => {
    queryClient.setQueryData(['commands'], []);
    createComponent();
    await flush();

    expect(agentService.apiRepositoriesRepoIdWorkspacesWorkspaceIdAgentsPost).toHaveBeenCalledWith(
      'repo-1',
      'wt-1',
      { scope: AgentMcpScope.Repository, mode: AgentLaunchMode.Interactive },
    );
  });

  it('flushes then delivers the composed prompt on a fresh auto-launch when the draft is un-run', async () => {
    // A prompt was composed and hasn't been handed to an agent at its current version — opening the
    // Agents tab flushes any pending edit, refetches, and picks it up once (fetched via taskPrompt).
    draftService.apiRepositoriesRepoIdWorkspacesWorkspaceIdPromptDraftGet.mockReturnValue(
      of({ content: '{}', serializedPrompt: 'do the thing', promptVersion: 3, lastRunPromptVersion: 1 }),
    );
    queryClient.setQueryData(['commands'], []);
    createComponent();

    // The fresh launch awaits flushNow + a draft refetch before deciding delivery — wait for the
    // resulting mutation rather than a single macrotask.
    await vi.waitFor(() => {
      expect(agentService.apiRepositoriesRepoIdWorkspacesWorkspaceIdAgentsPost).toHaveBeenCalledWith(
        'repo-1',
        'wt-1',
        {
          scope: AgentMcpScope.Repository,
          mode: AgentLaunchMode.Interactive,
          deliverTaskPrompt: true,
        },
      );
    });
    expect(promptDraftSync.flushNow).toHaveBeenCalled();
  });

  it('does not re-deliver a draft whose current version was already run', async () => {
    draftService.apiRepositoriesRepoIdWorkspacesWorkspaceIdPromptDraftGet.mockReturnValue(
      of({ content: '{}', serializedPrompt: 'do the thing', promptVersion: 2, lastRunPromptVersion: 2 }),
    );
    queryClient.setQueryData(['commands'], []);
    createComponent();

    // No deliver flag — the fresh session starts idle, exactly as with no draft at all.
    await vi.waitFor(() => {
      expect(agentService.apiRepositoriesRepoIdWorkspacesWorkspaceIdAgentsPost).toHaveBeenCalledWith(
        'repo-1',
        'wt-1',
        { scope: AgentMcpScope.Repository, mode: AgentLaunchMode.Interactive },
      );
    });
  });

  it('launches nothing until the tab is first selected', async () => {
    queryClient.setQueryData(['commands'], []);
    const fixture = createComponent(false);
    await flush();
    expect(agentService.apiRepositoriesRepoIdWorkspacesWorkspaceIdAgentsPost).not.toHaveBeenCalled();

    fixture.componentRef.setInput('activated', true);
    fixture.detectChanges();
    await flush();
    expect(agentService.apiRepositoriesRepoIdWorkspacesWorkspaceIdAgentsPost).toHaveBeenCalledTimes(1);
  });

  it('hosts the sign-in REPL in place and re-resolves once it exits', async () => {
    queryClient.setQueryData(['commands'], []);
    // Not signed in → the launch returns the sign-in REPL: a TERMINAL with no session lineage.
    agentService.apiRepositoriesRepoIdWorkspacesWorkspaceIdAgentsPost.mockReturnValueOnce(
      of({ command: agentRun({ id: 'login-1', agentSessions: [] }) }),
    );
    const fixture = createComponent();
    await flush();
    fixture.detectChanges();

    // The REPL is a PTY like any other — it embeds here rather than redirecting.
    expect(fixture.componentInstance.attachedCommandId()).toBe('login-1');
    expect((fixture.nativeElement as HTMLElement).querySelector('app-web-terminal')).not.toBeNull();

    // The operator finishes OAuth and the REPL exits → resolution re-runs, now signed in.
    queryClient.setQueryData(
      ['commands'],
      [agentRun({ id: 'login-1', status: CommandStatus.Exited, agentSessions: [] })],
    );
    await flush();
    fixture.detectChanges();
    await flush();

    expect(agentService.apiRepositoriesRepoIdWorkspacesWorkspaceIdAgentsPost).toHaveBeenCalledTimes(2);
  });

  it('shows the ended state with Resume and a transcript link — no auto-relaunch', async () => {
    queryClient.setQueryData(['commands'], [agentRun({})]);
    const fixture = createComponent();
    await flush();
    fixture.detectChanges();
    expect(fixture.componentInstance.attachedCommandId()).toBe('run-1');

    // The run exits (operator /exit, Terminate, or a crash).
    queryClient.setQueryData(['commands'], [agentRun({ status: CommandStatus.Exited })]);
    await flush();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('The session has ended');
    expect(el.querySelector('a[href="/commands/run-1"]')).not.toBeNull();
    expect(agentService.apiRepositoriesRepoIdWorkspacesWorkspaceIdAgentsPost).not.toHaveBeenCalled();

    // Resume re-runs resolution: the just-ended session is the last one, and it continues.
    const resumeButton = Array.from(el.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Resume',
    )!;
    resumeButton.click();
    await flush();

    expect(agentService.apiRepositoriesRepoIdWorkspacesWorkspaceIdAgentsPost).toHaveBeenCalledWith(
      'repo-1',
      'wt-1',
      {
        scope: AgentMcpScope.Repository,
        mode: AgentLaunchMode.Interactive,
        resumeSessionId: 'sess-1',
      },
    );
  });

  it('offers a fresh start from the ended state — the vanished-session fallback', async () => {
    queryClient.setQueryData(['commands'], [agentRun({})]);
    const fixture = createComponent();
    await flush();
    fixture.detectChanges();

    // The run exits — e.g. instantly, because --resume found no conversation for the session id.
    queryClient.setQueryData(['commands'], [agentRun({ status: CommandStatus.Exited })]);
    await flush();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const newSession = Array.from(el.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'New session',
    )!;
    newSession.click();
    await flush();

    expect(agentService.apiRepositoriesRepoIdWorkspacesWorkspaceIdAgentsPost).toHaveBeenCalledWith(
      'repo-1',
      'wt-1',
      { scope: AgentMcpScope.Repository, mode: AgentLaunchMode.Interactive },
    );
  });

  it('offers Terminate while the embedded run is live', async () => {
    queryClient.setQueryData(['commands'], [agentRun({})]);
    const fixture = createComponent();
    await flush();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const terminate = Array.from(el.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Terminate',
    )!;
    terminate.click();
    await flush();

    expect(commandService.apiCommandsCommandIdTerminatePost).toHaveBeenCalledWith('run-1');
  });
});
