import type { TreeNode } from '@/shared/components/tree/tree.types';

/** One compacted chain, reported so callers can keep expansion state coherent. */
export interface CompactedChain {
  /** Key of the surviving node: the deepest dir, or the file for a chain ending in a leaf. */
  key: string;
  /** Keys of the ancestor directories absorbed into the label, outermost first. */
  absorbedKeys: string[];
  /** True when the chain ends in a lone file (the surviving node is a leaf). */
  leaf: boolean;
}

export interface CompactFileTreeOptions {
  /** Joins the chain's segment labels. Default `' / '` (spaced, so it reads as a path). */
  separator?: string;
  /**
   * Optional collector, populated with one {@link CompactedChain} per compaction. Lets callers
   * mirror the absorbed ancestors' expansion state onto the compacted node, so a chain that
   * later splits (e.g. a filter change revealed a hidden sibling) re-opens right where the user
   * already was. A leaf-ending chain counts as open: its file is visible, which in an
   * uncompacted tree implies every ancestor is expanded.
   */
  chains?: CompactedChain[];
}

/**
 * Compacts single-child directory chains in a {@link buildFileTree} forest into one node whose
 * label joins the segments (`src` → `main` → `java` becomes `src / main / java`), the pattern
 * known from VS Code's "compact folders". A chain ending in a lone file compacts into a single
 * *leaf* row that opens the file directly. Compaction stops at any node with ≥ 2 children.
 *
 * The compacted node keeps the **deepest** chain node's `key`/`data`/`leaf`/`icon`, so selection
 * and expansion state (tracked by key in `ZardTreeService`) survive a chain forming or resolving
 * as filters change. Pure and non-mutating — meant to run as a derived step after every rebuild.
 */
export function compactFileTree<T>(
  nodes: TreeNode<T>[],
  options: CompactFileTreeOptions = {},
): TreeNode<T>[] {
  return compactForest(nodes, options.separator ?? ' / ', options.chains);
}

function compactForest<T>(
  nodes: TreeNode<T>[],
  separator: string,
  chains?: CompactedChain[],
): TreeNode<T>[] {
  return nodes.map((node) => compactNode(node, separator, chains));
}

function compactNode<T>(
  node: TreeNode<T>,
  separator: string,
  chains?: CompactedChain[],
): TreeNode<T> {
  if (node.leaf || !node.children?.length) return node;

  const labels = [node.label];
  const absorbedKeys: string[] = [];
  let deepest = node;
  while (!deepest.leaf && deepest.children?.length === 1) {
    absorbedKeys.push(deepest.key);
    deepest = deepest.children[0];
    labels.push(deepest.label);
  }

  if (deepest === node) {
    return { ...node, children: compactForest(node.children, separator, chains) };
  }

  const label = labels.join(separator);
  if (deepest.leaf || !deepest.children?.length) {
    chains?.push({ key: deepest.key, absorbedKeys, leaf: true });
    return { ...deepest, label };
  }
  chains?.push({ key: deepest.key, absorbedKeys, leaf: false });
  return { ...deepest, label, children: compactForest(deepest.children, separator, chains) };
}
