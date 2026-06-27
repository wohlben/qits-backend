import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { DatePipe } from '@angular/common';

import { CommitDto } from '@/api/model/commitDto';

/**
 * Presentational card for a single commit in a branch's log — the short hash in monospace, the
 * subject as the title, and the author plus committed date below. The whole card is a button:
 * activating it emits {@link view} so the smart parent can open the commit's diff.
 */
@Component({
  selector: 'app-commit-row',
  imports: [DatePipe],
  template: `
    @let c = commit();
    <button
      type="button"
      class="flex w-full items-start justify-between gap-4 rounded-lg border p-4 text-left transition-colors hover:bg-accent hover:text-accent-foreground"
      (click)="view.emit(c)"
    >
      <div class="flex min-w-0 flex-col gap-1">
        <span class="truncate font-medium">{{ c.message }}</span>
        <span class="text-sm text-muted-foreground">
          {{ c.author }}
          @if (c.date) {
            <span> · {{ c.date | date: 'medium' }}</span>
          }
        </span>
      </div>
      <span class="shrink-0 font-mono text-xs text-muted-foreground">{{ c.shortHash }}</span>
    </button>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommitRowComponent {
  readonly commit = input.required<CommitDto>();
  readonly view = output<CommitDto>();
}
