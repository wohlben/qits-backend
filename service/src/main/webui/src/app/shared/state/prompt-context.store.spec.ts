import { TestBed } from '@angular/core/testing';

import { PromptContextStore } from './prompt-context.store';
import { formatSnippetsForPrompt } from './snippet-format';

const pick = (overrides: Partial<Parameters<typeof formatSnippetsForPrompt>[0][number]> = {}) => ({
  html: '<button class="cta">Go</button>',
  selector: '#root > button:nth-of-type(1)',
  url: 'http://localhost:8080/daemon/wt/d/',
  tag: 'button',
  textPreview: 'Go',
  ...overrides,
});

describe('PromptContextStore', () => {
  function store() {
    return TestBed.inject(PromptContextStore);
  }

  it('adds snippets with generated ids and exposes the count', () => {
    const s = store();
    expect(s.count()).toBe(0);

    const a = s.add(pick());
    const b = s.add(pick({ tag: 'div', textPreview: 'Hello' }));

    expect(s.count()).toBe(2);
    expect(a.id).not.toBe(b.id);
    expect(s.snippets()[0].html).toContain('cta');
    expect(s.snippets()[1].tag).toBe('div');
  });

  it('removes by id and clears', () => {
    const s = store();
    const a = s.add(pick());
    s.add(pick({ tag: 'div' }));

    s.remove(a.id);
    expect(s.count()).toBe(1);
    expect(s.snippets()[0].tag).toBe('div');

    s.clear();
    expect(s.count()).toBe(0);
  });
});

describe('formatSnippetsForPrompt', () => {
  it('renders a fenced html block per snippet with selector and url', () => {
    const text = formatSnippetsForPrompt([
      { ...pick(), id: '1', capturedAt: 0 },
      { ...pick({ tag: 'div', html: '<div>x</div>' }), id: '2', capturedAt: 0 },
    ]);

    expect(text).toContain('Picked element <button>');
    expect(text).toContain('selector: #root > button:nth-of-type(1)');
    expect(text).toContain('http://localhost:8080/daemon/wt/d/');
    expect(text).toContain('```html\n<button class="cta">Go</button>\n```');
    expect(text).toContain('<div>x</div>');
  });

  it('includes the open shadow root content when captured', () => {
    const text = formatSnippetsForPrompt([
      { ...pick({ shadowHtml: '<span>inside</span>' }), id: '1', capturedAt: 0 },
    ]);

    expect(text).toContain('open shadow root');
    expect(text).toContain('<span>inside</span>');
  });
});
