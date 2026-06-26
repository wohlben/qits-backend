import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { ActionConfigurationControllerService } from '@/api/api/actionConfigurationController.service';
import { ActionConfigurationCardComponent } from '@/ui/components/action-configuration/action-configuration-card.component';
import { EmptyStateComponent } from '@/ui/components/empty-state/empty-state.component';

@Component({
  selector: 'app-action-configuration-list',
  imports: [ActionConfigurationCardComponent, EmptyStateComponent],
  template: `
    @if (actionsQuery.isPending()) {
      <div class="py-12 text-center text-muted-foreground">Loading actions…</div>
    } @else if (actionsQuery.isError()) {
      <div class="py-12 text-center text-destructive">Failed to load actions</div>
    } @else {
      @let actions = actionsQuery.data() ?? [];
      @if (actions.length === 0) {
        <app-empty-state>
          <span title>No actions yet</span>
          <span description>Create your first action configuration to get started</span>
        </app-empty-state>
      } @else {
        <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          @for (action of actions; track action.id) {
            <app-action-configuration-card [action]="action" />
          }
        </div>
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ActionConfigurationListComponent {
  private readonly actionService = inject(ActionConfigurationControllerService);

  readonly actionsQuery = injectQuery(() => ({
    queryKey: ['action-configurations'],
    queryFn: () =>
      lastValueFrom(this.actionService.apiActionConfigurationsGet()).then(
        (r) => r.entries?.map((e) => e.actionConfiguration!).filter((a): a is NonNullable<typeof a> => !!a) ?? []
      ),
  }));
}
