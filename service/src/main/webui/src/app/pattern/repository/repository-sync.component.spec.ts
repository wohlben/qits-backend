import { TestBed } from '@angular/core/testing';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { RepositoryControllerService } from '@/api/api/repositoryController.service';
import { ZardDialogService } from '@/shared/components/dialog';
import { RepositorySyncComponent } from './repository-sync.component';

/** Cache updates / mutation callbacks land on the next macrotask; flush before asserting. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('RepositorySyncComponent', () => {
  function setup(options: { activeProcessId?: string | null } = {}) {
    const repositoryService = {
      apiRepositoriesRepoIdSyncStatusGet: vi.fn().mockReturnValue(of({ branch: 'main' })),
      apiRepositoriesRepoIdBranchesGet: vi.fn().mockReturnValue(of({ branches: [] })),
      apiRepositoriesRepoIdActiveProcessGet: vi
        .fn()
        .mockReturnValue(of({ technicalProcessId: options.activeProcessId ?? undefined })),
      apiRepositoriesRepoIdPullPost: vi
        .fn()
        .mockReturnValue(of({ technicalProcessId: 'proc-1' })),
      apiRepositoriesRepoIdPushPost: vi.fn().mockReturnValue(of({})),
      apiRepositoriesRepoIdSyncPost: vi
        .fn()
        .mockReturnValue(of({ technicalProcessId: 'proc-1' })),
      apiRepositoriesRepoIdMainBranchPut: vi.fn().mockReturnValue(of({})),
    };
    const dialogRef = { close: vi.fn() };
    const dialog = { create: vi.fn().mockReturnValue(dialogRef) };
    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);

    TestBed.configureTestingModule({
      imports: [RepositorySyncComponent],
      providers: [
        provideTanStackQuery(queryClient),
        { provide: RepositoryControllerService, useValue: repositoryService },
        { provide: ZardDialogService, useValue: dialog },
      ],
    });

    // Seed the reattach query synchronously so the discovery effect sees a running process on mount
    // (the injectQuery fetch is async; the seeded value drives the on-load reattach deterministically).
    if (options.activeProcessId !== undefined) {
      queryClient.setQueryData(['repository-active-process', 'repo-1'], options.activeProcessId);
    }

    const fixture = TestBed.createComponent(RepositorySyncComponent);
    fixture.componentRef.setInput('repoId', 'repo-1');
    fixture.detectChanges();
    const component = fixture.componentInstance;
    return { fixture, component, queryClient, repositoryService, dialog, invalidateSpy };
  }

  it('opens the "Pulling repository" dialog on pull success without invalidating yet', async () => {
    const { component, repositoryService, dialog, invalidateSpy } = setup();

    component.pullMutation.mutate();
    await flush();

    expect(repositoryService.apiRepositoriesRepoIdPullPost).toHaveBeenCalledWith('repo-1');
    expect(component.processId()).toBe('proc-1');
    expect(dialog.create).toHaveBeenCalledTimes(1);
    expect(dialog.create.mock.calls[0][0]).toMatchObject({ zTitle: 'Pulling repository' });
    // The pull is asynchronous: nothing was pulled yet, so the header must not refresh on the POST.
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('invalidates the repository only when the pull process finishes', async () => {
    const { component, invalidateSpy } = setup();

    component.pullMutation.mutate();
    await flush();
    expect(invalidateSpy).not.toHaveBeenCalled();

    // The technical-process view emits (finished) at `done`.
    component.onProcessFinished();
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
  });

  it('opens the "Syncing repository" dialog on sync success without invalidating yet', async () => {
    const { component, repositoryService, dialog, invalidateSpy } = setup();

    component.syncMutation.mutate();
    await flush();

    expect(repositoryService.apiRepositoriesRepoIdSyncPost).toHaveBeenCalledWith('repo-1');
    expect(component.processId()).toBe('proc-1');
    expect(dialog.create).toHaveBeenCalledTimes(1);
    expect(dialog.create.mock.calls[0][0]).toMatchObject({ zTitle: 'Syncing repository' });
    // Like pull, sync is asynchronous: nothing ran yet, so the header must not refresh on the POST.
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('invalidates the repository only when the sync process finishes', async () => {
    const { component, invalidateSpy } = setup();

    component.syncMutation.mutate();
    await flush();
    expect(invalidateSpy).not.toHaveBeenCalled();

    // The technical-process view emits (finished) at `done`.
    component.onProcessFinished();
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
  });

  it('reattaches to a running process discovered on mount (reload / second tab)', async () => {
    const { component, fixture, dialog } = setup({ activeProcessId: 'proc-9' });
    await flush();
    fixture.detectChanges();

    // The active-process query rediscovered a running pull → the dialog reopens on its stream.
    expect(component.processActive()).toBe(true);
    expect(component.processId()).toBe('proc-9');
    expect(dialog.create).toHaveBeenCalledTimes(1);
    expect(dialog.create.mock.calls[0][0]).toMatchObject({ zTitle: 'Repository sync' });
  });

  it('engages the guard on pull and keeps it engaged after the dialog is closed', async () => {
    const { component, queryClient } = setup();
    await flush();
    const guardKey = ['repository-active-process', 'repo-1'];
    expect(queryClient.getQueryData(guardKey)).toBeFalsy();

    // Pull seeds the active-process guard immediately (before the SSE hint's refetch) — so no window
    // exists in which a second Pull/Sync could start a competing walk. `processActive` derives from
    // this cache value (proven reactive by the reattach test + the sync-bar spec).
    component.pullMutation.mutate();
    await flush();
    expect(queryClient.getQueryData(guardKey)).toBe('proc-1');

    // Closing the dialog must not clear the guard while the pull is still running (invalidate is a
    // no-op here — the mocked queryClient never refetches, so the running id survives the close).
    component.closeDialog();
    await flush();
    expect(queryClient.getQueryData(guardKey)).toBe('proc-1');
  });
});
