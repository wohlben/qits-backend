import { resolveRelativeLink } from './resolve-relative-link';

describe('resolveRelativeLink', () => {
  it('resolves ./ against the current file’s directory', () => {
    expect(resolveRelativeLink('docs/guide/intro.md', './other.md')).toBe('docs/guide/other.md');
  });

  it('resolves ../ upwards', () => {
    expect(resolveRelativeLink('docs/guide/intro.md', '../src/foo.ts')).toBe('docs/src/foo.ts');
  });

  it('resolves a bare relative path', () => {
    expect(resolveRelativeLink('docs/intro.md', 'sub/file.md')).toBe('docs/sub/file.md');
  });

  it('normalizes ./ segments mid-path', () => {
    expect(resolveRelativeLink('docs/intro.md', './a/./b.md')).toBe('docs/a/b.md');
  });

  it('resolves from a file at the repo root', () => {
    expect(resolveRelativeLink('README.md', 'docs/x.md')).toBe('docs/x.md');
    expect(resolveRelativeLink('README.md', './CHANGELOG.md')).toBe('CHANGELOG.md');
  });

  it('treats a leading slash as repo-root-relative', () => {
    expect(resolveRelativeLink('docs/deep/file.md', '/root.md')).toBe('root.md');
  });

  it('returns null when the path escapes the repo root', () => {
    expect(resolveRelativeLink('docs/intro.md', '../../escape.md')).toBeNull();
    expect(resolveRelativeLink('README.md', '../up.md')).toBeNull();
  });

  it('returns null for anchor-only links', () => {
    expect(resolveRelativeLink('README.md', '#section')).toBeNull();
  });

  it('strips fragments and queries from file links', () => {
    expect(resolveRelativeLink('docs/intro.md', './other.md#part')).toBe('docs/other.md');
    expect(resolveRelativeLink('docs/intro.md', 'other.md?raw=1')).toBe('docs/other.md');
  });

  it('returns null for external and scheme links', () => {
    expect(resolveRelativeLink('README.md', 'https://example.com/x.md')).toBeNull();
    expect(resolveRelativeLink('README.md', 'http://example.com')).toBeNull();
    expect(resolveRelativeLink('README.md', '//cdn.example.com/x')).toBeNull();
    expect(resolveRelativeLink('README.md', 'mailto:a@b.c')).toBeNull();
  });

  it('decodes percent-encoded segments', () => {
    expect(resolveRelativeLink('docs/intro.md', './a%20b.md')).toBe('docs/a b.md');
  });

  it('returns null on malformed percent-encoding', () => {
    expect(resolveRelativeLink('docs/intro.md', './a%ZZ.md')).toBeNull();
  });

  it('collapses duplicate and trailing slashes', () => {
    expect(resolveRelativeLink('docs/intro.md', 'a//b.md')).toBe('docs/a/b.md');
    expect(resolveRelativeLink('docs/intro.md', 'a/b/')).toBe('docs/a/b');
  });
});
