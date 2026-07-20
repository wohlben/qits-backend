import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { PromptDraftSyncService } from '@/pattern/workspace/prompt-draft-sync.service';
import { PromptContextStore } from '@/shared/state/prompt-context.store';
import { CommandChatComponent } from './command-chat.component';

/** A paste event carrying one image item, for the real imageBlobFromClipboard to pick up. */
function imagePasteEvent(): ClipboardEvent {
  const file = new File(['x'], 'p.png', { type: 'image/png' });
  return {
    clipboardData: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }] },
    preventDefault: vi.fn(),
  } as unknown as ClipboardEvent;
}

describe('CommandChatComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CommandChatComponent],
    }).compileComponents();
  });

  // The component is created without change detection so ngOnInit never opens a real WebSocket —
  // snippet insertion is pure draft/store logic.
  function createComponent() {
    const fixture = TestBed.createComponent(CommandChatComponent);
    fixture.componentRef.setInput('commandId', 'cmd-1');
    return fixture.componentInstance;
  }

  it('inserts a picked snippet into the draft as a fenced html block', () => {
    const store = TestBed.inject(PromptContextStore);
    const snippet = store.add({
      html: '<button class="cta">Go</button>',
      selector: '#root > button',
      url: 'http://localhost/daemon/wt/d/',
      tag: 'button',
      textPreview: 'Go',
    });
    const component = createComponent();
    component.draft.set('this one is misaligned:');

    component.insertSnippet(snippet);

    expect(component.draft()).toContain('this one is misaligned:');
    expect(component.draft()).toContain('Picked element <button>');
    expect(component.draft()).toContain('<button class="cta">Go</button>');
    store.clear();
  });

  it('inserting into an empty draft does not prepend a blank line', () => {
    const store = TestBed.inject(PromptContextStore);
    const snippet = store.add({
      html: '<div>x</div>',
      selector: 'div',
      url: 'http://localhost/daemon/wt/d/',
      tag: 'div',
      textPreview: 'x',
    });
    const component = createComponent();

    component.insertSnippet(snippet);

    expect(component.draft().startsWith('Picked element')).toBe(true);
    store.clear();
  });

  it('inserts a code reference into the draft as its one-line path:start-end form', () => {
    const store = TestBed.inject(PromptContextStore);
    store.addReference({ path: 'src/App.java', startLine: 3, endLine: 7 });
    const component = createComponent();

    component.insertReference(store.references()[0]);
    expect(component.draft()).toBe('src/App.java:3-7');

    // A second insert joins on a newline.
    component.insertReference({ path: 'src/App.java', startLine: 9, endLine: 9 });
    expect(component.draft()).toBe('src/App.java:3-7\nsrc/App.java:9');
    store.clear();
  });

  it('shows the Picked row with references only', () => {
    // Rendering runs ngOnInit's connect(); stub the socket so no real connection is attempted.
    vi.stubGlobal(
      'WebSocket',
      class {
        send = vi.fn();
        close = vi.fn();
      },
    );
    try {
      const store = TestBed.inject(PromptContextStore);
      store.addReference({ path: 'src/App.java', startLine: 3, endLine: 7 });
      const fixture = TestBed.createComponent(CommandChatComponent);
      fixture.componentRef.setInput('commandId', 'cmd-1');
      fixture.detectChanges();

      const text = (fixture.nativeElement as HTMLElement).textContent!;
      expect(text).toContain('Picked:');
      expect(text).toContain('src/App.java:3-7');
      fixture.destroy();
      store.clear();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('CommandChatComponent — image attachments', () => {
  // Present only where the chat has workspace context; enables attach + the taskPrompt nudge.
  const sync = {
    attachImage: vi.fn().mockResolvedValue(undefined),
    removeImage: vi.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    await TestBed.configureTestingModule({
      imports: [CommandChatComponent],
      providers: [{ provide: PromptDraftSyncService, useValue: sync }],
    }).compileComponents();
  });

  /** A minimal OPEN WebSocket stub that records every sent frame. */
  function stubOpenSocket(sent: string[]) {
    vi.stubGlobal(
      'WebSocket',
      class {
        static OPEN = 1;
        readyState = 1;
        onopen: (() => void) | null = null;
        onmessage: (() => void) | null = null;
        onclose: (() => void) | null = null;
        send = (frame: string) => sent.push(frame);
        close = vi.fn();
      },
    );
  }

  function createComponent() {
    const fixture = TestBed.createComponent(CommandChatComponent);
    fixture.componentRef.setInput('commandId', 'cmd-1');
    fixture.componentRef.setInput('repoId', 'repo-1');
    fixture.componentRef.setInput('workspaceId', 'ws-1');
    fixture.detectChanges(); // ngOnInit → connect() opens the stubbed socket
    return fixture;
  }

  it('appends a taskPrompt nudge to the sent turn when images are attached', () => {
    const sent: string[] = [];
    stubOpenSocket(sent);
    try {
      const store = TestBed.inject(PromptContextStore);
      store.setActiveWorkspace('ws-1');
      store.addImage({
        id: 'att-1',
        mimeType: 'image/png',
        label: 'Pasted image 1',
        source: 'paste',
        dataBase64: 'AAAB',
      });
      const fixture = createComponent();
      fixture.componentInstance.draft.set('look at this');

      fixture.componentInstance.onSubmit(new Event('submit'));

      expect(sent).toHaveLength(1);
      const payload = JSON.parse(sent[0]);
      expect(payload.type).toBe('user');
      expect(payload.text).toContain('look at this');
      expect(payload.text).toContain('call taskPrompt');
      fixture.destroy();
      store.clear();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('sends the message verbatim when no images are attached', () => {
    const sent: string[] = [];
    stubOpenSocket(sent);
    try {
      const store = TestBed.inject(PromptContextStore);
      store.setActiveWorkspace('ws-1');
      const fixture = createComponent();
      fixture.componentInstance.draft.set('just text');

      fixture.componentInstance.onSubmit(new Event('submit'));

      expect(JSON.parse(sent[0]).text).toBe('just text');
      fixture.destroy();
      store.clear();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('surfaces an error when a pasted image fails to attach', async () => {
    const sent: string[] = [];
    stubOpenSocket(sent);
    try {
      // blobToAttachment throws in jsdom (no canvas) — the same path a 413 reject would take.
      const store = TestBed.inject(PromptContextStore);
      store.setActiveWorkspace('ws-1');
      const fixture = createComponent();
      const event = imagePasteEvent();

      await fixture.componentInstance.onPaste(event);

      expect(event.preventDefault).toHaveBeenCalled();
      expect(fixture.componentInstance.attachError()).toBe(true);
      expect(sync.attachImage).not.toHaveBeenCalled();
      fixture.destroy();
      store.clear();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('renders a thumbnail row and removes it via the sync service', () => {
    const sent: string[] = [];
    stubOpenSocket(sent);
    try {
      const store = TestBed.inject(PromptContextStore);
      store.setActiveWorkspace('ws-1');
      store.addImage({
        id: 'att-1',
        mimeType: 'image/png',
        label: 'Pasted image 1',
        source: 'paste',
        dataBase64: 'AAAB',
      });
      const fixture = createComponent();

      const img = (fixture.nativeElement as HTMLElement).querySelector<HTMLImageElement>('img');
      expect(img?.getAttribute('src')).toBe('data:image/png;base64,AAAB');

      const remove = Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button'),
      ).find((b) => b.getAttribute('aria-label') === 'Remove image Pasted image 1');
      remove!.click();

      expect(sync.removeImage).toHaveBeenCalledWith('att-1');
      fixture.destroy();
      store.clear();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
