/**
 * How a filter's query matches a path. `exact`/`fuzzy`/`includes` are user-authored; `glob` is a
 * gitignore-complete matcher used only by *generated* rules (from dynamic ignorelist filters) — it
 * is never offered as a manual kind.
 */
export type PathFilterKind = 'exact' | 'fuzzy' | 'includes' | 'glob';

/** What a match means: a whitelist match makes a path visible, a blacklist match hides it. */
export type PathFilterMode = 'whitelist' | 'blacklist';

/**
 * One filter rule. Rules form an **ordered** list (array position is the order) evaluated
 * gitignore-style **last-match-wins**: the last rule whose query matches a path decides its fate.
 * `kind` says *how* the query matches; `mode` says what a match *means*. A rule with a blank query
 * or `enabled: false` is a no-op.
 */
export interface PathFilter {
  id: string;
  kind: PathFilterKind;
  mode: PathFilterMode;
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
export function basename(path: string): string {
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
 * and `.dockerignore`; `*.ts` matches `main.ts` but not `main.tsx`. Used by the fuzzy kind and the
 * top filename input; it is *not* gitignore-complete (`*` crosses `/`, no `**`, no `[a-z]`).
 */
function wildcardToRegExp(query: string): RegExp {
  const body = query
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // escape regex metachars, but not * or ?
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${body}$`, caseSensitive(query) ? '' : 'i');
}

/**
 * A gitignore-complete glob → anchored RegExp. Unlike {@link wildcardToRegExp} it distinguishes
 * `**` (crosses directory separators) from `*` (stays within one path segment), and supports `?`
 * (a single non-`/` char) and character classes (`[a-z]`, `[!x]`). Used only by generated `glob`
 * rules, which pass `caseSensitive: true` to match git's default behaviour.
 */
export function gitignoreGlobToRegExp(glob: string, sensitive = false): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // `**` crosses directories. `**/` optionally consumes leading dirs so `**/x` matches both
        // `x` and `a/b/x`; a bare `**` matches anything.
        i++;
        if (glob[i + 1] === '/') {
          i++;
          re += '(?:.*/)?';
        } else {
          re += '.*';
        }
      } else {
        re += '[^/]*'; // single `*` stays within one segment
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if (c === '[') {
      // Character class, e.g. [a-z] or [!abc] (git uses `!` for negation, regex uses `^`).
      let j = i + 1;
      let cls = '[';
      if (glob[j] === '!') {
        cls += '^';
        j++;
      }
      if (glob[j] === ']') {
        cls += '\\]';
        j++;
      }
      while (j < glob.length && glob[j] !== ']') {
        cls += /[\\^]/.test(glob[j]) ? '\\' + glob[j] : glob[j];
        j++;
      }
      if (j >= glob.length) {
        // Unterminated class — treat the `[` as a literal instead of producing an invalid regex.
        re += '\\[';
      } else {
        re += cls + ']';
        i = j; // j points at the closing `]`
      }
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`, sensitive ? '' : 'i');
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

/**
 * Compiles a single filter into a reusable predicate over the full path. Glob rules build their
 * RegExp once here (not per path), which matters when the path list is large.
 */
function compileMatcher(filter: PathFilter): (path: string) => boolean {
  const { kind, query } = filter;
  if (kind === 'glob') {
    const re = gitignoreGlobToRegExp(query, true); // git default: case-sensitive
    return (p) => re.test(p);
  }
  const sensitive = caseSensitive(query);
  const q = fold(query, sensitive);
  switch (kind) {
    case 'exact':
      return (p) => fold(p, sensitive) === q;
    case 'includes':
      return (p) => fold(p, sensitive).includes(q);
    case 'fuzzy':
      return (p) => fuzzyMatch(query, p);
    default:
      return () => false;
  }
}

/**
 * Applies the ordered filter list, gitignore-style **last-match-wins**: for each path, walk the
 * active rules in order and let the last matching rule decide visibility.
 *
 * Paths matched by no rule take a default set by the **first** active rule — the rule that declares
 * the list's stance:
 * - lead with a **manual whitelist** ("show only these") → default *hidden*, so the list restricts
 *   to whitelisted paths (the legacy union-of-includes behaviour; a trailing blacklist then
 *   subtracts, reproducing the old includes-minus-excludes).
 * - lead with a **blacklist** ("hide these") → default *visible*, so everything shows except what a
 *   blacklist hides, and a later whitelist can re-include a hidden path without hiding the rest —
 *   gitignore's `foo` + `!foo/keep` semantics, and the resurrection flow for dynamic filters.
 *
 * A generated `glob` whitelist never sets the stance (an ignore file that opens with a `!negation`
 * must not flip the whole tree to hidden), so it is treated as if the default were visible.
 */
export function applyPathFilters(paths: string[], filters: PathFilter[]): string[] {
  const active = filters.filter((f) => f.enabled && f.query.trim() !== '');
  if (active.length === 0) return paths;

  const rules = active.map((f) => ({ whitelist: f.mode === 'whitelist', matches: compileMatcher(f) }));
  const leadsWithManualWhitelist = active[0].mode === 'whitelist' && active[0].kind !== 'glob';
  const initial = !leadsWithManualWhitelist;

  return paths.filter((path) => {
    let visible = initial;
    for (const r of rules) {
      if (r.matches(path)) visible = r.whitelist;
    }
    return visible;
  });
}

/**
 * The full tree-filtering pipeline: the ordered filter list ({@link applyPathFilters}) followed by a
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
