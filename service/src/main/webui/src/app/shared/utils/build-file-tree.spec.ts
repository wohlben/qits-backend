import { CommitFileChangeDto } from '@/api/model/commitFileChangeDto';
import { buildFileTree, FileTreeNode } from './build-file-tree';

function file(path: string, changeType = 'MODIFIED', oldPath?: string): CommitFileChangeDto {
  return { path, changeType, oldPath };
}

describe('buildFileTree', () => {
  it('returns an empty forest for no files', () => {
    expect(buildFileTree([])).toEqual([]);
  });

  it('keeps a top-level file as a single leaf carrying its change', () => {
    const tree = buildFileTree([file('README.md', 'ADDED')]);

    expect(tree).toHaveLength(1);
    expect(tree[0].label).toBe('README.md');
    expect(tree[0].leaf).toBe(true);
    expect(tree[0].key).toBe('README.md');
    expect(tree[0].data).toEqual(file('README.md', 'ADDED'));
  });

  it('nests files under intermediate directories keyed by full path', () => {
    const tree = buildFileTree([file('src/app/foo.ts'), file('src/app/bar.ts')]);

    expect(tree).toHaveLength(1);
    const src = tree[0];
    expect(src.label).toBe('src');
    expect(src.key).toBe('src');
    expect(src.leaf).toBeFalsy();

    const app = src.children![0];
    expect(app.label).toBe('app');
    expect(app.key).toBe('src/app');
    expect(app.children!.map((c) => c.label)).toEqual(['bar.ts', 'foo.ts']);
    expect(app.children!.every((c) => c.leaf)).toBe(true);
  });

  it('reuses a shared directory node across files', () => {
    const tree = buildFileTree([file('src/a.ts'), file('src/b.ts'), file('src/sub/c.ts')]);

    expect(tree).toHaveLength(1);
    const src = tree[0];
    // sub-directory sorts before the two files
    expect(src.children!.map((c) => c.label)).toEqual(['sub', 'a.ts', 'b.ts']);
  });

  it('sorts directories before files, then alphabetically', () => {
    const tree = buildFileTree([file('z.txt'), file('a.txt'), file('dir/inner.txt')]);

    expect(tree.map((n) => n.label)).toEqual(['dir', 'a.txt', 'z.txt']);
  });

  it('preserves rename metadata on the leaf', () => {
    const tree = buildFileTree([file('new/name.ts', 'RENAMED', 'old/name.ts')]);

    const leaf = leafByPath(tree, 'new/name.ts');
    expect(leaf?.data?.changeType).toBe('RENAMED');
    expect(leaf?.data?.oldPath).toBe('old/name.ts');
  });

  it('ignores entries without a path', () => {
    const tree = buildFileTree([{ changeType: 'MODIFIED' }, file('kept.ts')]);

    expect(tree.map((n) => n.label)).toEqual(['kept.ts']);
  });
});

function leafByPath(nodes: FileTreeNode[], path: string): FileTreeNode | undefined {
  for (const node of nodes) {
    if (node.leaf && node.key === path) return node;
    if (node.children) {
      const found = leafByPath(node.children, path);
      if (found) return found;
    }
  }
  return undefined;
}
