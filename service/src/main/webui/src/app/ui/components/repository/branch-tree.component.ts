import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCircleAlert, lucideX } from '@ng-icons/lucide';

import { CommitDto } from '@/api/model/commitDto';
import { WorktreeDto } from '@/api/model/worktreeDto';
import { ZardButtonComponent } from '@/shared/components/button';
import { ZardPopoverComponent, ZardPopoverDirective } from '@/shared/components/popover';
import { ZardTabComponent, ZardTabGroupComponent } from '@/shared/components/tabs';
import { ZardTreeImports } from '@/shared/components/tree/tree.imports';
import { TreeNode } from '@/shared/components/tree/tree.types';
import { BranchRowComponent } from './branch-row.component';

export type BranchTreeNode = TreeNode<WorktreeDto | null>;

/** The commits shown in a worktree's popover: incoming (to pull) and outgoing (this branch's own). */
export interface CommitsPreview {
  worktreeId: string;
  /** Commits the parent has that this branch lacks — what a fast-forward/merge would pull in. */
  incoming: CommitDto[];
  /** Commits this branch has that the parent lacks — the branch's own work (the `+` count). */
  outgoing: CommitDto[];
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
    ZardTabGroupComponent,
    ZardTabComponent,
    DatePipe,
    NgTemplateOutlet,
  ],
  template: `
    <z-tree [zData]="nodes()" zExpandAll class="gap-2">
      <ng-template #nodeTemplate let-node let-level="level">
        <div class="flex flex-1 items-center gap-2">
          @if (level > 0 && node.data) {
            @if (wouldConflict(node.data)) {
              <div
                class="flex shrink-0 flex-col items-center justify-center font-mono text-[0.7rem] leading-none"
                [attr.title]="title(node.data)"
              >
                <ng-icon
                  name="lucideCircleAlert"
                  class="size-3 text-destructive"
                  [attr.title]="
                    'Conflicts with ' +
                    (node.data.parent ?? 'parent') +
                    ' — cannot integrate without resolving merge conflicts'
                  "
                />
                <span class="font-semibold text-foreground">+{{ node.data.ahead ?? 0 }}</span>
              </div>
            } @else if ((node.data.behind ?? 0) > 0 || (node.data.ahead ?? 0) > 0) {
              <!-- Clicking the count toggles a tabbed popover (Behind / Forward) with the integrate
                   action pinned at the bottom. It stays open until the × (or another click on the
                   count) — no hover, since closing on mouse-leave was disruptive. -->
              <button
                type="button"
                class="flex shrink-0 cursor-pointer flex-col items-center justify-center font-mono text-[0.7rem] leading-none text-muted-foreground hover:text-foreground"
                [attr.title]="title(node.data)"
                zPopover
                [zContent]="commitsTpl"
                [zTrigger]="null"
                zPlacement="top"
                [zVisible]="openWorktreeId() === node.data.worktreeId"
                (zVisibleChange)="onPeek(node.data, $event)"
                (click)="togglePopover(node.data)"
              >
                @if ((node.data.behind ?? 0) > 0) {
                  <span>-{{ node.data.behind ?? 0 }}</span>
                } @else {
                  <span class="invisible">-0</span>
                }
                <span class="font-semibold text-foreground">+{{ node.data.ahead ?? 0 }}</span>
              </button>
            } @else {
              <div
                class="flex shrink-0 flex-col items-center justify-center font-mono text-[0.7rem] leading-none text-muted-foreground"
                [attr.title]="title(node.data)"
              >
                <span class="invisible">-0</span>
                <span class="font-semibold text-foreground">+{{ node.data.ahead ?? 0 }}</span>
              </div>
            }

            <!-- Tabbed popover: Behind (commits to pull) / Forward (this branch's own commits),
                 with the integrate action at the bottom. The Behind tab is rendered first so it is
                 the default when present; otherwise Forward is the only (and default) tab. Defined
                 per node so it closes over the node; commits load lazily when it opens. -->
            <ng-template #commitsTpl>
              <z-popover class="relative w-80 p-0">
                <!-- Explicit close, vertically centered on the tab strip (~33px tall) on the right. -->
                <button
                  type="button"
                  class="absolute right-1 top-0.5 z-10 flex size-8 cursor-pointer items-center justify-center rounded text-muted-foreground hover:text-foreground"
                  aria-label="Close"
                  (click)="closePopover()"
                >
                  <ng-icon name="lucideX" class="size-4" />
                </button>
                <!-- Tabs share the width equally (grow from a 0 basis) and leave room on the right
                     for the × button. The tab buttons live inside the [role=tablist] nav (z-button
                     renders role=button). -->
                <z-tab-group
                  class="[&_[role=tablist]]:pr-8 [&_[role=tablist]_button]:grow [&_[role=tablist]_button]:basis-0"
                >
                  @if ((node.data.behind ?? 0) > 0) {
                    <z-tab [label]="'Behind · -' + (node.data.behind ?? 0)">
                      @if (incomingFor(node.data); as commits) {
                        @if (commits.length === 0) {
                          <div class="px-3 py-2 text-sm text-muted-foreground">
                            Already up to date
                          </div>
                        } @else {
                          <ng-container
                            [ngTemplateOutlet]="commitList"
                            [ngTemplateOutletContext]="{ $implicit: commits }"
                          />
                        }
                      } @else {
                        <div class="px-3 py-2 text-sm text-muted-foreground">Loading commits…</div>
                      }
                      <!-- Pull the parent's commits in (fast-forward or merge). -->
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
                    </z-tab>
                  }
                  @if ((node.data.ahead ?? 0) > 0) {
                    <z-tab [label]="'Forward · +' + (node.data.ahead ?? 0)">
                      @if (outgoingFor(node.data); as commits) {
                        @if (commits.length === 0) {
                          <div class="px-3 py-2 text-sm text-muted-foreground">No commits yet</div>
                        } @else {
                          <ng-container
                            [ngTemplateOutlet]="commitList"
                            [ngTemplateOutletContext]="{ $implicit: commits }"
                          />
                        }
                      } @else {
                        <div class="px-3 py-2 text-sm text-muted-foreground">Loading commits…</div>
                      }
                      <!-- Integrate this branch's commits into a target (defaults to the main branch). -->
                      <div class="border-t p-2">
                        <button
                          z-button
                          zType="secondary"
                          zSize="sm"
                          class="w-full"
                          (click)="runIntegrate(node.label)"
                        >
                          Integrate
                        </button>
                      </div>
                    </z-tab>
                  }
                </z-tab-group>
              </z-popover>
            </ng-template>

            <!-- Shared renderer for a commit list, reused for the Behind and Forward tabs. -->
            <ng-template #commitList let-commits>
              <ul class="max-h-48 overflow-auto py-1">
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
            </ng-template>
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
  viewProviders: [provideIcons({ lucideCircleAlert, lucideX })],
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
  /** The incoming/outgoing commits for the currently-open worktree (loaded lazily by the parent). */
  readonly commitsPreview = input<CommitsPreview | null>(null);
  /** Emitted when a behind-count popover opens, so the parent can fetch that worktree's commits. */
  readonly peek = output<WorktreeDto>();

  /** The worktree whose popover is currently open (drives the popover's programmatic visibility). */
  readonly openWorktreeId = signal<string | null>(null);

  /** Commits to pull in for {@code wt}, or null while they're still loading for this worktree. */
  incomingFor(wt: WorktreeDto): CommitDto[] | null {
    const preview = this.commitsPreview();
    return preview && preview.worktreeId === wt.worktreeId ? preview.incoming : null;
  }

  /** This branch's own commits over its parent (the `+` count), or null while still loading. */
  outgoingFor(wt: WorktreeDto): CommitDto[] | null {
    const preview = this.commitsPreview();
    return preview && preview.worktreeId === wt.worktreeId ? preview.outgoing : null;
  }

  onPeek(wt: WorktreeDto, visible: boolean): void {
    if (visible) {
      this.peek.emit(wt);
    }
  }

  /** Toggle the popover open/closed for a worktree (the count is click-only — no hover). */
  togglePopover(wt: WorktreeDto): void {
    this.openWorktreeId.set(
      this.openWorktreeId() === wt.worktreeId ? null : (wt.worktreeId ?? null),
    );
  }

  /** Close the popover (the explicit × button, and after running the action). */
  closePopover(): void {
    this.openWorktreeId.set(null);
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
    this.closePopover();
  }

  /** Integrate this branch into a target (the Forward tab's action); the parent opens the dialog. */
  runIntegrate(branch: string): void {
    this.integrate.emit(branch);
    this.closePopover();
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
