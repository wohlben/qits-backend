import {
  applyPathFilters,
  closestPath,
  filterFilePaths,
  fuzzyMatch,
  gitignoreGlobToRegExp,
  type PathFilter,
} from './filter-file-paths';

function rule(
  kind: PathFilter['kind'],
  query: string,
  mode: PathFilter['mode'] = 'whitelist',
  enabled = true,
): PathFilter {
  return { id: `${kind}:${mode}:${query}`, kind, mode, query, enabled };
}

const wl = (kind: PathFilter['kind'], query: string) => rule(kind, query, 'whitelist');
const bl = (kind: PathFilter['kind'], query: string) => rule(kind, query, 'blacklist');

const PATHS = [
  'README.md',
  'domain/src/main/java/App.java',
  'domain/src/test/java/AppTest.java',
  'service/src/main/webui/main.ts',
  'service/src/test/foo.spec.ts',
];

describe('fuzzyMatch', () => {
  it('matches an in-order subsequence', () => {
    expect(fuzzyMatch('app', 'application.ts')).toBe(true);
    expect(fuzzyMatch('srvmn', 'service/src/main')).toBe(true);
  });

  it('rejects when characters are out of order or missing', () => {
    expect(fuzzyMatch('pa', 'app')).toBe(false);
    expect(fuzzyMatch('xyz', 'app')).toBe(false);
  });

  it('is smart-case', () => {
    expect(fuzzyMatch('readme', 'README.md')).toBe(true);
    expect(fuzzyMatch('README', 'README.md')).toBe(true);
    expect(fuzzyMatch('README', 'readme.md')).toBe(false);
  });

  it('treats a query with * / ? as an anchored glob wildcard', () => {
    expect(fuzzyMatch('.*ignore', '.gitignore')).toBe(true);
    expect(fuzzyMatch('.*ignore', '.dockerignore')).toBe(true);
    expect(fuzzyMatch('*.ts', 'main.ts')).toBe(true);
    expect(fuzzyMatch('*.ts', 'main.tsx')).toBe(false);
    expect(fuzzyMatch('main.??', 'main.ts')).toBe(true);
    expect(fuzzyMatch('main.??', 'main.tsx')).toBe(false);
  });
});

describe('gitignoreGlobToRegExp', () => {
  it('single * stays within one path segment', () => {
    const re = gitignoreGlobToRegExp('src/*.ts', true);
    expect(re.test('src/a.ts')).toBe(true);
    expect(re.test('src/nested/a.ts')).toBe(false);
  });

  it('** crosses directory separators', () => {
    const re = gitignoreGlobToRegExp('src/**/*.ts', true);
    expect(re.test('src/a.ts')).toBe(true);
    expect(re.test('src/nested/deep/a.ts')).toBe(true);
    expect(re.test('other/a.ts')).toBe(false);
  });

  it('**/name matches the basename at any depth (including zero)', () => {
    const re = gitignoreGlobToRegExp('**/foo', true);
    expect(re.test('foo')).toBe(true);
    expect(re.test('a/b/foo')).toBe(true);
    expect(re.test('foobar')).toBe(false);
  });

  it('? matches exactly one non-separator character', () => {
    const re = gitignoreGlobToRegExp('a?c', true);
    expect(re.test('abc')).toBe(true);
    expect(re.test('a/c')).toBe(false);
    expect(re.test('ac')).toBe(false);
  });

  it('supports character classes and negated classes', () => {
    expect(gitignoreGlobToRegExp('[a-z]file', true).test('afile')).toBe(true);
    expect(gitignoreGlobToRegExp('[a-z]file', true).test('1file')).toBe(false);
    expect(gitignoreGlobToRegExp('[!a]x', true).test('bx')).toBe(true);
    expect(gitignoreGlobToRegExp('[!a]x', true).test('ax')).toBe(false);
  });

  it('is anchored and case-sensitive when asked', () => {
    expect(gitignoreGlobToRegExp('README', true).test('README')).toBe(true);
    expect(gitignoreGlobToRegExp('README', true).test('readme')).toBe(false);
    expect(gitignoreGlobToRegExp('README', false).test('readme')).toBe(true);
  });
});

describe('applyPathFilters — last-match-wins', () => {
  const TREE = ['dist/app.js', 'dist/config.json', 'src/main.ts', 'README.md'];

  it('returns everything when there are no active filters', () => {
    expect(applyPathFilters(PATHS, [])).toEqual(PATHS);
    expect(applyPathFilters(PATHS, [wl('includes', 'domain')].map((f) => ({ ...f, enabled: false })))).toEqual(
      PATHS,
    );
    expect(applyPathFilters(PATHS, [wl('includes', '   ')])).toEqual(PATHS);
  });

  it('default is visible when there is only a blacklist (excludes behaviour)', () => {
    expect(applyPathFilters(PATHS, [bl('includes', 'test')])).toEqual([
      'README.md',
      'domain/src/main/java/App.java',
      'service/src/main/webui/main.ts',
    ]);
  });

  it('default flips to hidden once a manual whitelist rule exists (union-of-includes)', () => {
    expect(applyPathFilters(PATHS, [wl('includes', 'domain')])).toEqual([
      'domain/src/main/java/App.java',
      'domain/src/test/java/AppTest.java',
    ]);
    expect(applyPathFilters(PATHS, [wl('includes', 'domain'), wl('includes', 'webui')])).toEqual([
      'domain/src/main/java/App.java',
      'domain/src/test/java/AppTest.java',
      'service/src/main/webui/main.ts',
    ]);
  });

  it('a whitelist rule after a blacklist resurrects a hidden path', () => {
    // hide dist/, then whitelist one file back in — only works because it comes later
    const filters = [bl('includes', 'dist/'), wl('exact', 'dist/config.json')];
    expect(applyPathFilters(TREE, filters)).toEqual(['dist/config.json', 'src/main.ts', 'README.md']);
  });

  it('order matters: the same two rules reversed hide the file again', () => {
    // whitelist first (flips default to hidden), then blacklist dist/ catches config.json last
    const filters = [wl('exact', 'dist/config.json'), bl('includes', 'dist/')];
    expect(applyPathFilters(TREE, filters)).toEqual([]);
  });

  it('a glob whitelist does NOT flip the default (gitignore-negation semantics)', () => {
    // generated negations are whitelist globs; a lone one must not hide everything else
    expect(applyPathFilters(TREE, [wl('glob', '**/README.md')])).toEqual(TREE);
  });

  it('a restrict glob whitelist DOES flip the default (framework filter), unlike a plain one', () => {
    // Same glob, but `restrict:true` sets the stance to default-hidden — only matches survive.
    const plain = wl('glob', '**/*.ts');
    const restrict = { ...plain, restrict: true };
    expect(applyPathFilters(PATHS, [plain])).toEqual(PATHS); // plain glob whitelist: shows all
    expect(applyPathFilters(PATHS, [restrict])).toEqual([
      'service/src/main/webui/main.ts',
      'service/src/test/foo.spec.ts',
    ]);
  });

  it('glob blacklist then glob whitelist reproduces `*.log` + `!keep.log`', () => {
    const logs = ['a.log', 'keep.log', 'x.txt'];
    const filters = [bl('glob', '**/*.log'), wl('glob', '**/keep.log')];
    expect(applyPathFilters(logs, filters)).toEqual(['keep.log', 'x.txt']);
  });

  it('exact matches the full path only', () => {
    expect(applyPathFilters(PATHS, [wl('exact', 'README.md')])).toEqual(['README.md']);
    expect(applyPathFilters(PATHS, [wl('exact', 'README')])).toEqual([]);
  });

  it('applies smart-case to includes', () => {
    expect(applyPathFilters(PATHS, [wl('includes', 'App')])).toEqual([
      'domain/src/main/java/App.java',
      'domain/src/test/java/AppTest.java',
    ]);
  });
});

describe('filterFilePaths', () => {
  it('applies the rule list, then a final fuzzy pass over the filename only', () => {
    const result = filterFilePaths(PATHS, [wl('includes', 'src')], 'app');
    expect(result).toEqual(['domain/src/main/java/App.java', 'domain/src/test/java/AppTest.java']);
  });

  it('the name query supports glob wildcards on the filename', () => {
    expect(filterFilePaths(PATHS, [], '*.java')).toEqual([
      'domain/src/main/java/App.java',
      'domain/src/test/java/AppTest.java',
    ]);
  });

  it('name query matches the basename, not the directory', () => {
    expect(filterFilePaths(PATHS, [], 'domain')).toEqual([]);
  });

  it('a name query containing / matches the full path (seeded/pasted paths)', () => {
    expect(filterFilePaths(PATHS, [], 'domain/src/main/java/App.java')).toEqual([
      'domain/src/main/java/App.java',
    ]);
    // Subsequence over the full path: the test file's extra characters don't break the match.
    expect(filterFilePaths(PATHS, [], 'domain/src/App')).toEqual([
      'domain/src/main/java/App.java',
      'domain/src/test/java/AppTest.java',
    ]);
  });

  it('is a no-op filter when the name query is blank', () => {
    expect(filterFilePaths(PATHS, [], '  ')).toEqual(PATHS);
  });
});

describe('closestPath', () => {
  it('returns the exact path when it is among the candidates', () => {
    expect(closestPath(PATHS, 'domain/src/main/java/App.java')).toBe(
      'domain/src/main/java/App.java',
    );
  });

  it('prefers the candidate sharing the longest suffix with the target', () => {
    const candidates = ['src/app2/greeting.ts', 'src/other/greeting.spec.ts'];
    expect(closestPath(candidates, 'src/app/greeting.ts')).toBe('src/app2/greeting.ts');
  });

  it('breaks suffix ties by shorter path, then lexicographic order', () => {
    expect(closestPath(['src/deep/nested/a.ts', 'src/b/a.ts'], 'a.ts')).toBe('src/b/a.ts');
    expect(closestPath(['src/b/a.ts', 'src/a/a.ts'], 'a.ts')).toBe('src/a/a.ts');
  });

  it('returns null when there are no candidates', () => {
    expect(closestPath([], 'src/app/greeting.ts')).toBeNull();
  });
});
