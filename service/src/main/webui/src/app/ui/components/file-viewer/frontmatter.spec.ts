import { parseFrontmatter } from './frontmatter';

describe('parseFrontmatter', () => {
  it('splits a leading YAML frontmatter block from the body', () => {
    const source = ['---', 'title: Hello', 'tags: [a, b]', '---', '', '# Body', 'text'].join('\n');

    expect(parseFrontmatter(source)).toEqual({
      frontmatter: 'title: Hello\ntags: [a, b]',
      body: ['# Body', 'text'].join('\n'),
    });
  });

  it('handles frontmatter with no blank line before the body', () => {
    const source = ['---', 'title: Hello', '---', '# Body'].join('\n');

    expect(parseFrontmatter(source)).toEqual({ frontmatter: 'title: Hello', body: '# Body' });
  });

  it('handles CRLF line endings', () => {
    const source = ['---', 'title: Hello', '---', '', '# Body'].join('\r\n');

    expect(parseFrontmatter(source)).toEqual({ frontmatter: 'title: Hello', body: '# Body' });
  });

  it('ignores a leading UTF-8 BOM before the fence', () => {
    const bom = String.fromCharCode(0xfeff);
    const source = bom + ['---', 'title: Hello', '---', '', '# Body'].join('\n');

    expect(parseFrontmatter(source)).toEqual({ frontmatter: 'title: Hello', body: '# Body' });
  });

  it('reports no frontmatter and returns the source unchanged when there is none', () => {
    const source = ['# Body', '', 'text'].join('\n');

    expect(parseFrontmatter(source)).toEqual({ frontmatter: null, body: source });
  });

  it('does not treat a leading horizontal rule as frontmatter (no closing fence)', () => {
    const source = ['---', '', '# After a rule', 'text'].join('\n');

    expect(parseFrontmatter(source)).toEqual({ frontmatter: null, body: source });
  });

  it('does not treat a fence that is not at the very start of the file as frontmatter', () => {
    const source = ['# Heading', '', '---', 'not: frontmatter', '---', '', 'body'].join('\n');

    expect(parseFrontmatter(source)).toEqual({ frontmatter: null, body: source });
  });

  it('treats empty frontmatter as an empty document body', () => {
    expect(parseFrontmatter(['---', 'title: X', '---'].join('\n'))).toEqual({
      frontmatter: 'title: X',
      body: '',
    });
  });
});
