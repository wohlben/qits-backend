import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { WorkspaceControllerService } from '@/api/api/workspaceController.service';
import { WorkspaceActivityBarComponent } from './workspace-activity-bar.component';

describe('WorkspaceActivityBarComponent', () => {
  const navigate = vi.fn();
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
      imports: [WorkspaceActivityBarComponent],
      providers: [
        provideTanStackQuery(queryClient),
        { provide: WorkspaceControllerService, useValue: workspaceService },
        { provide: Router, useValue: { navigate } },
      ],
    }).compileComponents();
  });

  function seed(workspaces: { workspaceId: string; branch?: string; agentActivity?: string }[]) {
    queryClient.setQueryData(['workspaces', 'repo-1'], workspaces);
  }

  function createComponent(currentWorkspaceId = 'wt-1') {
    const fixture = TestBed.createComponent(WorkspaceActivityBarComponent);
    fixture.componentRef.setInput('repoId', 'repo-1');
    fixture.componentRef.setInput('currentWorkspaceId', currentWorkspaceId);
    fixture.detectChanges();
    return fixture;
  }

  function buttons(el: HTMLElement): HTMLButtonElement[] {
    return Array.from(el.querySelectorAll('button'));
  }

  it('renders nothing when no workspace has activity', () => {
    seed([{ workspaceId: 'wt-1' }, { workspaceId: 'wt-2' }]);
    const el = createComponent().nativeElement as HTMLElement;
    expect(el.querySelector('nav')).toBeNull();
    expect(buttons(el)).toHaveLength(0);
  });

  it('renders one button per workspace with activity', () => {
    seed([
      { workspaceId: 'wt-1', branch: 'main', agentActivity: 'BUSY' },
      { workspaceId: 'wt-2', branch: 'feature', agentActivity: 'WAITING' },
      { workspaceId: 'wt-3', branch: 'idle-one' },
    ]);
    const el = createComponent().nativeElement as HTMLElement;
    const labels = buttons(el).map((b) => b.textContent?.trim());
    expect(buttons(el)).toHaveLength(2);
    expect(labels.join(' ')).toContain('main');
    expect(labels.join(' ')).toContain('feature');
    expect(labels.join(' ')).not.toContain('idle-one');
  });

  it('marks the current workspace button with aria-current', () => {
    seed([
      { workspaceId: 'wt-1', branch: 'main', agentActivity: 'BUSY' },
      { workspaceId: 'wt-2', branch: 'feature', agentActivity: 'WAITING' },
    ]);
    const el = createComponent('wt-2').nativeElement as HTMLElement;
    const current = buttons(el).find((b) => b.getAttribute('aria-current') === 'page');
    expect(current?.textContent).toContain('feature');
    expect(buttons(el).filter((b) => b.getAttribute('aria-current') === 'page')).toHaveLength(1);
  });

  it('surfaces the state label for assistive tech and the title', () => {
    seed([{ workspaceId: 'wt-1', branch: 'main', agentActivity: 'WAITING' }]);
    const el = createComponent().nativeElement as HTMLElement;
    expect(el.textContent).toContain('Waiting on you');
    expect(buttons(el)[0].getAttribute('title')).toContain('Waiting on you');
  });

  it('navigates to the chat tab of the clicked workspace', () => {
    seed([{ workspaceId: 'wt-2', branch: 'feature', agentActivity: 'BUSY' }]);
    const el = createComponent().nativeElement as HTMLElement;
    buttons(el)[0].click();
    expect(navigate).toHaveBeenCalledWith([
      '/repositories',
      'repo-1',
      'workspaces',
      'wt-2',
      'chat',
    ]);
  });
});
