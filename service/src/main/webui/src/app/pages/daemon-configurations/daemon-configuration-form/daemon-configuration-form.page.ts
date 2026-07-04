import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { DaemonConfigurationControllerService } from '@/api/api/daemonConfigurationController.service';
import { PageLayoutComponent } from '@/layout/page-layout/page-layout.component';
import { DaemonConfigurationCreateUpdateFormComponent } from '@/pattern/daemon-configuration/daemon-configuration-create-update-form.component';

@Component({
  selector: 'app-daemon-configuration-form-page',
  imports: [PageLayoutComponent, DaemonConfigurationCreateUpdateFormComponent],
  template: `
    <app-page-layout [hasActions]="false">
      <div pageTitle>
        <h1 class="text-2xl font-bold">{{ isEdit() ? 'Edit Daemon' : 'New Daemon' }}</h1>
      </div>
      @if (isEdit() && daemonQuery.isPending()) {
        <div class="text-muted-foreground">Loading daemon…</div>
      } @else if (isEdit() && daemonQuery.isError()) {
        <div class="text-destructive">Failed to load daemon</div>
      } @else {
        <app-daemon-configuration-create-update-form [daemon]="daemon()" />
      }
    </app-page-layout>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DaemonConfigurationFormPage {
  private readonly route = inject(ActivatedRoute);
  private readonly daemonService = inject(DaemonConfigurationControllerService);

  readonly daemonId = this.route.snapshot.paramMap.get('id');

  readonly daemonQuery = injectQuery(() => ({
    queryKey: ['daemon-configuration', this.daemonId ?? ''],
    queryFn: () =>
      lastValueFrom(this.daemonService.apiDaemonConfigurationsIdGet(this.daemonId!)).then(
        (r) => r.daemonConfiguration!,
      ),
    enabled: () => !!this.daemonId,
  }));

  readonly daemon = computed(() => this.daemonQuery.data());
  readonly isEdit = computed(() => !!this.daemonId);
}
