/** The kinds of criteria the advanced filter dialog can apply to a file path. */
export type PathFilterKind = 'exact' | 'fuzzy' | 'includes' | 'excludes';

/**
 * One filter criterion. `exact`/`fuzzy`/`includes` are whitelist criteria (their matches are
 * unioned); `excludes` removes matches. A filter with a blank query or `enabled: false` is a no-op.
 */
export interface PathFilter {
  id: string;
  kind: PathFilterKind;
  query: string;
  enabled: boolean;
}

/**
 * Smart-case: an all-lowercase query matches case-insensitively; any uppercase letter in the query
 * makes the whole query case-sensitive (like ripgrep/vim smart-case).
 */
function caseSensitive(query: string): boolean {
  return /[A-Z]/.test(query);
}

function fold(value: string, sensitive: boolean): string {
  return sensitive ? value : value.toLowerCase();
}

/** The final path segment (basename) of a slash-separated path. */
function basename(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? path : path.slice(slash + 1);
}

/** Whether a query uses glob wildcards (`*` any run, `?` single char) rather than plain fuzzy. */
function hasWildcard(query: string): boolean {
  return query.includes('*') || query.includes('?');
}

/**
 * Compiles a glob-style query (`*` → any run, `?` → any single char; every other character is
 * literal) into an anchored, smart-case RegExp — the whole target must match, as globs conventionally
 * do. Escaping guarantees a valid pattern, so this never throws. e.g. `.*ignore` matches `.gitignore`
 * and `.dockerignore`; `*.ts` matches `main.ts` but not `main.tsx`.
 */
function wildcardToRegExp(query: string): RegExp {
  const body = query
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // escape regex metachars, but not * or ?
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${body}$`, caseSensitive(query) ? '' : 'i');
}

/**
 * The fuzzy matcher. A query that uses `*`/`?` is treated as a glob wildcard (unanchored); otherwise
 * it's a subsequence match — every character of `query` appearing in `target` in order. Both use
 * smart-case. An empty query matches everything — callers guard against blank queries themselves.
 */
export function fuzzyMatch(query: string, target: string): boolean {
  if (hasWildcard(query)) {
    return wildcardToRegExp(query).test(target);
  }
  const sensitive = caseSensitive(query);
  const q = fold(query, sensitive);
  const t = fold(target, sensitive);
  let i = 0;
  for (let j = 0; j < t.length && i < q.length; j++) {
    if (t[j] === q[i]) i++;
  }
  return i === q.length;
}

/** Whether a path satisfies a single whitelist criterion (exact/fuzzy/includes), on the full path. */
function matchesInclude(filter: PathFilter, path: string): boolean {
  const sensitive = caseSensitive(filter.query);
  switch (filter.kind) {
    case 'exact':
      return fold(path, sensitive) === fold(filter.query, sensitive);
    case 'includes':
      return fold(path, sensitive).includes(fold(filter.query, sensitive));
    case 'fuzzy':
      return fuzzyMatch(filter.query, path);
    default:
      return false;
  }
}

/** Whether a path is caught by an exclude criterion (substring on the full path, smart-case). */
function matchesExclude(query: string, path: string): boolean {
  const sensitive = caseSensitive(query);
  return fold(path, sensitive).includes(fold(query, sensitive));
}

/**
 * Applies the dialog's filter list: the result is the union of paths matching any active whitelist
 * criterion (or all paths when there are none), with any path matching an active exclude removed.
 */
export function applyPathFilters(paths: string[], filters: PathFilter[]): string[] {
  const active = filters.filter((f) => f.enabled && f.query.trim() !== '');
  const includes = active.filter((f) => f.kind !== 'excludes');
  const excludes = active.filter((f) => f.kind === 'excludes');

  let result = includes.length
    ? paths.filter((p) => includes.some((f) => matchesInclude(f, p)))
    : paths;

  if (excludes.length) {
    result = result.filter((p) => !excludes.some((f) => matchesExclude(f.query, p)));
  }
  return result;
}

/**
 * The full tree-filtering pipeline: the dialog filters ({@link applyPathFilters}) followed by a
 * final fuzzy pass of the top input over each path's basename (the filename only).
 */
export function filterFilePaths(
  paths: string[],
  filters: PathFilter[],
  nameQuery: string,
): string[] {
  const filtered = applyPathFilters(paths, filters);
  const query = nameQuery.trim();
  if (query === '') {
    return filtered;
  }
  return filtered.filter((p) => fuzzyMatch(query, basename(p)));
}
