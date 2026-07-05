import type { IconName } from '@ng-icons/core';

import type { CommitFileChangeDto } from '@/api/model/commitFileChangeDto';
import type { TreeNode } from '@/shared/components/tree/tree.types';

/** A `z-tree` node whose leaves carry the file change they represent. */
export type FileTreeNode = TreeNode<CommitFileChangeDto>;

/** Anything with a slash-separated `path` can be laid out as a file tree. */
export interface HasPath {
  path?: string | null;
}

export interface BuildFileTreeOptions {
  /** Whether directory nodes start expanded. Default `true` (suits a small changed-files list). */
  expanded?: boolean;
  /** Whether to attach lucide `lucideFolder`/`lucideFile` icons to nodes. Default `false`. */
  icons?: boolean;
}

/**
 * Turns a flat list of files (each with a path like `src/app/foo.ts`) into the nested
 * directory/file forest `z-tree` renders. Intermediate directories become expandable branch nodes
 * (keyed by their full path so siblings never collide); each file is a leaf carrying its original
 * item as `data`. Directories sort before files, then alphabetically, so the tree reads like a file
 * explorer. Entries without a path are ignored.
 *
 * Used both for a commit's changed files (default: all expanded, no icons) and for browsing a whole
 * workspace (collapsed by default, with folder/file icons) — hence the {@link BuildFileTreeOptions}.
 */
export function buildFileTree<T extends HasPath>(
  files: T[],
  options: BuildFileTreeOptions = {},
): TreeNode<T>[] {
  const expanded = options.expanded ?? true;
  const icons = options.icons ?? false;

  const roots: TreeNode<T>[] = [];
  const dirs = new Map<string, TreeNode<T> & { children: TreeNode<T>[] }>();

  const ensureDir = (path: string, label: string, siblings: TreeNode<T>[]) => {
    let dir = dirs.get(path);
    if (!dir) {
      dir = {
        key: path,
        label,
        children: [],
        expanded,
        ...(icons ? { icon: 'lucideFolder' as IconName } : {}),
      };
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
      ...(icons ? { icon: 'lucideFile' as IconName } : {}),
    });
  }

  sortNodes(roots);
  return roots;
}

function sortNodes<T>(nodes: TreeNode<T>[]): void {
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
