import { buildSerializedPrompt, codeReferenceLabel } from './snippet-format';

/**
 * The single source of truth for prompt serialization: the draft autosave persists its output as
 * `serialized_prompt`, which the `taskPrompt` MCP tool serves verbatim to the agent. These assert
 * the block ordering and trimming so the persisted prompt is well-formed (no leading blank line).
 */
describe('buildSerializedPrompt', () => {
  const snippet = {
    id: 's1',
    html: '<button class="cta">Go</button>',
    selector: '#root > button',
    url: 'http://localhost/daemon/wt/d/',
    tag: 'button',
    textPreview: 'Go',
    capturedAt: 0,
  };

  it('is just the trimmed prompt text when nothing is attached', () => {
    expect(buildSerializedPrompt('  do the thing  ', [], [])).toBe('do the thing');
  });

  it('appends the picked-element block after the prompt text', () => {
    const out = buildSerializedPrompt('fix this button', [snippet], []);
    expect(out).toContain('fix this button');
    expect(out).toContain('Picked element <button>');
    expect(out).toContain('<button class="cta">Go</button>');
    expect(out.indexOf('fix this button')).toBeLessThan(out.indexOf('Picked element'));
  });

  it('appends the references block after the snippets block', () => {
    const out = buildSerializedPrompt(
      'fix this',
      [snippet],
      [{ path: 'src/App.java', startLine: 10, endLine: 12 }],
    );
    expect(out).toContain('Selected code:\n- src/App.java:10-12');
    expect(out.indexOf('Picked element')).toBeLessThan(out.indexOf('Selected code:'));
  });

  it('appends the references block even when no elements are picked', () => {
    expect(
      buildSerializedPrompt('fix this', [], [{ path: 'src/App.java', startLine: 7, endLine: 7 }]),
    ).toBe('fix this\n\nSelected code:\n- src/App.java:7');
  });

  it('renders only the path:lines label for a reference, never its excerpt', () => {
    const out = buildSerializedPrompt(
      'fix this',
      [],
      [{ path: 'src/App.java', startLine: 10, endLine: 12, excerpt: 'int secret = 42;' }],
    );
    expect(out).toBe('fix this\n\nSelected code:\n- src/App.java:10-12');
    expect(out).not.toContain('int secret = 42;');
  });

  it('does not prefix a picks-only draft with blank lines', () => {
    // A leading empty line would be a malformed first line for the taskPrompt text block.
    const out = buildSerializedPrompt('', [], [{ path: 'a.ts', startLine: 1, endLine: 2 }]);
    expect(out.startsWith('Selected code:')).toBe(true);
  });
});

describe('codeReferenceLabel', () => {
  it('renders a single line without a range', () => {
    expect(codeReferenceLabel({ path: 'a.ts', startLine: 5, endLine: 5 })).toBe('a.ts:5');
  });

  it('renders a range for multi-line selections', () => {
    expect(codeReferenceLabel({ path: 'a.ts', startLine: 5, endLine: 9 })).toBe('a.ts:5-9');
  });
});
