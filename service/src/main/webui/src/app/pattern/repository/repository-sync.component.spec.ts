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
  function setup() {
    const repositoryService = {
      apiRepositoriesRepoIdSyncStatusGet: vi.fn().mockReturnValue(of({ branch: 'main' })),
      apiRepositoriesRepoIdBranchesGet: vi.fn().mockReturnValue(of({ branches: [] })),
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

    const fixture = TestBed.createComponent(RepositorySyncComponent);
    fixture.componentRef.setInput('repoId', 'repo-1');
    fixture.detectChanges();
    const component = fixture.componentInstance;
    return { fixture, component, repositoryService, dialog, invalidateSpy };
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
});
