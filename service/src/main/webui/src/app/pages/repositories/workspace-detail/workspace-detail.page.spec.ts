import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { CommandControllerService } from '@/api/api/commandController.service';
import { WorkspaceControllerService } from '@/api/api/workspaceController.service';
import { ZardDialogService } from '@/shared/components/dialog';
import { EDarkModes, ZardDarkMode } from '@/shared/services/dark-mode';
import { WorkspaceDetailPage } from './workspace-detail.page';

describe('WorkspaceDetailPage', () => {
  const workspaceService = {
    apiRepositoriesRepoIdWorkspacesGet: vi.fn().mockReturnValue(of({ entries: [] })),
    apiRepositoriesRepoIdWorkspacesWorkspaceIdFilesGet: vi.fn().mockReturnValue(of({ paths: [] })),
  };
  const commandService = { apiCommandsGet: vi.fn().mockReturnValue(of({ entries: [] })) };
  const dialog = { create: vi.fn().mockReturnValue({ close: vi.fn() }) };
  const route = {
    snapshot: { paramMap: convertToParamMap({ repoId: 'repo-1', workspaceId: 'wt-1' }) },
  };
  let queryClient: QueryClient;

  beforeEach(async () => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity, retry: false, refetchOnMount: false } },
    });
    queryClient.setQueryData(
      ['workspaces', 'repo-1'],
      [{ workspaceId: 'wt-1', branch: 'feature/x', preamble: 'Do the thing' }],
    );
    queryClient.setQueryData(['workspace-files', 'repo-1', 'wt-1'], { paths: [], lazyDirs: [] });

    await TestBed.configureTestingModule({
      imports: [WorkspaceDetailPage],
      providers: [
        provideTanStackQuery(queryClient),
        { provide: ActivatedRoute, useValue: route },
        { provide: WorkspaceControllerService, useValue: workspaceService },
        { provide: CommandControllerService, useValue: commandService },
        { provide: ZardDialogService, useValue: dialog },
        { provide: ZardDarkMode, useValue: { themeMode: () => EDarkModes.LIGHT } },
      ],
    }).compileComponents();
  });

  it('offers the chat dialog in the header instead of the old WIP link', () => {
    const fixture = TestBed.createComponent(WorkspaceDetailPage);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelector('app-workspace-chat')).not.toBeNull();
    expect(el.textContent).not.toContain('Speak a prompt');
    expect(el.querySelector('a[href*="wip"]')).toBeNull();
  });
});
