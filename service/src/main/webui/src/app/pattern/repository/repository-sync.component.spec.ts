import { TemplateRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RepositoryControllerService } from '@/api/api/repositoryController.service';
import { ZardDialogService } from '@/shared/components/dialog';
import { RepositorySyncComponent } from './repository-sync.component';

/** Cache updates / mutation callbacks land on the next macrotask; flush before asserting. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Minimal WebSocket stand-in so the embedded sign-in terminal can connect (no server). */
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(): void {}

  close(): void {
    this.readyState = 3;
  }
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
      apiRepositoriesRepoIdPushPost: vi
        .fn()
        .mockReturnValue(of({ technicalProcessId: 'proc-1' })),
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

  afterEach(() => {
    vi.unstubAllGlobals();
  });

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

  it('opens the "Pushing repository" dialog on push success without invalidating yet', async () => {
    const { component, repositoryService, dialog, invalidateSpy } = setup();

    component.pushMutation.mutate();
    await flush();

    expect(repositoryService.apiRepositoriesRepoIdPushPost).toHaveBeenCalledWith('repo-1');
    expect(component.processId()).toBe('proc-1');
    expect(dialog.create).toHaveBeenCalledTimes(1);
    expect(dialog.create.mock.calls[0][0]).toMatchObject({ zTitle: 'Pushing repository' });
    // Like pull/sync, push is asynchronous: nothing ran yet, so the header must not refresh on the
    // POST.
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('invalidates the repository only when the push process finishes', async () => {
    const { component, invalidateSpy } = setup();

    component.pushMutation.mutate();
    await flush();
    expect(invalidateSpy).not.toHaveBeenCalled();

    // The technical-process view emits (finished) at `done`.
    component.onProcessFinished();
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
  });

  it('surfaces a POST failure in the inline banner and clears it on the next success', async () => {
    const { component, fixture, repositoryService, dialog } = setup();
    // An in-request failure (e.g. the 400 busy-conflict) — no process, no dialog.
    repositoryService.apiRepositoriesRepoIdPushPost.mockReturnValueOnce(
      throwError(() => ({ error: { message: 'A pull is already running for this repository' } })),
    );

    component.pushMutation.mutate();
    await flush();
    fixture.detectChanges();

    expect(component.syncError()).toBe('A pull is already running for this repository');
    expect(fixture.nativeElement.textContent).toContain(
      'A pull is already running for this repository',
    );
    expect(dialog.create).not.toHaveBeenCalled();

    // The next successful mutation clears the banner.
    component.pushMutation.mutate();
    await flush();
    expect(component.syncError()).toBeNull();
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

  it('arms the sign-in offer on the remote-auth hint only, targeting the hinted repo', () => {
    const { component } = setup();
    component.onSegmentHint({ hint: 'some-other-hint', target: null });
    expect(component.remoteAuthHint()).toBe(false);
    // No target → the root repo.
    expect(component.remoteAuthRepoId()).toBe('repo-1');

    // A submodule child's failure targets the CHILD, not the root, so sign-in seeds its host.
    component.onSegmentHint({ hint: 'remote-auth', target: 'child-repo-7' });
    expect(component.remoteAuthHint()).toBe(true);
    expect(component.remoteAuthRepoId()).toBe('child-repo-7');
  });

  it('renders "Sign in & push" on the hint and swaps the dialog to the repo-scoped terminal', async () => {
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
    stubXtermBrowserApis();
    const { component, fixture, dialog } = setup();
    component.pushMutation.mutate();
    await flush();

    // The dialog service is stubbed, so render the template it was handed to see its content.
    const tpl = dialog.create.mock.calls[0][0].zContent as TemplateRef<unknown>;
    const embedded = tpl.createEmbeddedView({});
    embedded.detectChanges();
    const text = () =>
      embedded.rootNodes.map((n: Node) => (n.textContent ?? '') as string).join('');
    const buttons = () =>
      embedded.rootNodes.flatMap((n: Node) =>
        n instanceof HTMLElement ? Array.from(n.querySelectorAll('button')) : [],
      );
    expect(text()).not.toContain('Sign in & push');

    // A submodule child's push segment settled with the remote-auth hint → the offer appears and
    // the terminal targets the CHILD repo (not the root that hosts the dialog).
    component.onSegmentHint({ hint: 'remote-auth', target: 'child-repo-7' });
    fixture.detectChanges();
    embedded.detectChanges();
    const signIn = buttons().find((b) => b.textContent?.includes('Sign in & push'));
    expect(signIn).toBeDefined();

    // Clicking swaps the dialog content to the web terminal on the target-repo-scoped socket.
    signIn!.click();
    fixture.detectChanges();
    embedded.detectChanges();
    await flush();
    fixture.detectChanges();
    embedded.detectChanges();
    expect(component.showTerminal()).toBe(true);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.instances[0].url).toContain(
      'api/terminal/repositories/child-repo-7/remote-login',
    );
  });

  it('returns to the process view (retry still offered) when the sign-in terminal ends', () => {
    const { component, invalidateSpy } = setup();
    component.onSegmentHint({ hint: 'remote-auth', target: null });
    component.openSignInTerminal();
    expect(component.showTerminal()).toBe(true);

    component.onLoginTerminalClosed();

    // Back to the process view with the offer still armed, so a failed sign-in can be retried.
    expect(component.showTerminal()).toBe(false);
    expect(component.remoteAuthHint()).toBe(true);
    expect(invalidateSpy).toHaveBeenCalled();
  });

  it('clears the dialog ref on an ESC/backdrop dismissal so the live process can reattach', async () => {
    const { component, dialog } = setup();
    component.pullMutation.mutate();
    await flush();
    expect(component.processId()).toBe('proc-1');

    // A dismissal the component did not initiate (ESC / backdrop) routes through the ref's own
    // close(), which openDialog wrapped — so our cleanup still runs and activeDialogRef is cleared.
    const ref = dialog.create.mock.results[0].value as { close: () => void };
    ref.close();

    expect(component.processId()).toBeNull();
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
