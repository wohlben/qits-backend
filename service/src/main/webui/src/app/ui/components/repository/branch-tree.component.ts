import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCircleAlert } from '@ng-icons/lucide';

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
  imports: [ZardTreeImports, BranchRowComponent, NgIcon],
  template: `
    <z-tree [zData]="nodes()" zExpandAll class="gap-2">
      <ng-template #nodeTemplate let-node let-level="level">
        <div class="flex flex-1 items-center gap-2">
          @if (level > 0 && node.data) {
            <div
              class="flex shrink-0 flex-col items-center justify-center font-mono text-[0.7rem] leading-none"
              [attr.title]="title(node.data)"
            >
              @if (canFastForward(node.data)) {
                <button
                  type="button"
                  class="cursor-pointer text-muted-foreground hover:text-foreground"
                  [attr.title]="'Fast-forward to ' + (node.data.parent ?? 'parent')"
                  (click)="fastForward.emit(node.data)"
                >
                  -{{ node.data.behind ?? 0 }}
                </button>
              } @else if (wouldConflict(node.data)) {
                <ng-icon
                  name="lucideCircleAlert"
                  class="size-3 text-destructive"
                  [attr.title]="
                    'Conflicts with ' +
                    (node.data.parent ?? 'parent') +
                    ' — cannot integrate without resolving merge conflicts'
                  "
                />
              } @else if ((node.data.behind ?? 0) > 0) {
                <!-- Diverged but a merge would apply cleanly: show the behind count as a quiet,
                     non-actionable hint (a fast-forward isn't possible, but there's no conflict). -->
                <span class="text-muted-foreground">-{{ node.data.behind ?? 0 }}</span>
              } @else {
                <span class="invisible">-{{ node.data.behind ?? 0 }}</span>
              }
              <span class="font-semibold text-foreground">+{{ node.data.ahead ?? 0 }}</span>
            </div>
          }
          <app-branch-row
            class="flex-1"
            [branch]="node.label"
            [worktree]="node.data ?? null"
            [hasChildren]="(node.children?.length ?? 0) > 0"
            [canCleanup]="cleanupable().has(node.label)"
            (viewCommits)="viewCommits.emit(node.label)"
            (viewTerminal)="viewTerminal.emit(node.label)"
            (branchOff)="branchOff.emit(node.label)"
            (integrate)="integrate.emit(node.label)"
            (abandon)="abandon.emit(node.data)"
            (cleanup)="cleanup.emit(node.label)"
            (delete)="delete.emit(node.label)"
          />
        </div>
      </ng-template>
    </z-tree>
  `,
  viewProviders: [provideIcons({ lucideCircleAlert })],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BranchTreeComponent {
  readonly nodes = input.required<BranchTreeNode[]>();
  /** Branch names that are safe to clean up (drives the per-row Cleanup action). */
  readonly cleanupable = input<ReadonlySet<string>>(new Set());
  readonly viewCommits = output<string>();
  readonly viewTerminal = output<string>();
  readonly branchOff = output<string>();
  readonly integrate = output<string>();
  readonly abandon = output<WorktreeDto>();
  readonly cleanup = output<string>();
  readonly delete = output<string>();
  readonly fastForward = output<WorktreeDto>();

  title(wt: WorktreeDto): string {
    return `${wt.ahead ?? 0} commit(s) ahead of ${wt.parent ?? 'parent'}, ${wt.behind ?? 0} behind`;
  }

  /** Behind the parent with no commits of its own — a clean fast-forward is possible. */
  canFastForward(wt: WorktreeDto): boolean {
    return (wt.behind ?? 0) > 0 && (wt.ahead ?? 0) === 0;
  }

  /**
   * Histories diverged (behind *and* ahead) *and* the server's trial merge found conflicts, so the
   * branch can't be integrated without manual resolution. Diverged branches that merge cleanly are
   * not flagged — only genuine conflicts warrant the warning.
   */
  wouldConflict(wt: WorktreeDto): boolean {
    return (wt.behind ?? 0) > 0 && (wt.ahead ?? 0) > 0 && wt.conflictsWithParent === true;
  }
}
