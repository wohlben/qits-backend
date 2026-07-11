import { TestBed } from '@angular/core/testing';

import { PromptContextStore } from './prompt-context.store';
import { formatReferencesForPrompt, formatSnippetsForPrompt } from './snippet-format';

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
    const b = s.add(
      pick({ tag: 'div', textPreview: 'Hello', selector: '#root > div:nth-of-type(1)' }),
    );

    expect(s.count()).toBe(2);
    expect(a.id).not.toBe(b.id);
    expect(s.snippets()[0].html).toContain('cta');
    expect(s.snippets()[1].tag).toBe('div');
  });

  it('does not add the same element twice — a re-pick returns the existing snippet', () => {
    const s = store();
    const first = s.add(pick());
    const rePick = s.add(pick({ html: '<button class="cta">Go!</button>' }));

    expect(s.count()).toBe(1);
    expect(rePick.id).toBe(first.id);

    // Same selector on a different document is a different element.
    s.add(pick({ url: 'http://localhost:8080/daemon/wt/d/other' }));
    expect(s.count()).toBe(2);
  });

  it('toggle adds a new element and unpicks an already picked one', () => {
    const s = store();
    const other = s.add(pick({ selector: '#root > div:nth-of-type(1)' }));

    const added = s.toggle(pick());
    expect(added).not.toBeNull();
    expect(s.count()).toBe(2);

    // Same element again — even with re-rendered html — removes it; others stay.
    const removed = s.toggle(pick({ html: '<button class="cta">Go!</button>' }));
    expect(removed).toBeNull();
    expect(s.count()).toBe(1);
    expect(s.snippets()[0].id).toBe(other.id);
  });

  it('removes by id and clears', () => {
    const s = store();
    const a = s.add(pick());
    s.add(pick({ tag: 'div', selector: '#root > div:nth-of-type(1)' }));

    s.remove(a.id);
    expect(s.count()).toBe(1);
    expect(s.snippets()[0].tag).toBe('div');

    s.clear();
    expect(s.count()).toBe(0);
  });

  it('adds references and drops exact (path, startLine, endLine) duplicates', () => {
    const s = store();
    s.addReference({ path: 'src/App.java', startLine: 3, endLine: 7 });
    s.addReference({ path: 'src/App.java', startLine: 3, endLine: 7 });
    expect(s.references()).toHaveLength(1);

    // A different range on the same path is a different reference.
    s.addReference({ path: 'src/App.java', startLine: 10, endLine: 10 });
    expect(s.references()).toHaveLength(2);
  });

  it('removes a reference by value, not object identity', () => {
    const s = store();
    s.addReference({ path: 'src/App.java', startLine: 3, endLine: 7 });
    s.addReference({ path: 'src/Other.java', startLine: 1, endLine: 2 });

    s.removeReference({ path: 'src/App.java', startLine: 3, endLine: 7 });
    expect(s.references()).toEqual([{ path: 'src/Other.java', startLine: 1, endLine: 2 }]);
  });

  it('keeps count() snippets-only and clear() empties both slices', () => {
    const s = store();
    s.add(pick());
    s.addReference({ path: 'src/App.java', startLine: 3, endLine: 7 });
    expect(s.count()).toBe(1); // count labels the picker toolbar — references don't inflate it

    s.clear();
    expect(s.snippets()).toHaveLength(0);
    expect(s.references()).toHaveLength(0);
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

  it('includes the style-frozen variant as an optional block after the original', () => {
    const withStyled = formatSnippetsForPrompt([
      {
        ...pick({ styledHtml: '<button class="cta" style="color: rgb(255, 0, 0)">Go</button>' }),
        id: '1',
        capturedAt: 0,
      },
    ]);
    expect(withStyled).toContain('Optional style-frozen variant');
    expect(withStyled).toContain('<button class="cta" style="color: rgb(255, 0, 0)">Go</button>');
    // The original, rule-free capture always comes first.
    expect(withStyled.indexOf('<button class="cta">Go</button>')).toBeLessThan(
      withStyled.indexOf('Optional style-frozen variant'),
    );

    const withoutStyled = formatSnippetsForPrompt([{ ...pick(), id: '1', capturedAt: 0 }]);
    expect(withoutStyled).not.toContain('Optional style-frozen variant');
  });

  it('includes the open shadow root content when captured', () => {
    const text = formatSnippetsForPrompt([
      { ...pick({ shadowHtml: '<span>inside</span>' }), id: '1', capturedAt: 0 },
    ]);

    expect(text).toContain('open shadow root');
    expect(text).toContain('<span>inside</span>');
  });

  it('renders the component attribution and app route as paths-only header lines', () => {
    const text = formatSnippetsForPrompt([
      {
        ...pick({
          appPath: '/greeting/world',
          component: {
            selector: 'app-greeting',
            className: 'Greeting',
            files: ['src/app/greeting.ts', 'src/app/greeting.html'],
            ancestors: ['app-root'],
          },
        }),
        id: '1',
        capturedAt: 0,
      },
    ]);

    expect(text).toContain('App route: /greeting/world');
    expect(text).toContain(
      'Rendered by Greeting (app-greeting) — source files: src/app/greeting.ts, src/app/greeting.html',
    );
    expect(text).toContain('Enclosing components: app-root');
    // attribution precedes the HTML block: it is header context, not part of the fragment
    expect(text.indexOf('Rendered by')).toBeLessThan(text.indexOf('```html'));
  });

  it('renders without attribution exactly as before when the pick carries none', () => {
    const text = formatSnippetsForPrompt([{ ...pick(), id: '1', capturedAt: 0 }]);

    expect(text).not.toContain('App route:');
    expect(text).not.toContain('Rendered by');
    expect(text).not.toContain('Enclosing components:');
    expect(text).toBe(
      'Picked element <button> (selector: #root > button:nth-of-type(1)) on http://localhost:8080/daemon/wt/d/:\n' +
        '```html\n<button class="cta">Go</button>\n```',
    );
  });
});

describe('formatReferencesForPrompt', () => {
  it('renders a bullet per reference, collapsing single-line ranges to path:line', () => {
    const text = formatReferencesForPrompt([
      { path: 'a/B.java', startLine: 3, endLine: 9 },
      { path: 'a/B.java', startLine: 12, endLine: 12 },
    ]);

    expect(text).toBe('Selected code:\n- a/B.java:3-9\n- a/B.java:12');
  });
});
