import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { AgentSessionControllerService } from '@/api/api/agentSessionController.service';
import { AgentSessionNodeDto } from '@/api/model/agentSessionNodeDto';
import { forkBranchClass } from '@/ui/components/agent/agent-session-rows.component';
import { WorkspaceSessionTreeComponent } from './workspace-session-tree.component';

/** Cache updates land on the next macrotask; flush before asserting. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function node(overrides: Partial<AgentSessionNodeDto>): AgentSessionNodeDto {
  return {
    sessionId: 'sess-1',
    firstRecordedAt: '2026-07-10T10:00:00Z',
    messageCount: 3,
    newestCommandId: 'cmd-1',
    subagents: [],
    children: [],
    ...overrides,
  };
}

describe('WorkspaceSessionTreeComponent', () => {
  const sessionService = {
    apiRepositoriesRepoIdWorkspacesWorkspaceIdAgentSessionsGet: vi
      .fn()
      .mockReturnValue(of({ sessions: [] })),
  };
  let queryClient: QueryClient;

  beforeEach(async () => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity, retry: false, refetchOnMount: false } },
    });

    await TestBed.configureTestingModule({
      imports: [WorkspaceSessionTreeComponent],
      providers: [
        provideRouter([]),
        provideTanStackQuery(queryClient),
        { provide: AgentSessionControllerService, useValue: sessionService },
      ],
    }).compileComponents();
  });

  function createComponent(sessions: AgentSessionNodeDto[], currentSessionId: string | null = null) {
    queryClient.setQueryData(['workspace-agent-sessions', 'repo-1', 'wt-1'], sessions);
    const fixture = TestBed.createComponent(WorkspaceSessionTreeComponent);
    fixture.componentRef.setInput('repoId', 'repo-1');
    fixture.componentRef.setInput('workspaceId', 'wt-1');
    fixture.componentRef.setInput('currentSessionId', currentSessionId);
    fixture.detectChanges();
    return fixture;
  }

  function rows(fixture: { nativeElement: unknown }): HTMLLIElement[] {
    return Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('li'));
  }

  it('renders one row per session as date · id · message count', () => {
    const fixture = createComponent([
      node({ sessionId: 'sess-new', messageCount: 5, newestCommandId: 'cmd-n' }),
      node({ sessionId: 'sess-old', messageCount: 3, newestCommandId: 'cmd-o' }),
    ]);

    const items = rows(fixture);
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain('sess-new');
    expect(items[0].textContent).toContain('5 messages');
    // A row navigates to the newest command that drove the session.
    expect(items[0].querySelector('a')?.getAttribute('href')).toBe('/commands/cmd-n');
    expect(items[1].querySelector('a')?.getAttribute('href')).toBe('/commands/cmd-o');
  });

  it('indents fork children under their parent with a stable branch color', () => {
    const fixture = createComponent([
      node({
        sessionId: 'sess-root',
        children: [
          node({
            sessionId: 'sess-fork',
            forkedFromSessionId: 'sess-root',
            newestCommandId: 'cmd-f',
          }),
        ],
      }),
    ]);

    const [root, fork] = rows(fixture);
    expect(root.style.marginLeft).toBe('0rem');
    expect(fork.style.marginLeft).toBe('1.5rem');
    // The fork lineage's accent is deterministic from the session id — stable across renders.
    const anchor = fork.querySelector('a')!;
    expect(anchor.classList.contains('border-l-4')).toBe(true);
    expect(anchor.classList.contains(forkBranchClass('sess-fork'))).toBe(true);
    expect(root.querySelector('a')!.classList.contains('border-l-4')).toBe(false);
  });

  it('renders subagent sidechains grayed under their session, labeled from their meta', () => {
    const fixture = createComponent([
      node({
        sessionId: 'sess-root',
        subagents: [
          {
            agentId: 'a1b2',
            agentType: 'Explore',
            description: 'scan the tests',
            messageCount: 4,
            firstTimestamp: '2026-07-10T10:05:00Z',
          },
        ],
      }),
    ]);

    const [, subagent] = rows(fixture);
    expect(subagent.style.marginLeft).toBe('1.5rem');
    const card = subagent.querySelector('div')!;
    expect(card.classList.contains('bg-muted/40')).toBe(true);
    expect(card.textContent).toContain('Explore: scan the tests');
    expect(card.textContent).toContain('4 messages');
    // Sidechains are not operator sessions — no navigation target.
    expect(subagent.querySelector('a')).toBeNull();
  });

  it('highlights the current session and shows a live placeholder until its sweep', () => {
    const fixture = createComponent(
      [node({ sessionId: 'sess-live', messageCount: undefined }), node({ sessionId: 'sess-done' })],
      'sess-live',
    );

    const [live, done] = rows(fixture);
    expect(live.querySelector('a')!.classList.contains('ring-2')).toBe(true);
    expect(live.textContent).toContain('live');
    expect(done.querySelector('a')!.classList.contains('ring-2')).toBe(false);
    expect(done.textContent).toContain('3 messages');
  });

  it('shows an unswept, not-current session without a count rather than "live"', () => {
    const fixture = createComponent([node({ sessionId: 'sess-x', messageCount: undefined })]);

    const [row] = rows(fixture);
    expect(row.textContent).not.toContain('live');
    expect(row.textContent).toContain('—');
  });

  it('renders the empty state when the workspace has no sessions', () => {
    const fixture = createComponent([]);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('No agent sessions yet');
  });

  it('refetches through the SSE-invalidated query key', async () => {
    const fixture = createComponent([]);
    sessionService.apiRepositoriesRepoIdWorkspacesWorkspaceIdAgentSessionsGet.mockReturnValue(
      of({ sessions: [node({ sessionId: 'sess-fresh' })] }),
    );

    await queryClient.invalidateQueries({ queryKey: ['workspace-agent-sessions'] });
    await flush();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('sess-fresh');
  });
});
