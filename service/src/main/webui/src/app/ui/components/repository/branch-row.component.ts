import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

import { WorktreeDto } from '@/api/model/worktreeDto';
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
  imports: [ZardButtonComponent],
  template: `
    <div class="flex w-full flex-wrap items-center justify-between gap-4 rounded-lg border p-4">
      <div class="flex min-w-0 flex-col gap-1">
        <span class="font-medium">{{ branch() }}</span>
        @if (worktree(); as wt) {
          <span class="text-sm text-muted-foreground">
            worktree: {{ wt.worktreeId }}
            @if (wt.parent) {
              <span> · forked from {{ wt.parent }}</span>
            }
          </span>
        }
      </div>

      <div class="flex flex-wrap items-center justify-end gap-2">
        <button z-button zType="ghost" (click)="viewCommits.emit()">View commits</button>
        @if (worktree()) {
          <button z-button zType="ghost" (click)="viewTerminal.emit()">Web terminal</button>
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
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BranchRowComponent {
  readonly branch = input.required<string>();
  readonly worktree = input<WorktreeDto | null>(null);
  /** A branch with children is a parent of another worktree, so it cannot be deleted. */
  readonly hasChildren = input(false);
  /**
   * The branch is fully integrated and safe to remove (clean tree, nothing unmerged, no
   * dependents). Computed server-side per branch — worktree-backed or plain — so a fully merged
   * branch offers a no-confirm Cleanup in place of Integrate/Abandon.
   */
  readonly canCleanup = input(false);
  readonly viewCommits = output<void>();
  readonly viewTerminal = output<void>();
  readonly branchOff = output<void>();
  readonly abandon = output<void>();
  readonly delete = output<void>();
  readonly cleanup = output<void>();
}
