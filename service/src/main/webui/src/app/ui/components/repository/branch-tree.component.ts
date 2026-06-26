import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

import { WorktreeDto } from '@/api/model/worktreeDto';
import { ZardTreeImports } from '@/shared/components/tree/tree.imports';
import { TreeNode } from '@/shared/components/tree/tree.types';
import { BranchRowComponent } from './branch-row.component';

export type BranchTreeNode = TreeNode<WorktreeDto | null>;

/**
 * Renders the worktree forest with zard's `z-tree`, which owns the nesting:
 * recursion, per-level indentation, expand/collapse and tree a11y. Each node's
 * `#nodeTemplate` hosts our branch card plus, for nested nodes, the commit-count
 * connector — `behind` above (hidden when the branch isn't behind its parent),
 * `ahead` below (always, `+0` when level). Events bubble to the smart parent.
 */
@Component({
  selector: 'app-branch-tree',
  imports: [ZardTreeImports, BranchRowComponent],
  template: `
    <z-tree [zData]="nodes()" zExpandAll class="gap-2">
      <ng-template #nodeTemplate let-node let-level="level">
        <div class="flex flex-1 items-center gap-2">
          @if (level > 0 && node.data) {
            <div
              class="flex shrink-0 flex-col items-center justify-center font-mono text-[0.7rem] leading-none"
              [attr.title]="title(node.data)"
            >
              <span class="text-muted-foreground" [class.invisible]="(node.data.behind ?? 0) === 0">
                -{{ node.data.behind ?? 0 }}
              </span>
              <span class="font-semibold text-foreground">+{{ node.data.ahead ?? 0 }}</span>
            </div>
          }
          <app-branch-row
            class="flex-1"
            [branch]="node.label"
            [worktree]="node.data ?? null"
            [hasChildren]="(node.children?.length ?? 0) > 0"
            (viewCommits)="viewCommits.emit(node.label)"
            (viewTerminal)="viewTerminal.emit(node.label)"
            (branchOff)="branchOff.emit(node.label)"
            (integrate)="integrate.emit(node.data)"
            (abandon)="abandon.emit(node.data)"
            (delete)="delete.emit(node.label)"
          />
        </div>
      </ng-template>
    </z-tree>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BranchTreeComponent {
  readonly nodes = input.required<BranchTreeNode[]>();
  readonly viewCommits = output<string>();
  readonly viewTerminal = output<string>();
  readonly branchOff = output<string>();
  readonly integrate = output<WorktreeDto>();
  readonly abandon = output<WorktreeDto>();
  readonly delete = output<string>();

  title(wt: WorktreeDto): string {
    return `${wt.ahead ?? 0} commit(s) ahead of ${wt.parent ?? 'parent'}, ${wt.behind ?? 0} behind`;
  }
}
