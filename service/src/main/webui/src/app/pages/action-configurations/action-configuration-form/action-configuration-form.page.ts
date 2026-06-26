import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { ActionConfigurationControllerService } from '@/api/api/actionConfigurationController.service';
import { PageLayoutComponent } from '@/layout/page-layout/page-layout.component';
import { ActionConfigurationCreateUpdateFormComponent } from '@/pattern/action-configuration/action-configuration-create-update-form.component';

@Component({
  selector: 'app-action-configuration-form-page',
  imports: [PageLayoutComponent, ActionConfigurationCreateUpdateFormComponent],
  template: `
    <app-page-layout [hasActions]="false">
      <div pageTitle>
        <h1 class="text-2xl font-bold">{{ isEdit() ? 'Edit Action' : 'New Action' }}</h1>
      </div>
      @if (isEdit() && actionQuery.isPending()) {
        <div class="text-muted-foreground">Loading action…</div>
      } @else if (isEdit() && actionQuery.isError()) {
        <div class="text-destructive">Failed to load action</div>
      } @else {
        <app-action-configuration-create-update-form [action]="action()" />
      }
    </app-page-layout>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ActionConfigurationFormPage {
  private readonly route = inject(ActivatedRoute);
  private readonly actionService = inject(ActionConfigurationControllerService);

  readonly actionId = this.route.snapshot.paramMap.get('id');

  readonly actionQuery = injectQuery(() => ({
    queryKey: ['action-configuration', this.actionId ?? ''],
    queryFn: () =>
      lastValueFrom(this.actionService.apiActionConfigurationsIdGet(this.actionId!)).then(
        (r) => r.actionConfiguration!
      ),
    enabled: () => !!this.actionId,
  }));

  readonly action = computed(() => this.actionQuery.data());
  readonly isEdit = computed(() => !!this.actionId);
}
