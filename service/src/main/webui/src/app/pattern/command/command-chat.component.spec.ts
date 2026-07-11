import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { PromptContextStore } from '@/shared/state/prompt-context.store';
import { CommandChatComponent } from './command-chat.component';

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
