import { applyPathFilters, filterFilePaths, fuzzyMatch, type PathFilter } from './filter-file-paths';

function filter(kind: PathFilter['kind'], query: string, enabled = true): PathFilter {
  return { id: `${kind}:${query}`, kind, query, enabled };
}

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

  it('is smart-case: a lowercase query is case-insensitive', () => {
    expect(fuzzyMatch('readme', 'README.md')).toBe(true);
  });

  it('is smart-case: an uppercase letter makes the query case-sensitive', () => {
    expect(fuzzyMatch('README', 'README.md')).toBe(true);
    expect(fuzzyMatch('README', 'readme.md')).toBe(false);
  });

  it('treats a query with * / ? as an anchored glob wildcard', () => {
    // the motivating example: one pattern finds every *ignore file
    expect(fuzzyMatch('.*ignore', '.gitignore')).toBe(true);
    expect(fuzzyMatch('.*ignore', '.dockerignore')).toBe(true);
    // anchored: *.ts matches .ts but not .tsx
    expect(fuzzyMatch('*.ts', 'main.ts')).toBe(true);
    expect(fuzzyMatch('*.ts', 'main.tsx')).toBe(false);
    // ? is exactly one character
    expect(fuzzyMatch('main.??', 'main.ts')).toBe(true);
    expect(fuzzyMatch('main.??', 'main.tsx')).toBe(false);
  });

  it('applies smart-case to wildcard queries too', () => {
    expect(fuzzyMatch('*IGNORE', '.gitignore')).toBe(false); // uppercase → case-sensitive
    expect(fuzzyMatch('*ignore', '.GITIGNORE')).toBe(true); // lowercase → case-insensitive
  });
});

describe('applyPathFilters', () => {
  it('returns everything when there are no active filters', () => {
    expect(applyPathFilters(PATHS, [])).toEqual(PATHS);
    // disabled or blank filters are no-ops
    expect(applyPathFilters(PATHS, [filter('includes', 'domain', false)])).toEqual(PATHS);
    expect(applyPathFilters(PATHS, [filter('includes', '   ')])).toEqual(PATHS);
  });

  it('includes: keeps only paths containing the substring', () => {
    expect(applyPathFilters(PATHS, [filter('includes', 'domain')])).toEqual([
      'domain/src/main/java/App.java',
      'domain/src/test/java/AppTest.java',
    ]);
  });

  it('unions multiple whitelist filters', () => {
    const result = applyPathFilters(PATHS, [
      filter('includes', 'domain'),
      filter('includes', 'webui'),
    ]);
    expect(result).toEqual([
      'domain/src/main/java/App.java',
      'domain/src/test/java/AppTest.java',
      'service/src/main/webui/main.ts',
    ]);
  });

  it('exact: matches the full path only', () => {
    expect(applyPathFilters(PATHS, [filter('exact', 'README.md')])).toEqual(['README.md']);
    expect(applyPathFilters(PATHS, [filter('exact', 'README')])).toEqual([]);
  });

  it('excludes: removes matches from the whitelist (or from all when no includes)', () => {
    // only an exclude → everything minus matches
    expect(applyPathFilters(PATHS, [filter('excludes', 'test')])).toEqual([
      'README.md',
      'domain/src/main/java/App.java',
      'service/src/main/webui/main.ts',
    ]);
    // include union then subtract excludes
    expect(
      applyPathFilters(PATHS, [filter('includes', 'domain'), filter('excludes', 'test')]),
    ).toEqual(['domain/src/main/java/App.java']);
  });

  it('fuzzy: supports glob wildcards over the full path', () => {
    expect(applyPathFilters(PATHS, [filter('fuzzy', '*.java')])).toEqual([
      'domain/src/main/java/App.java',
      'domain/src/test/java/AppTest.java',
    ]);
    expect(applyPathFilters(PATHS, [filter('fuzzy', '*/test/*')])).toEqual([
      'domain/src/test/java/AppTest.java',
      'service/src/test/foo.spec.ts',
    ]);
  });

  it('applies smart-case to includes', () => {
    expect(applyPathFilters(PATHS, [filter('includes', 'app')])).toEqual([
      'domain/src/main/java/App.java',
      'domain/src/test/java/AppTest.java',
    ]);
    expect(applyPathFilters(PATHS, [filter('includes', 'App')])).toEqual([
      'domain/src/main/java/App.java',
      'domain/src/test/java/AppTest.java',
    ]);
  });
});

describe('filterFilePaths', () => {
  it('applies dialog filters, then a final fuzzy pass over the filename only', () => {
    // includes 'src' would keep 4 paths; the name query 'app' then keeps only those whose
    // basename fuzzy-matches — App.java / AppTest.java (not main.ts / foo.spec.ts).
    const result = filterFilePaths(PATHS, [filter('includes', 'src')], 'app');
    expect(result).toEqual([
      'domain/src/main/java/App.java',
      'domain/src/test/java/AppTest.java',
    ]);
  });

  it('the name query supports glob wildcards on the filename', () => {
    // '.*ignore'-style suffix search, but here for .ts files by extension
    expect(filterFilePaths(PATHS, [], '*.java')).toEqual([
      'domain/src/main/java/App.java',
      'domain/src/test/java/AppTest.java',
    ]);
  });

  it('name query matches the basename, not the directory', () => {
    // 'domain' appears in directories but no basename fuzzy-matches it
    expect(filterFilePaths(PATHS, [], 'domain')).toEqual([]);
  });

  it('is a no-op filter when the name query is blank', () => {
    expect(filterFilePaths(PATHS, [], '  ')).toEqual(PATHS);
  });
});
