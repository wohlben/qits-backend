import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
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

/** Per-branch ahead/behind vs its parent — supplied for branches without a worktree (the parent is
 * the repository's main branch). Worktree-backed branches get this from their {@link WorktreeDto}. */
export interface BranchSummary {
  parent: string | null;
  ahead: number | null;
  behind: number | null;
}

/** The commits shown in a branch's popover: incoming (to pull) and outgoing (this branch's own). */
export interface CommitsPreview {
  branch: string;
  /** Commits the parent has that this branch lacks — what a fast-forward/merge would pull in. */
  incoming: CommitDto[];
  /** Commits this branch has that the parent lacks — the branch's own work (the `+` count). */
  outgoing: CommitDto[];
}

/** Normalized view of a node for the connector/popover, unifying worktree and plain branches. */
interface NodeSummary {
  branch: string;
  parent: string;
  ahead: number;
  behind: number;
  conflictsWithParent: boolean;
  /** The backing worktree, or null for a plain branch (no in-place pull, integrate-only). */
  worktree: WorktreeDto | null;
}

/**
 * Renders the branch forest with zard's `z-tree`, which owns the nesting: recursion, per-level
 * indentation, expand/collapse and tree a11y. Each node's `#nodeTemplate` hosts our branch card
 * plus, for branches with a parent, the commit-count connector — `behind` above, `ahead` below —
 * which opens a tabbed commits popover. Events bubble to the smart parent.
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
    RouterLink,
  ],
  template: `
    <z-tree [zData]="nodes()" zExpandAll class="gap-2">
      <ng-template #nodeTemplate let-node>
        <div class="flex flex-1 items-center gap-2">
          @if (nodeSummary(node); as s) {
            @if (showConflict(s)) {
              <!-- Clicking the conflict marker opens the resolve dialog: it forks a worktree and
                   has Claude merge the parent in and fix the conflicts. -->
              <button
                type="button"
                class="flex shrink-0 cursor-pointer flex-col items-center justify-center font-mono text-[0.7rem] leading-none hover:opacity-80"
                [attr.title]="
                  'Conflicts with ' + s.parent + ' — click to resolve the merge conflict with Claude'
                "
                (click)="resolveConflict.emit(s.worktree!)"
              >
                <ng-icon name="lucideCircleAlert" class="size-3 text-destructive" />
                <span class="font-semibold text-foreground">+{{ s.ahead }}</span>
              </button>
            } @else if (hasTrigger(s)) {
              <!-- Clicking the count toggles a tabbed popover (Behind / Forward) with the integrate
                   action pinned at the bottom. It stays open until the × (or another click on the
                   count) — no hover, since closing on mouse-leave was disruptive. -->
              <button
                type="button"
                class="flex shrink-0 cursor-pointer flex-col items-center justify-center font-mono text-[0.7rem] leading-none text-muted-foreground hover:text-foreground"
                [attr.title]="summaryTitle(s)"
                zPopover
                [zContent]="commitsTpl"
                [zTrigger]="null"
                zPlacement="top"
                [zVisible]="openBranch() === s.branch"
                (zVisibleChange)="onPeek(s.branch, $event)"
                (click)="togglePopover(s.branch)"
              >
                @if (s.worktree && s.behind > 0) {
                  <span>-{{ s.behind }}</span>
                } @else {
                  <span class="invisible">-0</span>
                }
                <span class="font-semibold text-foreground">+{{ s.ahead }}</span>
              </button>
            } @else {
              <div
                class="flex shrink-0 flex-col items-center justify-center font-mono text-[0.7rem] leading-none text-muted-foreground"
                [attr.title]="summaryTitle(s)"
              >
                <span class="invisible">-0</span>
                <span class="font-semibold text-foreground">+{{ s.ahead }}</span>
              </div>
            }

            <!-- Tabbed popover: Behind (commits to pull, worktree-backed only) / Forward (this
                 branch's own commits). Behind is rendered first so it is the default when present;
                 otherwise Forward is the only (and default) tab. Defined per node so it closes over
                 the node; commits load lazily when it opens. -->
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
                  @if (s.worktree && s.behind > 0) {
                    <z-tab [label]="s.behind + ' behind'">
                      @if (incomingFor(s.branch); as commits) {
                        @if (commits.length === 0) {
                          <div class="px-3 py-2 text-sm text-muted-foreground">
                            Already up to date
                          </div>
                        } @else {
                          <ng-container
                            [ngTemplateOutlet]="commitList"
                            [ngTemplateOutletContext]="{ $implicit: commits, branch: s.parent }"
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
                          (click)="runAction(s.worktree)"
                        >
                          {{ actionLabel(s.worktree) }}
                        </button>
                      </div>
                    </z-tab>
                  }
                  @if (s.ahead > 0) {
                    <z-tab [label]="s.ahead + ' forward'">
                      @if (outgoingFor(s.branch); as commits) {
                        @if (commits.length === 0) {
                          <div class="px-3 py-2 text-sm text-muted-foreground">No commits yet</div>
                        } @else {
                          <ng-container
                            [ngTemplateOutlet]="commitList"
                            [ngTemplateOutletContext]="{ $implicit: commits, branch: s.branch }"
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
                          (click)="runIntegrate(s.branch)"
                        >
                          Integrate
                        </button>
                      </div>
                    </z-tab>
                  }
                </z-tab-group>
              </z-popover>
            </ng-template>

            <!-- Shared renderer for a commit list, reused for the Behind and Forward tabs. The list
                 scrolls within itself when tall. Each row links to the commit's detail view, in the
                 context of the branch it belongs to (the parent for incoming commits, this branch
                 for outgoing ones), and shows: hash · author · date, the subject, then the files the
                 commit changed, one per line. -->
            <ng-template #commitList let-commits let-branch="branch">
              <ul class="max-h-80 overflow-auto py-1">
                @for (c of commits; track c.hash) {
                  <li>
                    <a
                      class="flex w-full flex-col gap-1 px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                      [routerLink]="[
                        '/repositories',
                        repoId(),
                        'branch',
                        branch,
                        'commits',
                        c.hash,
                      ]"
                    >
                      <span class="flex items-baseline gap-2 text-xs text-muted-foreground">
                        <span class="font-mono">{{ c.shortHash }}</span>
                        <span class="min-w-0 flex-1 truncate">{{ c.author }}</span>
                        @if (c.date) {
                          <span class="shrink-0">{{ c.date | date: 'short' }}</span>
                        }
                      </span>
                      <span class="break-words">{{ c.message }}</span>
                      @if (c.files?.length) {
                        <ul class="font-mono text-xs text-muted-foreground">
                          @for (f of c.files ?? []; track f) {
                            <li class="truncate">{{ f }}</li>
                          }
                        </ul>
                      }
                    </a>
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
            [claudeConfigurable]="claudeConfigurable()"
            (viewCommits)="viewCommits.emit(node.label)"
            (ensureContainer)="ensureContainer.emit(node.data!)"
            (stopContainer)="stopContainer.emit(node.data!)"
            (openWorktree)="openWorktree.emit(node.data!)"
            (run)="run.emit(node.label)"
            (configureWithClaude)="configureWithClaude.emit(node.label)"
            (branchOff)="branchOff.emit(node.label)"
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
  /** The repository id, used to build commit-detail router links from the popover. */
  readonly repoId = input.required<string>();
  /** Branch names that are safe to clean up (drives the per-row Cleanup action). */
  readonly cleanupable = input<ReadonlySet<string>>(new Set());
  /** Whether the per-subtree "Configure with Claude" button is offered (repository-MCP action exists). */
  readonly claudeConfigurable = input(false);
  /** Per-branch ahead/behind vs parent, keyed by branch name — used for branches with no worktree. */
  readonly branchSummaries = input<Record<string, BranchSummary>>({});
  readonly viewCommits = output<string>();
  /** Start/recreate a worktree's container (carries the worktree). */
  readonly ensureContainer = output<WorktreeDto>();
  /** Gracefully stop a worktree's container (carries the worktree). */
  readonly stopContainer = output<WorktreeDto>();
  /** Open a worktree's detail page (carries the worktree). */
  readonly openWorktree = output<WorktreeDto>();
  /** Open the "Run…" dialog for a worktree-backed branch (carries the branch name). */
  readonly run = output<string>();
  /** Launch the repository-MCP Claude action in a subtree's terminal (carries the branch name). */
  readonly configureWithClaude = output<string>();
  readonly branchOff = output<string>();
  /** Open the resolve-conflict flow for a conflicting worktree (carries the worktree). */
  readonly resolveConflict = output<WorktreeDto>();
  readonly integrate = output<string>();
  readonly abandon = output<WorktreeDto>();
  readonly cleanup = output<string>();
  readonly delete = output<string>();
  readonly fastForward = output<WorktreeDto>();
  /** Merge the parent into a diverged-but-cleanly-mergeable worktree to catch it up. */
  readonly update = output<WorktreeDto>();
  /** The incoming/outgoing commits for the currently-open branch (loaded lazily by the parent). */
  readonly commitsPreview = input<CommitsPreview | null>(null);
  /** Emitted when a branch's popover opens, so the parent can fetch that branch's commits. */
  readonly peek = output<string>();

  /** The branch whose popover is currently open (drives the popover's programmatic visibility). */
  readonly openBranch = signal<string | null>(null);

  /**
   * Normalizes a node into a {@link NodeSummary}, or null when there's nothing to compare (the main
   * branch, or a branch with no resolvable parent). Worktree-backed branches use their worktree;
   * plain branches use {@link branchSummaries} with the main branch as their parent.
   */
  nodeSummary(node: BranchTreeNode): NodeSummary | null {
    const wt = node.data;
    if (wt) {
      if (!wt.parent) return null;
      return {
        branch: node.label,
        parent: wt.parent,
        ahead: wt.ahead ?? 0,
        behind: wt.behind ?? 0,
        conflictsWithParent: wt.conflictsWithParent === true,
        worktree: wt,
      };
    }
    const s = this.branchSummaries()[node.label];
    if (!s || !s.parent) return null;
    return {
      branch: node.label,
      parent: s.parent,
      ahead: s.ahead ?? 0,
      behind: s.behind ?? 0,
      conflictsWithParent: false,
      worktree: null,
    };
  }

  /** A worktree-backed branch that has diverged with real conflicts — can't fast-forward cleanly. */
  showConflict(s: NodeSummary): boolean {
    return !!s.worktree && s.behind > 0 && s.ahead > 0 && s.conflictsWithParent;
  }

  /** Whether there's anything to act on: a worktree to pull into, or commits to integrate. */
  hasTrigger(s: NodeSummary): boolean {
    return (!!s.worktree && s.behind > 0) || s.ahead > 0;
  }

  summaryTitle(s: NodeSummary): string {
    return `${s.ahead} commit(s) ahead of ${s.parent}, ${s.behind} behind`;
  }

  /** Commits to pull in for {@code branch}, or null while they're still loading. */
  incomingFor(branch: string): CommitDto[] | null {
    const preview = this.commitsPreview();
    return preview && preview.branch === branch ? preview.incoming : null;
  }

  /** This branch's own commits over its parent (the `+` count), or null while still loading. */
  outgoingFor(branch: string): CommitDto[] | null {
    const preview = this.commitsPreview();
    return preview && preview.branch === branch ? preview.outgoing : null;
  }

  onPeek(branch: string, visible: boolean): void {
    if (visible) {
      this.peek.emit(branch);
    }
  }

  /** Toggle the popover open/closed for a branch (the count is click-only — no hover). */
  togglePopover(branch: string): void {
    this.openBranch.set(this.openBranch() === branch ? null : branch);
  }

  /** Close the popover (the explicit × button, and after running an action). */
  closePopover(): void {
    this.openBranch.set(null);
  }

  /** The footer action label: a fast-forward when level, otherwise a merge of the parent in. */
  actionLabel(wt: WorktreeDto | null): string {
    const parent = wt?.parent ?? 'parent';
    return this.canFastForward(wt) ? `Fast-forward to ${parent}` : `Merge ${parent} in`;
  }

  /** Run the Behind-tab action: fast-forward when possible, otherwise merge the parent in. */
  runAction(wt: WorktreeDto | null): void {
    if (!wt) return;
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

  /** Behind the parent with no commits of its own — a clean fast-forward is possible. */
  canFastForward(wt: WorktreeDto | null): boolean {
    return !!wt && (wt.behind ?? 0) > 0 && (wt.ahead ?? 0) === 0;
  }
}
