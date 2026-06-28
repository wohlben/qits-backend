import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCircleAlert } from '@ng-icons/lucide';

import { CommitDto } from '@/api/model/commitDto';
import { WorktreeDto } from '@/api/model/worktreeDto';
import { ZardPopoverComponent, ZardPopoverDirective } from '@/shared/components/popover';
import { ZardTreeImports } from '@/shared/components/tree/tree.imports';
import { TreeNode } from '@/shared/components/tree/tree.types';
import { BranchRowComponent } from './branch-row.component';

export type BranchTreeNode = TreeNode<WorktreeDto | null>;

/** The commits a worktree would pull in from its parent, for the hover popover. */
export interface IncomingCommits {
  worktreeId: string;
  commits: CommitDto[];
}

/**
 * Renders the worktree forest with zard's `z-tree`, which owns the nesting:
 * recursion, per-level indentation, expand/collapse and tree a11y. Each node's
 * `#nodeTemplate` hosts our branch card plus, for nested nodes, the commit-count
 * connector — `behind` above (hidden when the branch isn't behind its parent),
 * `ahead` below (always, `+0` when level). Events bubble to the smart parent.
 */
@Component({
  selector: 'app-branch-tree',
  imports: [
    ZardTreeImports,
    BranchRowComponent,
    NgIcon,
    ZardPopoverDirective,
    ZardPopoverComponent,
    DatePipe,
  ],
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
                  zPopover
                  [zContent]="incomingTpl"
                  zTrigger="hover"
                  zPlacement="top"
                  (zVisibleChange)="onPeek(node.data, $event)"
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
                <!-- Diverged but a merge applies cleanly: a fast-forward can't (the branch has its
                     own commits), but merging the parent in catches it up. -->
                <button
                  type="button"
                  class="cursor-pointer text-muted-foreground hover:text-foreground"
                  [attr.title]="
                    'Merge ' + (node.data.parent ?? 'parent') + ' in to catch up (no fast-forward)'
                  "
                  zPopover
                  [zContent]="incomingTpl"
                  zTrigger="hover"
                  zPlacement="top"
                  (zVisibleChange)="onPeek(node.data, $event)"
                  (click)="update.emit(node.data)"
                >
                  -{{ node.data.behind ?? 0 }}
                </button>
              } @else {
                <span class="invisible">-{{ node.data.behind ?? 0 }}</span>
              }

              <!-- Hover popover listing the commits a fast-forward / merge would pull in. Defined
                   per node so it closes over the node; loaded lazily when the popover opens. -->
              <ng-template #incomingTpl>
                <z-popover class="w-80 p-0">
                  <div class="border-b px-3 py-2 text-xs font-medium">
                    Commits to pull from {{ node.data.parent ?? 'parent' }}
                  </div>
                  @if (incomingFor(node.data); as commits) {
                    @if (commits.length === 0) {
                      <div class="px-3 py-2 text-sm text-muted-foreground">Already up to date</div>
                    } @else {
                      <ul class="max-h-64 overflow-auto py-1">
                        @for (c of commits; track c.hash) {
                          <li class="flex items-start gap-2 px-3 py-1.5 text-sm">
                            <span class="shrink-0 font-mono text-xs text-muted-foreground">
                              {{ c.shortHash }}
                            </span>
                            <span class="flex min-w-0 flex-1 flex-col">
                              <span class="truncate">{{ c.message }}</span>
                              @if (c.date) {
                                <span class="text-xs text-muted-foreground">
                                  {{ c.author }} · {{ c.date | date: 'short' }}
                                </span>
                              }
                            </span>
                          </li>
                        }
                      </ul>
                    }
                  } @else {
                    <div class="px-3 py-2 text-sm text-muted-foreground">Loading commits…</div>
                  }
                </z-popover>
              </ng-template>
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
  /** Merge the parent into a diverged-but-cleanly-mergeable worktree to catch it up. */
  readonly update = output<WorktreeDto>();
  /** The commits to pull in for the currently-hovered worktree (loaded lazily by the parent). */
  readonly incoming = input<IncomingCommits | null>(null);
  /** Emitted when a behind-count popover opens, so the parent can fetch that worktree's commits. */
  readonly peek = output<WorktreeDto>();

  /** Commits to pull in for {@code wt}, or null while they're still loading for this worktree. */
  incomingFor(wt: WorktreeDto): CommitDto[] | null {
    const inc = this.incoming();
    return inc && inc.worktreeId === wt.worktreeId ? inc.commits : null;
  }

  onPeek(wt: WorktreeDto, visible: boolean): void {
    if (visible) {
      this.peek.emit(wt);
    }
  }

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
