import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { DaemonConfigurationControllerService } from '@/api/api/daemonConfigurationController.service';
import { DaemonConfigurationCardComponent } from '@/ui/components/daemon-configuration/daemon-configuration-card.component';
import { EmptyStateComponent } from '@/ui/components/empty-state/empty-state.component';

@Component({
  selector: 'app-daemon-configuration-list',
  imports: [DaemonConfigurationCardComponent, EmptyStateComponent],
  template: `
    @if (daemonsQuery.isPending()) {
      <div class="py-12 text-center text-muted-foreground">Loading daemons…</div>
    } @else if (daemonsQuery.isError()) {
      <div class="py-12 text-center text-destructive">Failed to load daemons</div>
    } @else {
      @let daemons = daemonsQuery.data() ?? [];
      @if (daemons.length === 0) {
        <app-empty-state>
          <span title>No daemons yet</span>
          <span description>Define your first long-running process to get started</span>
        </app-empty-state>
      } @else {
        <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          @for (daemon of daemons; track daemon.id) {
            <app-daemon-configuration-card [daemon]="daemon" />
          }
        </div>
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DaemonConfigurationListComponent {
  private readonly daemonService = inject(DaemonConfigurationControllerService);

  readonly daemonsQuery = injectQuery(() => ({
    queryKey: ['daemon-configurations'],
    queryFn: () =>
      lastValueFrom(this.daemonService.apiDaemonConfigurationsGet()).then(
        (r) =>
          r.entries
            ?.map((e) => e.daemonConfiguration!)
            .filter((d): d is NonNullable<typeof d> => !!d) ?? [],
      ),
  }));
}
