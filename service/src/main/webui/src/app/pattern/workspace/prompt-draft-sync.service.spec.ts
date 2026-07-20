import { EnvironmentInjector, createEnvironmentInjector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { NEVER, Observable, of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { WorkspacePromptDraftControllerService } from '@/api/api/workspacePromptDraftController.service';
import { PromptContextStore } from '@/shared/state/prompt-context.store';
import { PromptDraftSyncService } from './prompt-draft-sync.service';

describe('PromptDraftSyncService', () => {
  let draftService: {
    apiRepositoriesRepoIdWorkspacesWorkspaceIdPromptDraftGet: ReturnType<typeof vi.fn>;
    apiRepositoriesRepoIdWorkspacesWorkspaceIdPromptDraftPut: ReturnType<typeof vi.fn>;
    apiRepositoriesRepoIdWorkspacesWorkspaceIdPromptDraftDelete: ReturnType<typeof vi.fn>;
  };

  /**
   * GET default: `NEVER` (query stays pending) so the hydrate path can't interfere with the autosave
   * tests — in production the post-save SSE refetch returns the saved draft, never a stale 404. Tests
   * that exercise hydrate pass an explicit observable.
   */
  function configure(getReturn: Observable<unknown> = NEVER) {
    draftService = {
      apiRepositoriesRepoIdWorkspacesWorkspaceIdPromptDraftGet: vi.fn().mockReturnValue(getReturn),
      apiRepositoriesRepoIdWorkspacesWorkspaceIdPromptDraftPut: vi
        .fn()
        .mockReturnValue(of({ updatedAt: 't-new' })),
      apiRepositoriesRepoIdWorkspacesWorkspaceIdPromptDraftDelete: vi.fn().mockReturnValue(of({})),
    };
    TestBed.configureTestingModule({
      providers: [
        provideTanStackQuery(new QueryClient()),
        { provide: WorkspacePromptDraftControllerService, useValue: draftService },
      ],
    });
  }

  /**
   * Construct the service in a child injector we can destroy deterministically (to exercise
   * flush-on-destroy). It inherits the TestBed's QueryClient + mocked draft service.
   */
  function makeService() {
    const child = createEnvironmentInjector(
      [PromptDraftSyncService],
      TestBed.inject(EnvironmentInjector),
    );
    const service = child.get(PromptDraftSyncService);
    const store = TestBed.inject(PromptContextStore);
    return { service, store, child };
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it('hydrates the store from a fetched draft', async () => {
    configure(
      of({
        content: JSON.stringify({ v: 1, promptText: 'restored idea', snippets: [], references: [] }),
        serializedPrompt: 'restored idea',
        updatedAt: 't1',
      }),
    );
    const { service, store } = makeService();
    service.connect('repo-1', 'wt-1');

    await vi.waitFor(() => {
      TestBed.tick();
      expect(store.promptText()).toBe('restored idea');
    });
    expect(store.justRestored()).toBe(true);
    expect(store.dirty()).toBe(false);
  });

  it('leaves the store empty on a 404 and does not autosave', async () => {
    vi.useFakeTimers();
    configure(throwError(() => ({ status: 404 }))); // 404 → mapped to null (no draft)
    const { store } = (() => {
      const s = makeService();
      s.service.connect('repo-1', 'wt-1');
      return s;
    })();

    TestBed.tick();
    await vi.advanceTimersByTimeAsync(2000);
    expect(store.promptText()).toBe('');
    expect(draftService.apiRepositoriesRepoIdWorkspacesWorkspaceIdPromptDraftPut).not.toHaveBeenCalled();
    expect(
      draftService.apiRepositoriesRepoIdWorkspacesWorkspaceIdPromptDraftDelete,
    ).not.toHaveBeenCalled();
  });

  it('debounces an edit into a single PUT with content + serializedPrompt, then marks saved', async () => {
    vi.useFakeTimers();
    configure();
    const { service, store } = makeService();
    service.connect('repo-1', 'wt-1');

    store.setPromptText('do the thing');
    TestBed.tick();
    // Nothing before the debounce window elapses.
    await vi.advanceTimersByTimeAsync(1400);
    expect(draftService.apiRepositoriesRepoIdWorkspacesWorkspaceIdPromptDraftPut).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(200);
    const put = draftService.apiRepositoriesRepoIdWorkspacesWorkspaceIdPromptDraftPut;
    expect(put).toHaveBeenCalledTimes(1);
    const [repoId, workspaceId, body] = put.mock.calls[0];
    expect(repoId).toBe('repo-1');
    expect(workspaceId).toBe('wt-1');
    expect(body.serializedPrompt).toBe('do the thing');
    expect(JSON.parse(body.content).promptText).toBe('do the thing');
    expect(store.dirty()).toBe(false);
    expect(store.lastSavedUpdatedAt()).toBe('t-new');
  });

  it('coalesces a burst of edits into one in-flight save (last write wins)', async () => {
    vi.useFakeTimers();
    configure();
    const { service, store } = makeService();
    service.connect('repo-1', 'wt-1');

    store.setPromptText('one');
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(500);
    store.setPromptText('two'); // resets the debounce
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(1600);

    const put = draftService.apiRepositoriesRepoIdWorkspacesWorkspaceIdPromptDraftPut;
    expect(put).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0][2].serializedPrompt).toBe('two');
  });

  it('DELETEs an emptied draft that had a server row', async () => {
    vi.useFakeTimers();
    configure();
    const { service, store } = makeService();
    service.connect('repo-1', 'wt-1');
    // Simulate a previously-hydrated draft so a server row (lastSavedUpdatedAt) is known.
    store.hydrateFromContent('wt-1', JSON.stringify({ v: 1, promptText: 'x' }), 't1');
    expect(store.lastSavedUpdatedAt()).toBe('t1');

    store.clear(); // empties the bucket, marks dirty
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(1600);

    expect(
      draftService.apiRepositoriesRepoIdWorkspacesWorkspaceIdPromptDraftDelete,
    ).toHaveBeenCalledWith('repo-1', 'wt-1');
    expect(store.lastSavedUpdatedAt()).toBeNull();
    expect(draftService.apiRepositoriesRepoIdWorkspacesWorkspaceIdPromptDraftPut).not.toHaveBeenCalled();
  });

  it('does not DELETE an empty bucket that never had a server row (delete-on-first-load guard)', async () => {
    vi.useFakeTimers();
    configure(); // 404 → no row
    const { service, store } = makeService();
    service.connect('repo-1', 'wt-1');

    // A user edit then a clear, all while no row ever existed.
    store.setPromptText('typo');
    store.clear();
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(1600);

    expect(
      draftService.apiRepositoriesRepoIdWorkspacesWorkspaceIdPromptDraftDelete,
    ).not.toHaveBeenCalled();
    expect(draftService.apiRepositoriesRepoIdWorkspacesWorkspaceIdPromptDraftPut).not.toHaveBeenCalled();
  });

  it('flushes a pending edit with a final PUT on destroy', () => {
    configure();
    const { service, store, child } = makeService();
    service.connect('repo-1', 'wt-1');

    store.setPromptText('unsaved on navigate'); // dirty, debounce not yet elapsed
    child.destroy();

    const put = draftService.apiRepositoriesRepoIdWorkspacesWorkspaceIdPromptDraftPut;
    expect(put).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0][2].serializedPrompt).toBe('unsaved on navigate');
  });
});
