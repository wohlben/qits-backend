import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import type { ClassValue } from 'clsx';

import { mergeClasses } from '@/shared/utils/merge-classes';

@Component({
  selector: 'app-card-layout',
  template: `
    <div [class]="cardClasses()">
      <header [class]="headerClasses()">
        <div class="flex flex-1 flex-col gap-1">
          <ng-content select="[cardTitle]" />
        </div>

        @if (hasActions()) {
          <div class="flex items-center gap-2">
            <ng-content select="[cardActions]" />
          </div>
        }
      </header>

      <div class="px-6 py-4">
        <ng-content />
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CardLayoutComponent {
  readonly class = input<ClassValue>('');
  readonly hasActions = input(true);

  protected readonly cardClasses = computed(() =>
    mergeClasses(
      'bg-card text-card-foreground flex flex-col rounded-t-xl border shadow-sm overflow-hidden',
      this.class(),
    ),
  );

  protected readonly headerClasses = computed(() =>
    mergeClasses(
      'flex items-start justify-between gap-4 bg-accent/50 px-6 py-4',
    ),
  );
}
