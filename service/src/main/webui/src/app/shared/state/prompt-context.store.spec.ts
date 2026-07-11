import { TestBed } from '@angular/core/testing';

import { type CodeReference, mergeReference, PromptContextStore } from './prompt-context.store';
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

  it('adds references, keeping exact duplicates as one entry', () => {
    const s = store();
    s.addReference({ path: 'src/App.java', startLine: 3, endLine: 7 });
    s.addReference({ path: 'src/App.java', startLine: 3, endLine: 7 });
    expect(s.references()).toHaveLength(1);

    // A disjoint range on the same path is a separate reference.
    s.addReference({ path: 'src/App.java', startLine: 10, endLine: 10 });
    expect(s.references()).toHaveLength(2);
  });

  it('merges an added reference into overlapping same-path references', () => {
    const s = store();
    s.addReference({ path: 'src/App.java', startLine: 3, endLine: 7 });
    s.addReference({ path: 'src/App.java', startLine: 6, endLine: 9 });
    expect(s.references()).toEqual([{ path: 'src/App.java', startLine: 3, endLine: 9 }]);
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

describe('mergeReference', () => {
  const ref = (startLine: number, endLine: number, path = 'a.ts'): CodeReference => ({
    path,
    startLine,
    endLine,
  });

  it('appends a disjoint same-file range', () => {
    expect(mergeReference([ref(1, 2)], ref(10, 11))).toEqual([ref(1, 2), ref(10, 11)]);
  });

  it('merges an overlapping range into min-start/max-end', () => {
    expect(mergeReference([ref(3, 7)], ref(5, 12))).toEqual([ref(3, 12)]);
  });

  it('merges a touching range (adjacent lines)', () => {
    expect(mergeReference([ref(3, 7)], ref(8, 10))).toEqual([ref(3, 10)]);
  });

  it('keeps a containing reference unchanged when a subrange is added', () => {
    expect(mergeReference([ref(3, 10)], ref(5, 6))).toEqual([ref(3, 10)]);
  });

  it('bridges two existing references into one', () => {
    expect(mergeReference([ref(1, 3), ref(8, 10)], ref(4, 7))).toEqual([ref(1, 10)]);
  });

  it('never merges across files', () => {
    expect(mergeReference([ref(1, 5, 'a.ts')], ref(3, 7, 'b.ts'))).toEqual([
      ref(1, 5, 'a.ts'),
      ref(3, 7, 'b.ts'),
    ]);
  });

  it('places the merged reference at the first absorbed partner and preserves the rest', () => {
    const refs = [ref(1, 3, 'a.ts'), ref(1, 1, 'b.ts'), ref(8, 10, 'a.ts')];
    expect(mergeReference(refs, ref(2, 9, 'a.ts'))).toEqual([
      ref(1, 10, 'a.ts'),
      ref(1, 1, 'b.ts'),
    ]);
  });

  describe('excerpt stitching', () => {
    /** A ref whose excerpt is its line numbers rendered as `L<n>` — self-describing fixtures. */
    const exRef = (startLine: number, endLine: number, path = 'a.ts'): CodeReference => ({
      path,
      startLine,
      endLine,
      excerpt: Array.from({ length: endLine - startLine + 1 }, (_, i) => `L${startLine + i}`).join(
        '\n',
      ),
    });

    it('stitches an overlapping merge into one contiguous excerpt', () => {
      expect(mergeReference([exRef(3, 7)], exRef(5, 12))).toEqual([exRef(3, 12)]);
    });

    it('stitches a touching merge', () => {
      expect(mergeReference([exRef(3, 7)], exRef(8, 10))).toEqual([exRef(3, 10)]);
    });

    it('keeps the containing range’s excerpt but overwrites the contained lines with the fresh pick', () => {
      const stale = { ...exRef(3, 10), excerpt: 'old3\nold4\nold5\nold6\nold7\nold8\nold9\nold10' };
      expect(mergeReference([stale], exRef(5, 6))).toEqual([
        { path: 'a.ts', startLine: 3, endLine: 10, excerpt: 'old3\nold4\nL5\nL6\nold7\nold8\nold9\nold10' },
      ]);
    });

    it('stitches a bridge across two references', () => {
      expect(mergeReference([exRef(1, 3), exRef(8, 10)], exRef(4, 7))).toEqual([exRef(1, 10)]);
    });

    it('lets the incoming pick’s lines win over a stale overlapping excerpt', () => {
      const stale = { ...exRef(3, 7), excerpt: 'old3\nold4\nold5\nold6\nold7' };
      expect(mergeReference([stale], exRef(5, 9))).toEqual([
        { path: 'a.ts', startLine: 3, endLine: 9, excerpt: 'old3\nold4\nL5\nL6\nL7\nL8\nL9' },
      ]);
    });

    it('keeps disjoint references’ own excerpts untouched', () => {
      expect(mergeReference([exRef(1, 2)], exRef(10, 11))).toEqual([exRef(1, 2), exRef(10, 11)]);
    });

    it('drops the excerpt entirely when a merge partner carries none', () => {
      const bare = ref(3, 7); // no excerpt — its lines can't be reconstructed
      const merged = mergeReference([bare], exRef(5, 12));
      expect(merged).toEqual([{ path: 'a.ts', startLine: 3, endLine: 12 }]);
      expect('excerpt' in merged[0]).toBe(false);
    });

    it('preserves an empty-string excerpt (a picked blank line)', () => {
      const blank: CodeReference = { path: 'a.ts', startLine: 4, endLine: 4, excerpt: '' };
      expect(mergeReference([], blank)).toEqual([blank]);
      expect(mergeReference([blank], exRef(5, 6))).toEqual([
        { path: 'a.ts', startLine: 4, endLine: 6, excerpt: '\nL5\nL6' },
      ]);
    });
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

  it('never serializes the excerpt — it is a display-only preview', () => {
    const text = formatReferencesForPrompt([
      { path: 'a/B.java', startLine: 3, endLine: 4, excerpt: 'secret();\nmore();' },
    ]);

    expect(text).toBe('Selected code:\n- a/B.java:3-4');
  });
});
