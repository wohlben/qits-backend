import { TestBed } from '@angular/core/testing';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { SettingControllerService } from '@/api/api/settingController.service';
import { WorkspaceControllerService } from '@/api/api/workspaceController.service';
import { WorkspaceAgentActivityComponent } from './workspace-agent-activity.component';

/** Mutation callbacks land on the next macrotask; flush before asserting. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('WorkspaceAgentActivityComponent', () => {
  const putSpy = vi.fn().mockReturnValue(of({ setting: { key: 'x', value: 'false' } }));
  const settingService = {
    apiSettingsKeyGet: vi.fn().mockReturnValue(of({ setting: { value: 'true' } })),
    apiSettingsKeyPut: putSpy,
  };
  const workspaceService = {
    apiRepositoriesRepoIdWorkspacesGet: vi.fn().mockReturnValue(of({ entries: [] })),
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
      imports: [WorkspaceAgentActivityComponent],
      providers: [
        provideTanStackQuery(queryClient),
        { provide: SettingControllerService, useValue: settingService },
        { provide: WorkspaceControllerService, useValue: workspaceService },
      ],
    }).compileComponents();
  });

  function seedActivity(state: string | undefined) {
    queryClient.setQueryData(
      ['workspaces', 'repo-1'],
      [{ workspaceId: 'wt-1', agentActivity: state }],
    );
    queryClient.setQueryData(['setting', 'agent.activity-tracking.enabled'], true);
  }

  function createComponent() {
    const fixture = TestBed.createComponent(WorkspaceAgentActivityComponent);
    fixture.componentRef.setInput('repoId', 'repo-1');
    fixture.componentRef.setInput('workspaceId', 'wt-1');
    fixture.detectChanges();
    return fixture;
  }

  it('shows "Cooking…" when the agent is BUSY', () => {
    seedActivity('BUSY');
    const el = createComponent().nativeElement as HTMLElement;
    expect(el.textContent).toContain('Cooking…');
  });

  it('shows "Waiting on you" when WAITING', () => {
    seedActivity('WAITING');
    const el = createComponent().nativeElement as HTMLElement;
    expect(el.textContent).toContain('Waiting on you');
  });

  it('shows "Idle" when IDLE', () => {
    seedActivity('IDLE');
    const el = createComponent().nativeElement as HTMLElement;
    expect(el.textContent).toContain('Idle');
  });

  it('shows "No active agent" when nothing is reported', () => {
    seedActivity(undefined);
    const el = createComponent().nativeElement as HTMLElement;
    expect(el.textContent).toContain('No active agent');
  });

  it('persists the toggle as a string boolean when changed', async () => {
    seedActivity('IDLE');
    const fixture = createComponent();
    fixture.componentInstance.save(false);
    await flush();
    expect(putSpy).toHaveBeenCalledWith('agent.activity-tracking.enabled', { value: 'false' });
  });
});
