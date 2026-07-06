import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { CommandControllerService } from '@/api/api/commandController.service';
import { WorkspaceControllerService } from '@/api/api/workspaceController.service';
import { WorkspaceFileBrowserComponent } from '@/pattern/workspace/workspace-file-browser.component';
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

  it('hosts Files, Events and Telemetry as sibling observation tabs', () => {
    const fixture = TestBed.createComponent(WorkspaceDetailPage);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    // role="tab" (not the z-button default role="button") — regression for the clobbered-role bug.
    const tabLabels = Array.from(el.querySelectorAll('nav[role="tablist"] [role="tab"]')).map((b) =>
      b.textContent?.trim(),
    );
    expect(tabLabels).toEqual(['Files', 'Events', 'Telemetry']);
    // The events feed lives in its tab, not in the daemons panel.
    expect(el.querySelector('app-workspace-daemon-events')).not.toBeNull();
    expect(el.querySelector('app-workspace-daemons app-workspace-daemon-events')).toBeNull();
  });

  it('an openFile from the Events tab selects the Files tab and anchors the file browser', () => {
    const fixture = TestBed.createComponent(WorkspaceDetailPage);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    const fileBrowser = fixture.debugElement.query(
      By.directive(WorkspaceFileBrowserComponent),
    ).componentInstance;
    const openAtLine = vi.spyOn(fileBrowser, 'openAtLine').mockImplementation(() => undefined);

    // Start on the Events tab so the jump back to Files is observable.
    const eventsTab = Array.from(el.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(
      (b) => b.textContent?.trim() === 'Events',
    );
    eventsTab!.click();
    fixture.detectChanges();
    expect(eventsTab!.getAttribute('aria-selected')).toBe('true');

    fixture.componentInstance.openFileFromEvent({ path: 'src/app.ts', startLine: 3, endLine: 5 });
    fixture.detectChanges();

    expect(openAtLine).toHaveBeenCalledWith('src/app.ts', 3, 5);
    const filesTab = Array.from(el.querySelectorAll('[role="tab"]')).find(
      (b) => b.textContent?.trim() === 'Files',
    );
    expect(filesTab!.getAttribute('aria-selected')).toBe('true');
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
