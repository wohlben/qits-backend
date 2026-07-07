import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** The install state of one curated agent plugin on the shared credential volume. */
export type PluginInstallStatus = 'installed' | 'disabled' | 'available';

/**
 * The colored status pill for one coding-agent plugin: green when installed on the shared volume,
 * amber when installed-but-disabled, muted when available to install. Presentational only — mirrors
 * {@link DaemonStatusChipComponent}.
 */
@Component({
  selector: 'app-plugin-status-chip',
  template: `
    <span
      class="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium"
      [class]="chipClasses()"
    >
      <span class="size-1.5 rounded-full" [class]="dotClasses()" aria-hidden="true"></span>
      {{ label() }}
    </span>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PluginStatusChipComponent {
  readonly status = input.required<PluginInstallStatus>();

  readonly label = computed(() => {
    switch (this.status()) {
      case 'installed':
        return 'Installed';
      case 'disabled':
        return 'Disabled';
      default:
        return 'Not installed';
    }
  });

  readonly chipClasses = computed(() => {
    switch (this.status()) {
      case 'installed':
        return 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300';
      case 'disabled':
        return 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300';
      default:
        return 'bg-muted text-muted-foreground';
    }
  });

  readonly dotClasses = computed(() => {
    switch (this.status()) {
      case 'installed':
        return 'bg-green-500';
      case 'disabled':
        return 'bg-amber-500';
      default:
        return 'bg-muted-foreground/50';
    }
  });
}
