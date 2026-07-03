import { applyPathFilters } from './filter-file-paths';
import { ignorelistToRules } from './ignorelist-rules';

/** Convenience: the (mode, query) shape of the generated rules, ignoring ids. */
function shape(dir: string, content: string) {
  return ignorelistToRules(dir, content).map((r) => ({ kind: r.kind, mode: r.mode, query: r.query }));
}

describe('ignorelistToRules — translation table', () => {
  it('plain name → matches the basename anywhere below the ignore file dir', () => {
    expect(shape('somepath/abc', 'somefile')).toEqual([
      { kind: 'glob', mode: 'blacklist', query: 'somepath/abc/**/somefile' },
    ]);
  });

  it('plain name at repo root → **/name', () => {
    expect(shape('', 'node_modules')).toEqual([
      { kind: 'glob', mode: 'blacklist', query: '**/node_modules' },
    ]);
  });

  it('anchored pattern (leading slash) → anchored to the dir, slash stripped', () => {
    expect(shape('', '/build')).toEqual([{ kind: 'glob', mode: 'blacklist', query: 'build' }]);
    expect(shape('pkg', '/build')).toEqual([{ kind: 'glob', mode: 'blacklist', query: 'pkg/build' }]);
  });

  it('anchored pattern (inner slash) → relative to the dir', () => {
    expect(shape('', 'src/gen')).toEqual([{ kind: 'glob', mode: 'blacklist', query: 'src/gen' }]);
  });

  it('trailing slash → directory-only (everything under it)', () => {
    expect(shape('', 'dist/')).toEqual([{ kind: 'glob', mode: 'blacklist', query: '**/dist/**' }]);
    expect(shape('', '/dist/')).toEqual([{ kind: 'glob', mode: 'blacklist', query: 'dist/**' }]);
  });

  it('negation (!) → whitelist rule, order preserved', () => {
    expect(shape('', '*.log\n!keep.log')).toEqual([
      { kind: 'glob', mode: 'blacklist', query: '**/*.log' },
      { kind: 'glob', mode: 'whitelist', query: '**/keep.log' },
    ]);
  });

  it('skips comments and blank lines', () => {
    expect(shape('', '# a comment\n\n   \nfoo')).toEqual([
      { kind: 'glob', mode: 'blacklist', query: '**/foo' },
    ]);
  });

  it('handles escaped leading # / ! as literals', () => {
    expect(shape('', '\\#literal')).toEqual([
      { kind: 'glob', mode: 'blacklist', query: '**/#literal' },
    ]);
    expect(shape('', '\\!literal')).toEqual([
      { kind: 'glob', mode: 'blacklist', query: '**/!literal' },
    ]);
  });
});

describe('ignorelistToRules — locality', () => {
  it('hides matches below the ignore file dir, not elsewhere', () => {
    const rules = ignorelistToRules('somepath/abc', 'somefile');
    const paths = [
      'somepath/abc/somefile',
      'somepath/abc/x/somefile',
      'someotherpath/somefile',
    ];
    // last-match-wins with a blacklist-only list ⇒ default visible, matches hidden
    expect(applyPathFilters(paths, rules)).toEqual(['someotherpath/somefile']);
  });
});
