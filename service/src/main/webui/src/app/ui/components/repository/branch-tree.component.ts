import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCircleAlert } from '@ng-icons/lucide';

import { CommitDto } from '@/api/model/commitDto';
import { WorktreeDto } from '@/api/model/worktreeDto';
import { ZardButtonComponent } from '@/shared/components/button';
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
    ZardButtonComponent,
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
              @if (wouldConflict(node.data)) {
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
                <!-- Behind the parent (clean): hovering or clicking the count opens the popover,
                     which holds the list of incoming commits and the integrate action in its footer.
                     Visibility is driven programmatically so the popover stays open while the cursor
                     moves onto it to reach that action. -->
                <button
                  type="button"
                  class="cursor-pointer text-muted-foreground hover:text-foreground"
                  [attr.title]="
                    (node.data.behind ?? 0) +
                    ' commit(s) to pull from ' +
                    (node.data.parent ?? 'parent')
                  "
                  zPopover
                  [zContent]="incomingTpl"
                  [zTrigger]="null"
                  zPlacement="top"
                  [zVisible]="openWorktreeId() === node.data.worktreeId"
                  (zVisibleChange)="onPeek(node.data, $event)"
                  (mouseenter)="openPopover(node.data)"
                  (mouseleave)="scheduleClose()"
                  (click)="openPopover(node.data)"
                >
                  -{{ node.data.behind ?? 0 }}
                </button>
              } @else {
                <span class="invisible">-{{ node.data.behind ?? 0 }}</span>
              }

              <!-- Popover listing the commits a fast-forward / merge would pull in, with the action
                   in its footer. Defined per node so it closes over the node; commits load lazily
                   when it opens. mouseenter/leave keep it open while the cursor is over it. -->
              <ng-template #incomingTpl>
                <z-popover
                  class="w-80 p-0"
                  (mouseenter)="cancelClose()"
                  (mouseleave)="scheduleClose()"
                >
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
                  <!-- The integrate action lives here now (moved off the count's click). -->
                  <div class="border-t p-2">
                    <button
                      z-button
                      zType="secondary"
                      zSize="sm"
                      class="w-full"
                      (click)="runAction(node.data)"
                    >
                      {{ actionLabel(node.data) }}
                    </button>
                  </div>
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

  /** The worktree whose popover is currently open (drives the popover's programmatic visibility). */
  readonly openWorktreeId = signal<string | null>(null);
  /** Pending close, so moving the cursor between the count and the popover doesn't close it. */
  private closeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.cancelClose());
  }

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

  /** Open the popover for a worktree (hover or click); cancels any pending close. */
  openPopover(wt: WorktreeDto): void {
    this.cancelClose();
    this.openWorktreeId.set(wt.worktreeId ?? null);
  }

  /** Close shortly, unless the cursor reaches the popover (which cancels it) first. */
  scheduleClose(): void {
    this.cancelClose();
    this.closeTimer = setTimeout(() => this.openWorktreeId.set(null), 150);
  }

  cancelClose(): void {
    if (this.closeTimer) {
      clearTimeout(this.closeTimer);
      this.closeTimer = null;
    }
  }

  /** The footer action label: a fast-forward when level, otherwise a merge of the parent in. */
  actionLabel(wt: WorktreeDto): string {
    const parent = wt.parent ?? 'parent';
    return this.canFastForward(wt) ? `Fast-forward to ${parent}` : `Merge ${parent} in`;
  }

  /** Run the footer action: fast-forward when possible, otherwise merge the parent in. */
  runAction(wt: WorktreeDto): void {
    if (this.canFastForward(wt)) {
      this.fastForward.emit(wt);
    } else {
      this.update.emit(wt);
    }
    this.cancelClose();
    this.openWorktreeId.set(null);
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
