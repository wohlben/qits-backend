import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideBot, lucideFolderOpen } from '@ng-icons/lucide';

import { WorktreeDto } from '@/api/model/worktreeDto';
import { WorktreeRuntimeStatus } from '@/api/model/worktreeRuntimeStatus';
import { ZardBadgeComponent, ZardBadgeTypeVariants } from '@/shared/components/badge';
import { ZardButtonComponent } from '@/shared/components/button';

/**
 * Presentational card for a single branch on the repository detail route. Pure
 * card only — tree nesting, guide lines and the ahead/behind connector are owned
 * by {@link BranchTreeComponent}, which positions cards in the worktree tree.
 *
 * Every branch — worktree-backed or not — can be branched off again, so a
 * worktree can itself become the parent of another worktree.
 */
@Component({
  selector: 'app-branch-row',
  imports: [ZardButtonComponent, ZardBadgeComponent, NgIcon],
  template: `
    <div class="flex w-full flex-wrap items-center justify-between gap-4 rounded-lg border p-4">
      <div class="flex min-w-0 flex-col gap-1">
        <span class="font-medium">{{ branch() }}</span>
        @if (worktree(); as wt) {
          <span class="flex items-center gap-2 text-sm text-muted-foreground">
            <span>
              worktree: {{ wt.worktreeId }}
              @if (wt.parent) {
                <span> · forked from {{ wt.parent }}</span>
              }
            </span>
            <!-- The container is a recreatable cache of the branch; this badge shows its live state
                 (RUNNING/STOPPED/PROVISIONING/FAILED), with the failure reason on hover. -->
            <z-badge
              [zType]="runtimeBadgeType(wt.runtimeStatus)"
              [attr.title]="wt.runtimeStatus === 'FAILED' ? (wt.runtimeError ?? 'Provision failed') : null"
            >
              {{ wt.runtimeStatus ?? 'STOPPED' }}
            </z-badge>
          </span>
        }
      </div>

      <div class="flex flex-wrap items-center justify-end gap-2">
        <button z-button zType="ghost" (click)="viewCommits.emit()">View commits</button>
        @if (worktree(); as wt) {
          <!-- Container lifecycle: bring a stopped/failed container back (recreated from the branch)
               or gracefully stop a running one (pushes first, so committed work survives). -->
          @if (wt.runtimeStatus === 'PROVISIONING') {
            <button z-button zType="ghost" [zLoading]="true" [zDisabled]="true">Starting…</button>
          } @else if (wt.runtimeStatus === 'RUNNING') {
            <button z-button zType="ghost" title="Stop this container" (click)="stopContainer.emit()">
              Stop
            </button>
          } @else {
            <button
              z-button
              zType="secondary"
              title="Start this worktree's container (recreated from its branch)"
              (click)="ensureContainer.emit()"
            >
              {{ wt.runtimeStatus === 'FAILED' ? 'Recreate' : 'Start' }}
            </button>
          }
          <!-- Opens the worktree's detail page: browse its files and chat with its agent. -->
          <button z-button zType="ghost" title="Open this worktree" (click)="openWorktree.emit()">
            <ng-icon name="lucideFolderOpen" class="size-4" />
            Work on it
          </button>
          <button z-button zType="ghost" (click)="run.emit()">Run…</button>
          @if (claudeConfigurable()) {
            <!-- Launches Claude Code in this worktree with the repository MCP attached, scoped to the
                 project — for driving branches/worktrees/commits/actions from within the subtree. -->
            <button
              z-button
              zType="ghost"
              title="Configure this subtree with Claude (repository MCP)"
              (click)="configureWithClaude.emit()"
            >
              <ng-icon name="lucideBot" class="size-4" />
              Configure with Claude
            </button>
          }
        }
        <button z-button [zType]="worktree() ? 'secondary' : 'default'" (click)="branchOff.emit()">
          Branch off worktree
        </button>
        @if (canCleanup()) {
          <!-- Fully integrated with nothing unmerged and no dependents: offer a safe, no-confirm
               cleanup instead of Integrate/Abandon (the backend re-verifies before deleting). -->
          <button z-button zType="secondary" (click)="cleanup.emit()">Cleanup</button>
        } @else {
          <!-- Integrate moved into the commit popover (Forward tab); here we keep only the
               destructive remove action. -->
          @if (worktree()) {
            <button z-button zType="destructive" (click)="abandon.emit()">Abandon</button>
          } @else if (!hasChildren()) {
            <button z-button zType="destructive" (click)="delete.emit()">Delete</button>
          }
        }
      </div>
    </div>
  `,
  viewProviders: [provideIcons({ lucideBot, lucideFolderOpen })],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BranchRowComponent {
  readonly branch = input.required<string>();
  readonly worktree = input<WorktreeDto | null>(null);
  /** A branch with children is a parent of another worktree, so it cannot be deleted. */
  readonly hasChildren = input(false);
  /** Whether a repository-MCP Claude action exists to offer the per-subtree "Configure" button. */
  readonly claudeConfigurable = input(false);
  /**
   * The branch is fully integrated and safe to remove (clean tree, nothing unmerged, no
   * dependents). Computed server-side per branch — worktree-backed or plain — so a fully merged
   * branch offers a no-confirm Cleanup in place of Integrate/Abandon.
   */
  readonly canCleanup = input(false);
  readonly viewCommits = output<void>();
  /** Start or recreate this worktree's container (re-materialized from its branch on demand). */
  readonly ensureContainer = output<void>();
  /** Gracefully stop this worktree's container (pushes its branch first, then removes it). */
  readonly stopContainer = output<void>();
  /** Open this worktree's detail page (file browser + chat dialog). */
  readonly openWorktree = output<void>();
  /** Open the "Run…" dialog to pick a preconfigured action to run in this worktree. */
  readonly run = output<void>();
  /** Launch the repository-MCP Claude action in this worktree's terminal. */
  readonly configureWithClaude = output<void>();
  readonly branchOff = output<void>();
  readonly abandon = output<void>();
  readonly delete = output<void>();
  readonly cleanup = output<void>();

  /** Badge colour for a container runtime state: neutral when running/stopped, red on failure. */
  runtimeBadgeType(status: WorktreeRuntimeStatus | undefined): ZardBadgeTypeVariants {
    switch (status) {
      case WorktreeRuntimeStatus.Running:
        return 'secondary';
      case WorktreeRuntimeStatus.Failed:
        return 'destructive';
      default:
        return 'outline';
    }
  }
}
