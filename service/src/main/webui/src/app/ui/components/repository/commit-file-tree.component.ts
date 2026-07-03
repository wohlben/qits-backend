import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

import { CommitFileChangeDto } from '@/api/model/commitFileChangeDto';
import { ZardTreeImports } from '@/shared/components/tree/tree.imports';
import { FileTreeNode } from '@/shared/utils/build-file-tree';

/**
 * Renders the changed-file forest with zard's `z-tree` (it owns nesting, indentation,
 * expand/collapse and a11y). Each file leaf shows a one-letter change badge (A/M/D/R/…);
 * clicking a file bubbles its {@link CommitFileChangeDto} to the smart parent. Directory
 * nodes only toggle and emit nothing.
 */
@Component({
  selector: 'app-commit-file-tree',
  imports: [ZardTreeImports],
  template: `
    <!-- w-max lets rows take their natural width so long (compacted) labels are reachable via
         the parent's horizontal scroll instead of being truncated -->
    <z-tree
      class="w-max min-w-full"
      [zData]="nodes()"
      zExpandAll
      zSelectable
      (zNodeClick)="onNodeClick($event)"
    >
      <ng-template #nodeTemplate let-node>
        <div class="flex flex-1 items-center gap-2">
          @if (node.leaf && node.data) {
            <span
              class="inline-flex w-4 shrink-0 justify-center font-mono text-xs font-bold"
              [class]="statusClass(node.data.changeType)"
              [attr.title]="node.data.changeType"
            >
              {{ statusLetter(node.data.changeType) }}
            </span>
            <span class="truncate text-sm">{{ node.label }}</span>
          } @else {
            <span class="truncate text-sm font-medium">{{ node.label }}</span>
          }
        </div>
      </ng-template>
    </z-tree>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommitFileTreeComponent {
  readonly nodes = input.required<FileTreeNode[]>();
  readonly fileClick = output<CommitFileChangeDto>();

  onNodeClick(node: FileTreeNode) {
    if (node.leaf && node.data) {
      this.fileClick.emit(node.data);
    }
  }

  statusLetter(changeType?: string): string {
    return (changeType ?? 'M').charAt(0);
  }

  statusClass(changeType?: string): string {
    switch (changeType) {
      case 'ADDED':
        return 'text-emerald-600 dark:text-emerald-400';
      case 'DELETED':
        return 'text-destructive';
      case 'RENAMED':
      case 'COPIED':
        return 'text-blue-600 dark:text-blue-400';
      case 'TYPE_CHANGED':
        return 'text-muted-foreground';
      default:
        return 'text-amber-600 dark:text-amber-400';
    }
  }
}
