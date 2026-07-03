import { basename, gitignoreGlobToRegExp, type PathFilter } from './filter-file-paths';

/**
 * A language/framework "kind" the worktree browser can recognise, shaped like the viewer's
 * {@link SMART_RENDERERS} registry. A descriptor owns *all* the framework-specific knowledge —
 * how to find its project roots, which files "belong" to it (for the framework filter), and how to
 * map a source file to its test(s) and back (for the viewer's test↔code tabs) — so the component and
 * the filter/tab utilities stay generic.
 *
 * Everything is expressed **project-root-relative**: {@link detectRoots} yields roots (`''` for the
 * repo root), and the remaining hooks take/return root-relative paths and globs. Callers prefix with
 * the owning root.
 */
export interface FrameworkDescriptor {
  /** Stable id, e.g. `'java-quarkus'`, `'ts-angular'`, `'docs'`. */
  id: string;
  /** Base display label; may be refined per-root via {@link refineLabel} (Maven → Quarkus). */
  label: string;
  /** Every project root of this kind present in the path list (`''` = repo root). */
  detectRoots(paths: string[]): string[];
  /** Root-relative globs (gitignore-complete) of the files that belong to this framework. */
  frameworkGlobs: string[];
  /** Whether a root-relative path is one of this framework's test files. */
  isTestPath?(relPath: string): boolean;
  /** Given a root-relative source path, candidate root-relative test globs. */
  testCandidates?(relPath: string): string[];
  /** Given a root-relative test path, candidate root-relative source globs (best-effort inverse). */
  sourceCandidates?(relTestPath: string): string[];
  /** The root-relative marker file to peek for a label refinement (java: `pom.xml`), if any. */
  labelPeekMarker?(root: string): string | null;
  /** A refined label derived from the marker file's content, or `null` to keep the base label. */
  refineLabel?(markerContent: string): string | null;
  /**
   * The directory a quick-access toggle should open the tree down to (its ancestors are opened too),
   * so activating a framework lands the user inside its source tree instead of at the collapsed root
   * — java → `<root>/src/main`, angular → `<root>/src`, docs → the docs dir itself. `null` = don't
   * auto-open.
   */
  autoExpandDir?(root: string): string | null;
}

/** A detected project: one root of one framework kind. */
export interface DetectedProject {
  root: string;
  descriptor: FrameworkDescriptor;
}

/** A file in a viewer "linked group": the opened file plus its detected counterpart(s). */
export interface LinkedFile {
  role: 'code' | 'test';
  path: string;
}

/** Directory of every path whose basename is `marker` (`''` = repo root). */
function markerRoots(paths: string[], marker: string): string[] {
  const roots = new Set<string>();
  for (const p of paths) {
    if (basename(p) === marker) {
      const slash = p.lastIndexOf('/');
      roots.add(slash === -1 ? '' : p.slice(0, slash));
    }
  }
  return [...roots].sort();
}

/** Every directory named `docs` that has at least one `*.md` beneath it. */
function docsRoots(paths: string[]): string[] {
  const candidates = new Set<string>();
  for (const p of paths) {
    const parts = p.split('/');
    // A `docs` segment must be a directory, so never the final (basename) segment.
    for (let i = 0; i < parts.length - 1; i++) {
      if (parts[i] === 'docs') candidates.add(parts.slice(0, i + 1).join('/'));
    }
  }
  return [...candidates]
    .filter((root) => paths.some((p) => p.startsWith(`${root}/`) && /\.md$/i.test(basename(p))))
    .sort();
}

const JAVA_SOURCE = /^src\/main\/java\/(.*\/)?([^/]+)\.java$/;
const JAVA_TEST = /^src\/test\/java\/(.*\/)?([^/]+?)(Test|IT)\.java$/;

/** The three framework kinds we ship. The registry makes adding a fourth a one-entry change. */
export const FRAMEWORK_DESCRIPTORS: readonly FrameworkDescriptor[] = [
  {
    id: 'java-quarkus',
    label: 'Java / Maven',
    detectRoots: (paths) => markerRoots(paths, 'pom.xml'),
    frameworkGlobs: [
      'pom.xml',
      '**/*.java',
      'src/main/resources/**',
      'src/test/resources/**',
    ],
    isTestPath: (rel) => JAVA_TEST.test(rel),
    testCandidates: (rel) => {
      const m = JAVA_SOURCE.exec(rel);
      if (!m) return [];
      const pkg = m[1] ?? '';
      const name = m[2];
      return [`src/test/java/${pkg}${name}*Test.java`, `src/test/java/${pkg}${name}*IT.java`];
    },
    sourceCandidates: (relTest) => {
      const m = JAVA_TEST.exec(relTest);
      if (!m) return [];
      const pkg = m[1] ?? '';
      // The `*Test`/`*IT` qualifier makes the inverse ambiguous, so try every CamelCase prefix of
      // the base **longest-first** (`TheFileSpecialCase` → `TheFileSpecialCase`, `TheFileSpecial`,
      // `TheFile`, `The`); the caller picks the first that exists — the deepest class that owns it.
      return camelPrefixes(m[2]).map((n) => `src/main/java/${pkg}${n}.java`);
    },
    labelPeekMarker: (root) => (root === '' ? 'pom.xml' : `${root}/pom.xml`),
    refineLabel: (content) => (/quarkus/i.test(content) ? 'Java / Quarkus' : null),
    autoExpandDir: (root) => (root === '' ? 'src/main' : `${root}/src/main`),
  },
  {
    id: 'ts-angular',
    label: 'TypeScript / Angular',
    detectRoots: (paths) => markerRoots(paths, 'angular.json'),
    frameworkGlobs: ['package.json', 'angular.json', 'tsconfig*.json', 'src/**', 'public/**'],
    autoExpandDir: (root) => (root === '' ? 'src' : `${root}/src`),
    isTestPath: (rel) => rel.endsWith('.spec.ts'),
    testCandidates: (rel) =>
      rel.endsWith('.spec.ts') || !rel.endsWith('.ts') ? [] : [`${rel.slice(0, -3)}.spec.ts`],
    sourceCandidates: (relTest) =>
      relTest.endsWith('.spec.ts') ? [`${relTest.slice(0, -'.spec.ts'.length)}.ts`] : [],
  },
  {
    id: 'docs',
    label: 'Docs',
    detectRoots: docsRoots,
    frameworkGlobs: ['**'],
    autoExpandDir: (root) => root || null,
  },
];

/** Detect every project of every kind in the path list — a pure, content-free pass. */
export function detectFrameworks(paths: string[]): DetectedProject[] {
  const projects: DetectedProject[] = [];
  for (const descriptor of FRAMEWORK_DESCRIPTORS) {
    for (const root of descriptor.detectRoots(paths)) {
      projects.push({ root, descriptor });
    }
  }
  return projects;
}

/** Whether `root` (a project root, `''` = repo root) is a path-prefix of `path`. */
function rootPrefixes(root: string, path: string): boolean {
  return root === '' || path === root || path.startsWith(`${root}/`);
}

/**
 * The project that owns `path`: the **deepest** root that prefixes it (most-specific wins), so a
 * file under a nested project belongs to that project, not an enclosing one.
 */
export function owningProject(
  path: string,
  projects: readonly DetectedProject[],
): DetectedProject | undefined {
  let best: DetectedProject | undefined;
  for (const proj of projects) {
    if (rootPrefixes(proj.root, path) && (!best || proj.root.length > best.root.length)) {
      best = proj;
    }
  }
  return best;
}

/**
 * Generated whitelist rules for a framework filter: each of `descriptor.frameworkGlobs` scoped
 * (prefixed) by each root. `restrict: true` marks them as **restricting** — a leading one sets the
 * pipeline's stance to default-hidden (see {@link applyPathFilters}), so only framework files show.
 * `docs` passes all its roots here so one filter spans every `docs/` directory.
 */
export function frameworkToRules(
  descriptor: FrameworkDescriptor,
  roots: readonly string[],
): PathFilter[] {
  const rules: PathFilter[] = [];
  let i = 0;
  for (const root of roots) {
    for (const glob of descriptor.frameworkGlobs) {
      const query = root === '' ? glob : `${root}/${glob}`;
      rules.push({
        id: `fw:${descriptor.id}:${root}:${i++}`,
        kind: 'glob',
        mode: 'whitelist',
        restrict: true,
        query,
        enabled: true,
      });
    }
  }
  return rules;
}

/** Sort matched counterpart paths so the closest (shortest basename, then lexical) comes first. */
function byClosest(a: string, b: string): number {
  return basename(a).length - basename(b).length || a.localeCompare(b);
}

/**
 * The CamelCase prefixes of a class base name, **longest first**: `TheFileCase` →
 * `[TheFileCase, TheFile, The]`. A run of capitals stays together (`HTTPServer` → `[HTTPServer,
 * HTTP]`). Used to resolve a qualified test (`TheFileCaseTest`) to the deepest source class.
 */
function camelPrefixes(base: string): string[] {
  const words = base.match(/[A-Z][a-z0-9]*|[A-Z]+(?![a-z])/g) ?? [base];
  const prefixes: string[] = [];
  let acc = '';
  for (const word of words) {
    acc += word;
    prefixes.push(acc);
  }
  return prefixes.reverse();
}

/**
 * The single source that owns a test — the **first of its `sourceCandidates` that exists**. Because
 * java yields CamelCase prefixes longest-first, `FooBarTest` resolves to `FooBar.java` when it
 * exists and otherwise to `Foo.java`: the deepest class that actually owns it. `null` if `path` is
 * not a test or has no existing source.
 */
function ownerSource(
  path: string,
  descriptor: FrameworkDescriptor,
  root: string,
  existing: ReadonlySet<string>,
): string | null {
  const rel = root === '' ? path : path.slice(root.length + 1);
  if (!descriptor.isTestPath?.(rel)) return null;
  for (const candidate of descriptor.sourceCandidates?.(rel) ?? []) {
    const full = root === '' ? candidate : `${root}/${candidate}`;
    if (full !== path && existing.has(full)) return full;
  }
  return null;
}

/**
 * The existing **test** files of a source `path` (source→test detection). This is the single
 * primitive behind both the viewer's test tabs and the tree's redundant-test hiding, so the two can
 * never disagree. A candidate test is kept only when `path` is its **most-specific** owner, so
 * `Foo.java` does not also claim `FooBarTest` once `FooBar.java` exists. Returns `[]` when `path` is
 * itself a test, isn't owned by a project, or has no detected tests.
 */
export function linkedTestsOf(
  path: string,
  projects: readonly DetectedProject[],
  allPaths: readonly string[],
): string[] {
  const proj = owningProject(path, projects);
  if (!proj) return [];
  const { descriptor, root } = proj;
  const rel = root === '' ? path : path.slice(root.length + 1);
  if (descriptor.isTestPath?.(rel)) return [];
  const globs = descriptor.testCandidates?.(rel) ?? [];
  if (globs.length === 0) return [];
  const res = globs.map((g) => gitignoreGlobToRegExp(root === '' ? g : `${root}/${g}`, true));
  const existing = new Set(allPaths);
  return allPaths
    .filter((p) => p !== path && res.some((re) => re.test(p)))
    .filter((test) => ownerSource(test, descriptor, root, existing) === path)
    .sort(byClosest);
}

/** The existing **source** file of a test `path` (test→source), or `[]` if `path` isn't a test. */
export function linkedSourcesOf(
  path: string,
  projects: readonly DetectedProject[],
  allPaths: readonly string[],
): string[] {
  const proj = owningProject(path, projects);
  if (!proj) return [];
  const source = ownerSource(path, proj.descriptor, proj.root, new Set(allPaths));
  return source ? [source] : [];
}

/**
 * The viewer's "linked group" for an opened file: the file itself plus its detected counterpart(s),
 * each tagged {@link LinkedFile.role code or test}. Resolves the owning project, runs the descriptor's
 * source→test (or test→source) rules, and keeps only candidates that actually exist in `allPaths`.
 * Returns `[]` when there is no counterpart (the caller then shows a single file, no tab strip).
 */
export function resolveLinkedGroup(
  path: string,
  projects: readonly DetectedProject[],
  allPaths: readonly string[],
): LinkedFile[] {
  const tests = linkedTestsOf(path, projects, allPaths);
  if (tests.length > 0) {
    return [{ role: 'code', path }, ...tests.map((p): LinkedFile => ({ role: 'test', path: p }))];
  }
  const sources = linkedSourcesOf(path, projects, allPaths);
  if (sources.length > 0) {
    return [...sources.map((p): LinkedFile => ({ role: 'code', path: p })), { role: 'test', path }];
  }
  return [];
}
