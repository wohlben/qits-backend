import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { BootstrapOutcome } from '@/api/model/bootstrapOutcome';

/** The last-run verdict of one bootstrap command in one workspace, as a small status chip. */
@Component({
  selector: 'app-bootstrap-outcome-chip',
  template: `
    <span
      class="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide"
      [class]="chipClass()"
    >
      {{ outcome() }}
    </span>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BootstrapOutcomeChipComponent {
  readonly outcome = input.required<BootstrapOutcome>();

  readonly chipClass = computed(() => {
    switch (this.outcome()) {
      case BootstrapOutcome.Succeeded:
        return 'border-emerald-500/40 text-emerald-700 dark:text-emerald-400';
      case BootstrapOutcome.Failed:
        return 'border-destructive/40 text-destructive';
      default:
        return 'text-muted-foreground';
    }
  });
}
