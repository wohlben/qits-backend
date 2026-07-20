import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { AgentControllerService } from '@/api/api/agentController.service';
import { PromptRefinementControllerService } from '@/api/api/promptRefinementController.service';
import { SpeechControllerService } from '@/api/api/speechController.service';
import { AgentLaunchMode } from '@/api/model/agentLaunchMode';
import { AgentMcpScope } from '@/api/model/agentMcpScope';
import { PromptDraftSyncService } from '@/pattern/workspace/prompt-draft-sync.service';
import { PromptContextStore } from '@/shared/state/prompt-context.store';
import { SpeakToPromptComponent } from './speak-to-prompt.component';

/** A paste event carrying one image item, for the real imageBlobFromClipboard to pick up. */
function imagePasteEvent(): ClipboardEvent {
  const file = new File(['x'], 'p.png', { type: 'image/png' });
  return {
    clipboardData: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }] },
    preventDefault: vi.fn(),
  } as unknown as ClipboardEvent;
}

describe('SpeakToPromptComponent', () => {
  const speechService = {
    apiSpeechTranscriptionsPost: vi.fn().mockReturnValue(of({ text: 'spoken words' })),
  };
  const refinementService = {
    apiRepositoriesRepoIdWorkspacesWorkspaceIdPromptRefinementsPost: vi
      .fn()
      .mockReturnValue(of({ prompt: 'refined prompt' })),
  };
  const agentService = {
    apiRepositoriesRepoIdWorkspacesWorkspaceIdAgentsPost: vi
      .fn()
      .mockReturnValue(of({ command: { id: 'cmd-1' } })),
  };
  // The launch flushes the draft first (the agent fetches it via taskPrompt); a mock that resolves.
  // Image attach/remove and Discard's row cleanup delegate to the same service.
  const promptDraftSync = {
    flushNow: vi.fn().mockResolvedValue(undefined),
    attachImage: vi.fn().mockResolvedValue(undefined),
    removeImage: vi.fn().mockResolvedValue(undefined),
    clearAttachments: vi.fn().mockResolvedValue(undefined),
  };
  // The template's RouterLinks need a real router (a bare `{ navigate }` mock can't satisfy
  // them); the launch-navigation assertions spy on the real instance instead.
  let router: Router;

  beforeEach(async () => {
    vi.clearAllMocks();
    await TestBed.configureTestingModule({
      imports: [SpeakToPromptComponent],
      providers: [
        provideRouter([]),
        provideTanStackQuery(new QueryClient()),
        { provide: SpeechControllerService, useValue: speechService },
        { provide: PromptRefinementControllerService, useValue: refinementService },
        { provide: AgentControllerService, useValue: agentService },
        { provide: PromptDraftSyncService, useValue: promptDraftSync },
      ],
    }).compileComponents();
    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
  });

  function createComponent() {
    const fixture = TestBed.createComponent(SpeakToPromptComponent);
    fixture.componentRef.setInput('repoId', 'repo-1');
    fixture.componentRef.setInput('workspaceId', 'wt-1');
    fixture.detectChanges();
    return fixture;
  }

  it('refines the edited transcript and shows the result for editing', async () => {
    const fixture = createComponent();
    fixture.componentInstance.transcript.set('umm add a healthcheck');
    fixture.componentInstance.refineMutation.mutate('umm add a healthcheck');
    await fixture.whenStable();

    expect(
      refinementService.apiRepositoriesRepoIdWorkspacesWorkspaceIdPromptRefinementsPost,
    ).toHaveBeenCalledWith('repo-1', 'wt-1', { transcript: 'umm add a healthcheck' });
    // The refined prompt lands in the store (persisted per workspace), not component-local state.
    expect(TestBed.inject(PromptContextStore).promptText()).toBe('refined prompt');
    expect(fixture.componentInstance.launchSectionVisible()).toBe(true);
  });

  it('flushes the draft then launches a fetch-model chat and opens its command', async () => {
    const fixture = createComponent();
    TestBed.inject(PromptContextStore).setPromptText('do the thing');
    fixture.componentInstance.launch(AgentLaunchMode.Chat);
    await fixture.whenStable();

    // The composed prompt is persisted first (the agent fetches it via taskPrompt), so the launch
    // carries no initialContext — only the deliver flag and mode.
    expect(promptDraftSync.flushNow).toHaveBeenCalled();
    expect(agentService.apiRepositoriesRepoIdWorkspacesWorkspaceIdAgentsPost).toHaveBeenCalledWith(
      'repo-1',
      'wt-1',
      { scope: AgentMcpScope.Repository, mode: AgentLaunchMode.Chat, deliverTaskPrompt: true },
    );
    expect(router.navigate).toHaveBeenCalledWith(['/commands', 'cmd-1']);
  });

  it('aborts the launch and flags the failure when the pre-launch draft flush fails', async () => {
    // A failed flush means the agent would fetch a stale/absent prompt — abort rather than proceed.
    promptDraftSync.flushNow.mockRejectedValueOnce(new Error('save failed'));
    const fixture = createComponent();
    TestBed.inject(PromptContextStore).setPromptText('do the thing');
    await fixture.componentInstance.launch(AgentLaunchMode.Chat);
    await fixture.whenStable();

    expect(agentService.apiRepositoriesRepoIdWorkspacesWorkspaceIdAgentsPost).not.toHaveBeenCalled();
    expect(fixture.componentInstance.saveFailed()).toBe(true);
  });

  it('launches the interactive terminal session in the fetch model', async () => {
    const fixture = createComponent();
    TestBed.inject(PromptContextStore).setPromptText('do the thing');
    fixture.componentInstance.launch(AgentLaunchMode.Interactive);
    await fixture.whenStable();

    expect(promptDraftSync.flushNow).toHaveBeenCalled();
    expect(agentService.apiRepositoriesRepoIdWorkspacesWorkspaceIdAgentsPost).toHaveBeenCalledWith(
      'repo-1',
      'wt-1',
      {
        scope: AgentMcpScope.Repository,
        mode: AgentLaunchMode.Interactive,
        deliverTaskPrompt: true,
      },
    );
  });

  it('emits the launched command id alongside navigating by default', async () => {
    const fixture = createComponent();
    let launchedId: string | undefined;
    fixture.componentInstance.launched.subscribe((id) => (launchedId = id));
    TestBed.inject(PromptContextStore).setPromptText('do the thing');
    fixture.componentInstance.launch(AgentLaunchMode.Chat);
    await fixture.whenStable();

    expect(launchedId).toBe('cmd-1');
    expect(router.navigate).toHaveBeenCalledWith(['/commands', 'cmd-1']);
  });

  it('only emits, without navigating, when navigateOnLaunch is off', async () => {
    const fixture = createComponent();
    fixture.componentRef.setInput('navigateOnLaunch', false);
    let launchedId: string | undefined;
    fixture.componentInstance.launched.subscribe((id) => (launchedId = id));
    TestBed.inject(PromptContextStore).setPromptText('do the thing');
    fixture.componentInstance.launch(AgentLaunchMode.Chat);
    await fixture.whenStable();

    expect(launchedId).toBe('cmd-1');
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('carries no initialContext even with picked snippets — the draft is fetched instead', async () => {
    // Picked elements/references ride the persisted draft now (serialized into serialized_prompt by
    // the draft-sync service, tested there), not the launch payload — so the launch stays
    // prompt-free and just flushes then sets the deliver flag.
    const store = TestBed.inject(PromptContextStore);
    store.add({
      html: '<button class="cta">Go</button>',
      selector: '#root > button',
      url: 'http://localhost/daemon/wt/d/',
      tag: 'button',
      textPreview: 'Go',
    });
    const fixture = createComponent();
    TestBed.inject(PromptContextStore).setPromptText('fix this button');
    fixture.componentInstance.launch(AgentLaunchMode.Chat);
    await fixture.whenStable();

    expect(promptDraftSync.flushNow).toHaveBeenCalled();
    const [, , body] =
      agentService.apiRepositoriesRepoIdWorkspacesWorkspaceIdAgentsPost.mock.calls[0];
    expect(body.initialContext).toBeUndefined();
    expect(body.deliverTaskPrompt).toBe(true);
    store.clear();
  });

  it('shows the full pick context on a picked-element row: component, route, files, chain', () => {
    const store = TestBed.inject(PromptContextStore);
    store.add({
      html: '<button class="cta">Go</button>',
      selector: '#root > button',
      url: 'http://localhost/daemon/wt/d/greeting/world',
      appPath: '/greeting/world',
      tag: 'button',
      textPreview: 'Go',
      component: {
        selector: 'app-greeting',
        className: 'Greeting',
        files: ['src/app/greeting.ts'],
        ancestors: ['app-root'],
      },
    });
    const fixture = createComponent();

    const text = (fixture.nativeElement as HTMLElement).textContent!;
    expect(text).toContain('Greeting (app-greeting)');
    expect(text).toContain('/greeting/world');
    expect(text).toContain('src/app/greeting.ts');
    expect(text).toContain('in app-root');
    store.clear();
  });

  it('links each attributed file into the workspace Files tab with a ?path= deep link', () => {
    const store = TestBed.inject(PromptContextStore);
    store.add({
      html: '<button class="cta">Go</button>',
      selector: '#root > button',
      url: 'http://localhost/daemon/wt/d/greeting/world',
      appPath: '/greeting/world',
      tag: 'button',
      textPreview: 'Go',
      component: {
        selector: 'app-greeting',
        className: 'Greeting',
        files: ['src/app/greeting.ts', 'src/app/greeting.html'],
      },
    });
    const fixture = createComponent();

    const links = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLAnchorElement>('a[href]'),
    );
    const expectedHref = (file: string) =>
      router.serializeUrl(
        router.createUrlTree(['/repositories', 'repo-1', 'workspaces', 'wt-1', 'files'], {
          queryParams: { path: file },
        }),
      );
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      expectedHref('src/app/greeting.ts'),
      expectedHref('src/app/greeting.html'),
    ]);
    expect(links.map((a) => a.textContent?.trim())).toEqual([
      'src/app/greeting.ts,',
      'src/app/greeting.html',
    ]);
    store.clear();
  });

  it('renders a plain row without an attribution line for an unattributed pick', () => {
    const store = TestBed.inject(PromptContextStore);
    store.add({
      html: '<div>x</div>',
      selector: 'div',
      url: 'http://localhost/elsewhere',
      tag: 'div',
      textPreview: 'x',
    });
    const fixture = createComponent();

    const text = (fixture.nativeElement as HTMLElement).textContent!;
    expect(text).toContain('Picked elements');
    expect(text).not.toContain('in app-root');
    expect(text).not.toContain('src/app/');
    store.clear();
  });

  it('renders a Selected code row that deep-links to the file at its lines', () => {
    const store = TestBed.inject(PromptContextStore);
    store.addReference({ path: 'src/App.java', startLine: 10, endLine: 12 });
    const fixture = createComponent();

    const text = (fixture.nativeElement as HTMLElement).textContent!;
    expect(text).toContain('Selected code (attached to the prompt)');
    expect(text).toContain('src/App.java:10-12');

    const link = (fixture.nativeElement as HTMLElement).querySelector<HTMLAnchorElement>('a[href]');
    expect(link?.getAttribute('href')).toBe(
      router.serializeUrl(
        router.createUrlTree(['/repositories', 'repo-1', 'workspaces', 'wt-1', 'files'], {
          queryParams: { path: 'src/App.java', lines: '10-12' },
        }),
      ),
    );
    store.clear();
  });

  it('renders the excerpt beneath a reference row, and no block when the ref has none', () => {
    const store = TestBed.inject(PromptContextStore);
    store.addReference({
      path: 'src/App.java',
      startLine: 10,
      endLine: 11,
      excerpt: 'int x = 1;\nint y = 2;',
    });
    store.addReference({ path: 'src/Other.java', startLine: 3, endLine: 3 });
    const fixture = createComponent();

    const pres = (fixture.nativeElement as HTMLElement).querySelectorAll('pre');
    expect(pres).toHaveLength(1); // only the excerpt-carrying ref renders a block
    expect(pres[0].textContent).toBe('int x = 1;\nint y = 2;');
    store.clear();
  });

  it('removes a reference row via its Remove button', () => {
    const store = TestBed.inject(PromptContextStore);
    store.addReference({ path: 'src/App.java', startLine: 3, endLine: 3 });
    const fixture = createComponent();

    const remove = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button'),
    ).find((b) => b.getAttribute('aria-label') === 'Remove reference src/App.java:3');
    expect(remove).toBeDefined();
    remove!.click();
    fixture.detectChanges();

    expect(store.references()).toEqual([]);
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('Selected code');
  });

  // The launch-context serialization (prompt text + picked-element block + selected-code block, and
  // their ordering) now lives in buildSerializedPrompt and is persisted as the draft's
  // serialized_prompt — covered by snippet-format.spec.ts, not through the launch payload here.

  it('renders an attached image row with a thumbnail and removes it via the sync service', () => {
    const store = TestBed.inject(PromptContextStore);
    store.setActiveWorkspace('wt-1');
    store.addImage({
      id: 'att-1',
      mimeType: 'image/png',
      label: 'Pasted image 1',
      source: 'paste',
      dataBase64: 'AAAB',
    });
    const fixture = createComponent();

    const html = fixture.nativeElement as HTMLElement;
    expect(html.textContent).toContain('Images (attached to the prompt)');
    expect(html.textContent).toContain('Pasted image 1');
    const img = html.querySelector<HTMLImageElement>('img');
    expect(img?.getAttribute('src')).toBe('data:image/png;base64,AAAB');

    const remove = Array.from(html.querySelectorAll<HTMLButtonElement>('button')).find(
      (b) => b.getAttribute('aria-label') === 'Remove image Pasted image 1',
    );
    expect(remove).toBeDefined();
    remove!.click();

    expect(promptDraftSync.removeImage).toHaveBeenCalledWith('att-1');
    store.clear();
  });

  it('shows the launch section for an images-only draft (no prompt text yet)', () => {
    const store = TestBed.inject(PromptContextStore);
    store.setActiveWorkspace('wt-1');
    store.addImage({
      id: 'att-1',
      mimeType: 'image/png',
      label: 'Pasted image 1',
      source: 'paste',
      dataBase64: 'AAAB',
    });
    const fixture = createComponent();

    // isEmpty counts images, so the textarea + Launch buttons appear even without typed text.
    expect(fixture.componentInstance.launchSectionVisible()).toBe(true);
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('textarea[rows="10"]'),
    ).not.toBeNull();
    store.clear();
  });

  it('surfaces an error when a pasted image fails to attach (encode fails)', async () => {
    // blobToAttachment relies on the DOM canvas (unavailable in jsdom), so it throws here — the same
    // path an oversize 413 would take. The error must surface, not be swallowed.
    const fixture = createComponent();
    const event = imagePasteEvent();

    await fixture.componentInstance.onPaste(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(fixture.componentInstance.attachError()).toBe(true);
    expect(promptDraftSync.attachImage).not.toHaveBeenCalled();
  });

  it('Discard deletes the attachment rows and clears the store', () => {
    const store = restoreDraft('earlier idea');
    store.addImage({
      id: 'att-1',
      mimeType: 'image/png',
      label: 'Pasted image 1',
      source: 'paste',
      dataBase64: 'AAAB',
    });
    const fixture = createComponent();

    const discard = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button'),
    ).find((b) => b.textContent?.trim() === 'Discard');
    discard!.click();

    expect(promptDraftSync.clearAttachments).toHaveBeenCalled();
    expect(store.images()).toEqual([]);
    expect(store.promptText()).toBe('');
    store.clear();
  });

  it('uploads the recording and appends the server transcript', async () => {
    const fixture = createComponent();
    fixture.componentInstance.transcript.set('earlier text');
    fixture.componentInstance.transcribeMutation.mutate('QkFTRTY0');
    await fixture.whenStable();

    expect(speechService.apiSpeechTranscriptionsPost).toHaveBeenCalledWith({
      audioBase64: 'QkFTRTY0',
    });
    expect(fixture.componentInstance.transcript()).toBe('earlier text spoken words');
  });

  /** Seed the store as if the sync service had hydrated a persisted draft for this workspace. */
  function restoreDraft(promptText: string) {
    const store = TestBed.inject(PromptContextStore);
    store.setActiveWorkspace('wt-1');
    store.hydrateFromContent(
      'wt-1',
      JSON.stringify({ v: 1, promptText, snippets: [], references: [] }),
      '2020-01-01T00:00:00Z',
    );
    return store;
  }

  it('shows a restore hint for a restored non-empty draft, editable and discardable', () => {
    const store = restoreDraft('earlier idea');
    const fixture = createComponent();

    const html = () => fixture.nativeElement as HTMLElement;
    expect(html().textContent).toContain('Restored draft');
    expect(fixture.componentInstance.launchSectionVisible()).toBe(true);
    expect(store.promptText()).toBe('earlier idea'); // shown in the editable textarea

    const discard = Array.from(html().querySelectorAll<HTMLButtonElement>('button')).find(
      (b) => b.textContent?.trim() === 'Discard',
    );
    expect(discard).toBeDefined();
    discard!.click();
    fixture.detectChanges();

    expect(store.justRestored()).toBe(false);
    expect(store.promptText()).toBe('');
    expect(html().textContent).not.toContain('Restored draft');
    store.clear();
  });

  it('reveals the launch section for a restored picks-only draft (no typed prompt yet)', () => {
    const store = TestBed.inject(PromptContextStore);
    store.setActiveWorkspace('wt-1');
    // A draft with a picked element but no prompt text — restored from the backend.
    store.hydrateFromContent(
      'wt-1',
      JSON.stringify({
        v: 1,
        promptText: '',
        snippets: [
          {
            id: 's1',
            html: '<button>Go</button>',
            selector: '#root > button',
            url: 'http://localhost/daemon/wt/d/',
            tag: 'button',
            textPreview: 'Go',
            capturedAt: 0,
          },
        ],
        references: [],
      }),
      't1',
    );
    const fixture = createComponent();

    // The textarea + Launch buttons must be reachable so the user can add a prompt and act on it.
    expect(fixture.componentInstance.launchSectionVisible()).toBe(true);
    expect((fixture.nativeElement as HTMLElement).querySelector('textarea[rows="10"]')).not.toBeNull();
    store.clear();
  });

  it('dismisses the restore hint on the first edit', () => {
    const store = restoreDraft('earlier idea');
    const fixture = createComponent();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Restored draft');

    store.setPromptText('earlier idea, edited');
    fixture.detectChanges();

    expect(store.justRestored()).toBe(false);
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('Restored draft');
    store.clear();
  });
});
