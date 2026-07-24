import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { ServiceStatus } from '@/api/model/serviceStatus';

/** The colored status pill of one supervised service instance. */
@Component({
  selector: 'app-service-status-chip',
  template: `
    <span
      class="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium"
      [class]="chipClasses()"
    >
      <span class="size-1.5 rounded-full" [class]="dotClasses()" aria-hidden="true"></span>
      {{ status() }}
      @if (restartCount() > 0) {
        <span class="opacity-75">({{ restartCount() }} restarts)</span>
      }
    </span>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ServiceStatusChipComponent {
  readonly status = input.required<ServiceStatus>();
  readonly restartCount = input(0);

  readonly chipClasses = computed(() => {
    switch (this.status()) {
      case ServiceStatus.Ready:
        return 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300';
      case ServiceStatus.Starting:
      case ServiceStatus.Restarting:
        return 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300';
      case ServiceStatus.Crashed:
        return 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300';
      default:
        return 'bg-muted text-muted-foreground';
    }
  });

  readonly dotClasses = computed(() => {
    switch (this.status()) {
      case ServiceStatus.Ready:
        return 'bg-green-500';
      case ServiceStatus.Starting:
      case ServiceStatus.Restarting:
        return 'bg-amber-500 animate-pulse';
      case ServiceStatus.Crashed:
        return 'bg-red-500';
      default:
        return 'bg-muted-foreground/50';
    }
  });
}
