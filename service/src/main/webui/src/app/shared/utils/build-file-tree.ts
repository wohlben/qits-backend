import type { CommitFileChangeDto } from '@/api/model/commitFileChangeDto';
import type { TreeNode } from '@/shared/components/tree/tree.types';

/** A `z-tree` node whose leaves carry the file change they represent. */
export type FileTreeNode = TreeNode<CommitFileChangeDto>;

interface DirNode extends FileTreeNode {
  children: FileTreeNode[];
}

/**
 * Turns a flat list of changed files (paths like `src/app/foo.ts`) into the nested
 * directory/file forest `z-tree` renders. Intermediate directories become expandable
 * branch nodes (keyed by their full path so siblings never collide); each file is a
 * leaf carrying its {@link CommitFileChangeDto} as `data`. Directories sort before
 * files, then alphabetically, so the tree reads like a file explorer.
 */
export function buildFileTree(files: CommitFileChangeDto[]): FileTreeNode[] {
  const roots: FileTreeNode[] = [];
  const dirs = new Map<string, DirNode>();

  const ensureDir = (path: string, label: string, siblings: FileTreeNode[]): DirNode => {
    let dir = dirs.get(path);
    if (!dir) {
      dir = { key: path, label, children: [], expanded: true };
      dirs.set(path, dir);
      siblings.push(dir);
    }
    return dir;
  };

  for (const file of files) {
    const fullPath = file.path ?? '';
    if (!fullPath) continue;

    const segments = fullPath.split('/');
    let siblings = roots;
    let prefix = '';
    for (let i = 0; i < segments.length - 1; i++) {
      prefix = prefix ? `${prefix}/${segments[i]}` : segments[i];
      siblings = ensureDir(prefix, segments[i], siblings).children;
    }

    siblings.push({
      key: fullPath,
      label: segments[segments.length - 1],
      data: file,
      leaf: true,
    });
  }

  sortNodes(roots);
  return roots;
}

function sortNodes(nodes: FileTreeNode[]): void {
  nodes.sort((a, b) => {
    const aIsDir = !a.leaf;
    const bIsDir = !b.leaf;
    if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
    return a.label.localeCompare(b.label);
  });
  for (const node of nodes) {
    if (node.children?.length) sortNodes(node.children);
  }
}
