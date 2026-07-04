import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { CommandControllerService } from '@/api/api/commandController.service';
import { WorktreeControllerService } from '@/api/api/worktreeController.service';
import { ZardDialogService } from '@/shared/components/dialog';
import { EDarkModes, ZardDarkMode } from '@/shared/services/dark-mode';
import { WorktreeDetailPage } from './worktree-detail.page';

describe('WorktreeDetailPage', () => {
  const worktreeService = {
    apiRepositoriesRepoIdWorktreesGet: vi.fn().mockReturnValue(of({ entries: [] })),
    apiRepositoriesRepoIdWorktreesWorktreeIdFilesGet: vi.fn().mockReturnValue(of({ paths: [] })),
  };
  const commandService = { apiCommandsGet: vi.fn().mockReturnValue(of({ entries: [] })) };
  const dialog = { create: vi.fn().mockReturnValue({ close: vi.fn() }) };
  const route = {
    snapshot: { paramMap: convertToParamMap({ repoId: 'repo-1', worktreeId: 'wt-1' }) },
  };
  let queryClient: QueryClient;

  beforeEach(async () => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity, retry: false, refetchOnMount: false } },
    });
    queryClient.setQueryData(
      ['worktrees', 'repo-1'],
      [{ worktreeId: 'wt-1', branch: 'feature/x', preamble: 'Do the thing' }],
    );
    queryClient.setQueryData(['worktree-files', 'repo-1', 'wt-1'], { paths: [], lazyDirs: [] });

    await TestBed.configureTestingModule({
      imports: [WorktreeDetailPage],
      providers: [
        provideTanStackQuery(queryClient),
        { provide: ActivatedRoute, useValue: route },
        { provide: WorktreeControllerService, useValue: worktreeService },
        { provide: CommandControllerService, useValue: commandService },
        { provide: ZardDialogService, useValue: dialog },
        { provide: ZardDarkMode, useValue: { themeMode: () => EDarkModes.LIGHT } },
      ],
    }).compileComponents();
  });

  it('offers the chat dialog in the header instead of the old WIP link', () => {
    const fixture = TestBed.createComponent(WorktreeDetailPage);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelector('app-worktree-chat')).not.toBeNull();
    expect(el.textContent).not.toContain('Speak a prompt');
    expect(el.querySelector('a[href*="wip"]')).toBeNull();
  });
});
