import { findRenderer, SMART_RENDERERS } from './renderers';

describe('smart renderer registry', () => {
  it('matches markdown extensions case-insensitively', () => {
    expect(findRenderer('README.md')?.id).toBe('markdown');
    expect(findRenderer('docs/NOTES.MD')?.id).toBe('markdown');
    expect(findRenderer('a/b/page.markdown')?.id).toBe('markdown');
  });

  it('does not match non-markdown paths', () => {
    expect(findRenderer('main.ts')).toBeUndefined();
    expect(findRenderer('page.mdx')).toBeUndefined();
    expect(findRenderer('md')).toBeUndefined();
    expect(findRenderer('notes.md.bak')).toBeUndefined();
  });

  it('returns the first matching registry entry (priority order)', () => {
    expect(findRenderer('README.md')).toBe(SMART_RENDERERS[0]);
  });
});
