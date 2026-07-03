import type { IconName } from '@ng-icons/core';

export interface TreeNode<T> {
  key: string;
  label: string;
  data?: T;
  icon?: IconName;
  children?: TreeNode<T>[];
  expanded?: boolean;
  selected?: boolean;
  checked?: boolean;
  disabled?: boolean;
  leaf?: boolean;
  /**
   * A lazily-resolvable directory stub whose contents are fetched on demand. Compaction treats it
   * as a boundary (never folds it into a chain), and its lone placeholder child exists only to give
   * it an expansion chevron until its real children arrive.
   */
  lazy?: boolean;
}

export interface TreeNodeTemplateContext<T = unknown> {
  $implicit: TreeNode<T>;
  level: number;
}

export type TreeCheckState = 'checked' | 'unchecked' | 'indeterminate';

export interface FlatTreeNode<T> {
  node: TreeNode<T>;
  level: number;
  expandable: boolean;
  index: number;
}
