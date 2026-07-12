import {
  detectFrameworks,
  FRAMEWORK_DESCRIPTORS,
  frameworkToRules,
  linkedSourcesOf,
  linkedTestsOf,
  owningProject,
  resolveLinkedGroup,
  type DetectedProject,
} from './detect-frameworks';

const descriptor = (id: string) => FRAMEWORK_DESCRIPTORS.find((d) => d.id === id)!;

/** The (id, root) pairs of a detection result, for compact assertions. */
function shape(projects: DetectedProject[]): { id: string; root: string }[] {
  return projects.map((p) => ({ id: p.descriptor.id, root: p.root })).sort((a, b) =>
    a.id.localeCompare(b.id) || a.root.localeCompare(b.root),
  );
}

describe('detectFrameworks', () => {
  it('detects nested java + angular projects, each at the parent dir of its marker', () => {
    const paths = [
      'pom.xml',
      'domain/pom.xml',
      'service/pom.xml',
      'service/src/main/webui/angular.json',
      'service/src/main/webui/package.json',
      'service/src/main/webui/src/app/x.ts',
      'README.md',
    ];
    expect(shape(detectFrameworks(paths))).toEqual([
      { id: 'java-quarkus', root: '' },
      { id: 'java-quarkus', root: 'domain' },
      { id: 'java-quarkus', root: 'service' },
      { id: 'ts-angular', root: 'service/src/main/webui' },
    ]);
  });

  it('does not detect angular from a lone package.json (no angular.json)', () => {
    expect(detectFrameworks(['pkg/package.json', 'pkg/src/index.ts'])).toEqual([]);
  });

  it('detects a docs dir only when it contains a *.md, and surfaces multiple docs dirs', () => {
    expect(shape(detectFrameworks(['docs/notes.txt']))).toEqual([]);
    expect(shape(detectFrameworks(['docs/plan.md', 'service/docs/guide.md']))).toEqual([
      { id: 'docs', root: 'docs' },
      { id: 'docs', root: 'service/docs' },
    ]);
  });
});

describe('owningProject', () => {
  const projects = detectFrameworks([
    'pom.xml',
    'service/pom.xml',
    'service/src/main/webui/angular.json',
    'docs/plan.md',
  ]);

  it('picks the deepest root that prefixes the path (most-specific wins)', () => {
    expect(owningProject('service/src/main/webui/src/app/x.ts', projects)?.descriptor.id).toBe(
      'ts-angular',
    );
    expect(owningProject('service/src/main/java/Foo.java', projects)).toMatchObject({
      root: 'service',
      descriptor: { id: 'java-quarkus' },
    });
    expect(owningProject('pom.xml', projects)).toMatchObject({ root: '' });
    expect(owningProject('docs/plan.md', projects)?.descriptor.id).toBe('docs');
  });

  it('returns undefined for a path owned by no project', () => {
    expect(owningProject('x.ts', [])).toBeUndefined();
  });
});

describe('frameworkToRules', () => {
  it('emits restrict whitelist glob rules scoped by each root', () => {
    const rules = frameworkToRules(descriptor('ts-angular'), ['service/src/main/webui']);
    expect(rules.every((r) => r.kind === 'glob' && r.mode === 'whitelist' && r.restrict)).toBe(true);
    expect(rules.map((r) => r.query)).toEqual([
      'service/src/main/webui/package.json',
      'service/src/main/webui/angular.json',
      'service/src/main/webui/tsconfig*.json',
      'service/src/main/webui/src/**',
      'service/src/main/webui/public/**',
    ]);
  });

  it('scopes root-level globs without a prefix and unions multiple (docs) roots', () => {
    const rules = frameworkToRules(descriptor('java-quarkus'), ['']);
    expect(rules.map((r) => r.query)).toEqual([
      'pom.xml',
      '**/*.java',
      'src/main/resources/**',
      'src/test/resources/**',
    ]);
    const docs = frameworkToRules(descriptor('docs'), ['docs', 'service/docs']);
    expect(docs.map((r) => r.query)).toEqual(['docs/**', 'service/docs/**']);
  });
});

describe('resolveLinkedGroup — java', () => {
  const paths = [
    'pom.xml',
    'src/main/java/com/App.java',
    'src/test/java/com/AppTest.java',
    'src/test/java/com/AppIT.java',
    'src/test/java/com/AppSliceTest.java',
  ];
  const projects = detectFrameworks(paths);

  it('opens a source file → its test/IT counterparts (code tab first)', () => {
    const group = resolveLinkedGroup('src/main/java/com/App.java', projects, paths);
    expect(group[0]).toEqual({ role: 'code', path: 'src/main/java/com/App.java' });
    expect(group.filter((f) => f.role === 'test').map((f) => f.path).sort()).toEqual([
      'src/test/java/com/AppIT.java',
      'src/test/java/com/AppSliceTest.java',
      'src/test/java/com/AppTest.java',
    ]);
  });

  it('opens a test → its source (test→source best-effort, strips *Test qualifier)', () => {
    const group = resolveLinkedGroup('src/test/java/com/AppSliceTest.java', projects, paths);
    expect(group).toContainEqual({ role: 'code', path: 'src/main/java/com/App.java' });
    expect(group.at(-1)).toEqual({ role: 'test', path: 'src/test/java/com/AppSliceTest.java' });
  });

  it('returns no group when a source has no test', () => {
    const lonely = ['pom.xml', 'src/main/java/com/Lonely.java'];
    expect(resolveLinkedGroup('src/main/java/com/Lonely.java', detectFrameworks(lonely), lonely)).toEqual(
      [],
    );
  });
});

describe('resolveLinkedGroup — angular', () => {
  const paths = ['w/angular.json', 'w/src/foo.component.ts', 'w/src/foo.component.spec.ts'];
  const projects = detectFrameworks(paths);

  it('links foo.component.ts ↔ foo.component.spec.ts both ways, picking the angular rule', () => {
    expect(resolveLinkedGroup('w/src/foo.component.ts', projects, paths)).toEqual([
      { role: 'code', path: 'w/src/foo.component.ts' },
      { role: 'test', path: 'w/src/foo.component.spec.ts' },
    ]);
    expect(resolveLinkedGroup('w/src/foo.component.spec.ts', projects, paths)).toEqual([
      { role: 'code', path: 'w/src/foo.component.ts' },
      { role: 'test', path: 'w/src/foo.component.spec.ts' },
    ]);
  });
});

describe('linkedTestsOf / linkedSourcesOf (the shared tab + tree-hiding primitive)', () => {
  const paths = [
    'pom.xml',
    'src/main/java/com/App.java',
    'src/test/java/com/AppTest.java',
    'src/test/java/com/OrphanTest.java',
    'w/angular.json',
    'w/src/foo.ts',
    'w/src/foo.spec.ts',
  ];
  const projects = detectFrameworks(paths);

  it('linkedTestsOf: a source → its existing tests; empty for a test or an untested source', () => {
    expect(linkedTestsOf('src/main/java/com/App.java', projects, paths)).toEqual([
      'src/test/java/com/AppTest.java',
    ]);
    expect(linkedTestsOf('w/src/foo.ts', projects, paths)).toEqual(['w/src/foo.spec.ts']);
    // a test is not a source of tests, and an orphan source has none
    expect(linkedTestsOf('src/test/java/com/AppTest.java', projects, paths)).toEqual([]);
  });

  it('linkedSourcesOf: a test → its existing source; empty for a source', () => {
    expect(linkedSourcesOf('w/src/foo.spec.ts', projects, paths)).toEqual(['w/src/foo.ts']);
    expect(linkedSourcesOf('src/test/java/com/AppTest.java', projects, paths)).toEqual([
      'src/main/java/com/App.java',
    ]);
    expect(linkedSourcesOf('src/main/java/com/App.java', projects, paths)).toEqual([]);
    // an orphan test resolves to no existing source
    expect(linkedSourcesOf('src/test/java/com/OrphanTest.java', projects, paths)).toEqual([]);
  });

  it('handles qualified test names (…SpecialCaseTest, …RecordingIT) → the base source', () => {
    const p = [
      'pom.xml',
      'src/main/java/com/TheFile.java',
      'src/test/java/com/TheFileTest.java',
      'src/test/java/com/TheFileSpecialCaseTest.java',
      'src/test/java/com/TheFileRecordingIT.java',
    ];
    const proj = detectFrameworks(p);
    // source → all its qualified tests (Test + IT, any qualifier)
    expect(linkedTestsOf('src/main/java/com/TheFile.java', proj, p).sort()).toEqual([
      'src/test/java/com/TheFileRecordingIT.java',
      'src/test/java/com/TheFileSpecialCaseTest.java',
      'src/test/java/com/TheFileTest.java',
    ]);
    // each qualified test → back to TheFile.java (intermediate prefix, not just full-base/first-word)
    expect(linkedSourcesOf('src/test/java/com/TheFileSpecialCaseTest.java', proj, p)).toEqual([
      'src/main/java/com/TheFile.java',
    ]);
    expect(linkedSourcesOf('src/test/java/com/TheFileRecordingIT.java', proj, p)).toEqual([
      'src/main/java/com/TheFile.java',
    ]);
  });

  it('attributes a qualified test to the most-specific source when one exists', () => {
    const p = [
      'pom.xml',
      'src/main/java/com/TheFile.java',
      'src/main/java/com/TheFileSpecialCase.java',
      'src/test/java/com/TheFileTest.java',
      'src/test/java/com/TheFileSpecialCaseTest.java',
    ];
    const proj = detectFrameworks(p);
    // TheFileSpecialCaseTest now belongs to TheFileSpecialCase.java, NOT TheFile.java
    expect(linkedSourcesOf('src/test/java/com/TheFileSpecialCaseTest.java', proj, p)).toEqual([
      'src/main/java/com/TheFileSpecialCase.java',
    ]);
    expect(linkedTestsOf('src/main/java/com/TheFileSpecialCase.java', proj, p)).toEqual([
      'src/test/java/com/TheFileSpecialCaseTest.java',
    ]);
    // …so TheFile.java only owns TheFileTest, not the more-specific test
    expect(linkedTestsOf('src/main/java/com/TheFile.java', proj, p)).toEqual([
      'src/test/java/com/TheFileTest.java',
    ]);
  });

  it('resolveLinkedGroup is exactly these two primitives combined', () => {
    // source path: group is [code, ...linkedTestsOf]
    expect(resolveLinkedGroup('src/main/java/com/App.java', projects, paths)).toEqual([
      { role: 'code', path: 'src/main/java/com/App.java' },
      { role: 'test', path: 'src/test/java/com/AppTest.java' },
    ]);
    // orphan test: [...linkedSourcesOf (none)] → no group
    expect(resolveLinkedGroup('src/test/java/com/OrphanTest.java', projects, paths)).toEqual([]);
  });
});

describe('permissive java test folding (extension)', () => {
  const SRC = 'src/main/java/com';
  const TST = 'src/test/java/com';

  it('folds a scenario-named test into the single source that extends its ≥2-word prefix', () => {
    // No OtelProxyUnreachable.java / OtelProxy.java — OtelProxyUnreachableTest still belongs to the
    // one OtelProxy* source that exists.
    const p = [
      'pom.xml',
      `${SRC}/OtelProxyResource.java`,
      `${TST}/OtelProxyResourceTest.java`,
      `${TST}/OtelProxyUnreachableTest.java`,
    ];
    const proj = detectFrameworks(p);
    expect(linkedSourcesOf(`${TST}/OtelProxyUnreachableTest.java`, proj, p)).toEqual([
      `${SRC}/OtelProxyResource.java`,
    ]);
    // source → both its exact and its extension-folded tests
    expect(linkedTestsOf(`${SRC}/OtelProxyResource.java`, proj, p).sort()).toEqual([
      `${TST}/OtelProxyResourceTest.java`,
      `${TST}/OtelProxyUnreachableTest.java`,
    ]);
  });

  it('prefers a more-specific exact source over an extension match (longest-first)', () => {
    const p = [
      'pom.xml',
      `${SRC}/OtelProxyResource.java`,
      `${SRC}/OtelProxyUnreachable.java`,
      `${TST}/OtelProxyUnreachableTest.java`,
    ];
    const proj = detectFrameworks(p);
    // OtelProxyUnreachable.java wins at step 1 before OtelProxy[A-Z]* is ever tried
    expect(linkedSourcesOf(`${TST}/OtelProxyUnreachableTest.java`, proj, p)).toEqual([
      `${SRC}/OtelProxyUnreachable.java`,
    ]);
    expect(linkedTestsOf(`${SRC}/OtelProxyResource.java`, proj, p)).toEqual([]);
  });

  it('folds into neither source when the extension prefix matches two sources (ambiguous)', () => {
    const p = [
      'pom.xml',
      `${SRC}/OtelProxyResource.java`,
      `${SRC}/OtelProxyClient.java`,
      `${TST}/OtelProxyUnreachableTest.java`,
    ];
    const proj = detectFrameworks(p);
    expect(linkedSourcesOf(`${TST}/OtelProxyUnreachableTest.java`, proj, p)).toEqual([]);
    expect(linkedTestsOf(`${SRC}/OtelProxyResource.java`, proj, p)).toEqual([]);
    expect(linkedTestsOf(`${SRC}/OtelProxyClient.java`, proj, p)).toEqual([]);
  });

  it('never fuzzy-folds a test that shares only its first camel word with a source', () => {
    const p = ['pom.xml', `${SRC}/FooBaz.java`, `${TST}/FooBarTest.java`];
    const proj = detectFrameworks(p);
    // prefix FooBar has no exact/extension owner; the 1-word prefix Foo never fuzzy-claims
    expect(linkedSourcesOf(`${TST}/FooBarTest.java`, proj, p)).toEqual([]);
    expect(linkedTestsOf(`${SRC}/FooBaz.java`, proj, p)).toEqual([]);
  });

  it('folds a …QuarkusTest like any …Test (suffix stripped, then owned by exact prefix)', () => {
    const p = [
      'pom.xml',
      `${SRC}/GreetingResource.java`,
      `${TST}/GreetingResourceQuarkusTest.java`,
    ];
    const proj = detectFrameworks(p);
    expect(linkedSourcesOf(`${TST}/GreetingResourceQuarkusTest.java`, proj, p)).toEqual([
      `${SRC}/GreetingResource.java`,
    ]);
    expect(linkedTestsOf(`${SRC}/GreetingResource.java`, proj, p)).toEqual([
      `${TST}/GreetingResourceQuarkusTest.java`,
    ]);
  });

  it('opening any group member yields the identical fully-named strip (symmetric group)', () => {
    const p = [
      'pom.xml',
      `${SRC}/OtelProxyResource.java`,
      `${TST}/OtelProxyResourceTest.java`,
      `${TST}/OtelProxyUnreachableTest.java`,
    ];
    const proj = detectFrameworks(p);
    const fromSource = resolveLinkedGroup(`${SRC}/OtelProxyResource.java`, proj, p);
    const fromTest = resolveLinkedGroup(`${TST}/OtelProxyUnreachableTest.java`, proj, p);
    expect(fromTest).toEqual(fromSource);
    expect(fromSource.map((f) => f.path)).toEqual([
      `${SRC}/OtelProxyResource.java`,
      `${TST}/OtelProxyResourceTest.java`,
      `${TST}/OtelProxyUnreachableTest.java`,
    ]);
  });
});

describe('java label refinement (Quarkus peek)', () => {
  it('upgrades to Quarkus only when the pom content mentions quarkus', () => {
    const java = descriptor('java-quarkus');
    expect(java.refineLabel?.('<dependency>io.quarkus</dependency>')).toBe('Java / Quarkus');
    expect(java.refineLabel?.('<project>plain maven</project>')).toBeNull();
    expect(java.labelPeekMarker?.('')).toBe('pom.xml');
    expect(java.labelPeekMarker?.('service')).toBe('service/pom.xml');
  });
});
