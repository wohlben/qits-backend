import { buildFileTree } from './build-file-tree';
import { compactFileTree, type CompactedChain } from './compact-file-tree';

/** Builds the worktree-browser-style forest (collapsed, with icons) from plain paths. */
function forest(paths: string[]) {
  return buildFileTree(
    paths.map((path) => ({ path })),
    { expanded: false, icons: true },
  );
}

describe('compactFileTree', () => {
  it('returns an empty forest unchanged', () => {
    expect(compactFileTree([])).toEqual([]);
  });

  it('leaves a flat forest untouched', () => {
    const tree = compactFileTree(forest(['a.ts', 'b.ts']));

    expect(tree.map((n) => n.label)).toEqual(['a.ts', 'b.ts']);
  });

  it('compacts a single-child directory chain into one node keyed by the deepest dir', () => {
    const tree = compactFileTree(forest(['src/main/java/A.java', 'src/main/java/B.java']));

    expect(tree).toHaveLength(1);
    const chain = tree[0];
    expect(chain.label).toBe('src / main / java');
    expect(chain.key).toBe('src/main/java');
    expect(chain.leaf).toBeFalsy();
    expect(chain.children!.map((c) => c.label)).toEqual(['A.java', 'B.java']);
  });

  it('compacts a chain ending in a lone file into a single leaf', () => {
    const tree = compactFileTree(forest(['docs/adr/001.md']));

    expect(tree).toHaveLength(1);
    const leaf = tree[0];
    expect(leaf.label).toBe('docs / adr / 001.md');
    expect(leaf.key).toBe('docs/adr/001.md');
    expect(leaf.leaf).toBe(true);
    expect(leaf.data).toEqual({ path: 'docs/adr/001.md' });
    expect(leaf.children).toBeUndefined();
  });

  it('stops compacting at a node with two or more children and resumes below', () => {
    const tree = compactFileTree(
      forest(['src/main/java/A.java', 'src/main/resources/app.properties']),
    );

    // `src / main` compacts, then splits into java/resources, each of which compacts on its own.
    expect(tree).toHaveLength(1);
    const main = tree[0];
    expect(main.label).toBe('src / main');
    expect(main.key).toBe('src/main');
    expect(main.children!.map((c) => c.label)).toEqual([
      'java / A.java',
      'resources / app.properties',
    ]);
  });

  it('compacts chains that start below an uncompacted branch node', () => {
    const tree = compactFileTree(forest(['a/x.ts', 'a/deep/nested/y.ts']));

    const a = tree[0];
    expect(a.label).toBe('a');
    expect(a.children!.map((c) => c.label)).toEqual(['deep / nested / y.ts', 'x.ts']);
    expect(a.children![0].key).toBe('a/deep/nested/y.ts');
  });

  it('keeps the folder icon on a dir chain and the file icon on a file-ending chain', () => {
    const tree = compactFileTree(forest(['src/main/A.java', 'src/main/B.java', 'docs/readme.md']));

    const dirChain = tree.find((n) => n.label === 'src / main')!;
    const fileChain = tree.find((n) => n.label === 'docs / readme.md')!;
    expect(dirChain.icon).toBe('lucideFolder');
    expect(fileChain.icon).toBe('lucideFile');
  });

  it('honours a custom separator', () => {
    const tree = compactFileTree(forest(['a/b/c.ts', 'a/b/d.ts']), { separator: '›' });

    expect(tree[0].label).toBe('a›b');
  });

  it('collects one chain entry per compaction, absorbed ancestor keys outermost first', () => {
    const chains: CompactedChain[] = [];
    compactFileTree(
      forest(['src/main/java/A.java', 'src/main/java/B.java', 'docs/adr/001.md']),
      { chains },
    );

    expect(chains).toEqual([
      { key: 'docs/adr/001.md', absorbedKeys: ['docs', 'docs/adr'], leaf: true },
      { key: 'src/main/java', absorbedKeys: ['src', 'src/main'], leaf: false },
    ]);
  });

  it('does not mutate the input forest', () => {
    const input = forest(['src/main/java/A.java']);
    const snapshot = structuredClone(input);

    compactFileTree(input);

    expect(input).toEqual(snapshot);
  });
});
