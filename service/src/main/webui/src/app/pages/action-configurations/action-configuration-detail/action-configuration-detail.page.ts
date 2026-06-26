import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { injectMutation, injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { ActionConfigurationControllerService } from '@/api/api/actionConfigurationController.service';
import { PageLayoutComponent } from '@/layout/page-layout/page-layout.component';
import { ZardButtonComponent } from '@/shared/components/button';

@Component({
  selector: 'app-action-configuration-detail-page',
  imports: [PageLayoutComponent, RouterLink, ZardButtonComponent],
  template: `
    <app-page-layout
      [request]="actionQuery"
      pendingText="Loading action…"
      errorText="Failed to load action"
    >
      <ng-template #pageTitle let-action>
        <h1 class="text-2xl font-bold">{{ action.name }}</h1>
        @if (action.description) {
          <p class="text-sm text-muted-foreground">{{ action.description }}</p>
        }
      </ng-template>

      <div pageActions>
        <a z-button zType="secondary" [routerLink]="['/action-configurations', actionId, 'edit']">Edit</a>
        <button z-button zType="destructive" (click)="onDelete()" [zLoading]="deleteMutation.isPending()">
          Delete
        </button>
      </div>

      <ng-template #pageContent let-action>
        <div class="flex flex-col gap-6 max-w-3xl">
          <section class="flex flex-col gap-2">
            <h2 class="text-lg font-semibold">Execute Script</h2>
            <pre class="rounded-md bg-muted p-4 text-sm overflow-auto">{{ action.executeScript }}</pre>
          </section>

          <section class="flex flex-col gap-2">
            <h2 class="text-lg font-semibold">Check Script</h2>
            <pre class="rounded-md bg-muted p-4 text-sm overflow-auto">{{ action.checkScript }}</pre>
          </section>
        </div>
      </ng-template>
    </app-page-layout>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ActionConfigurationDetailPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly actionService = inject(ActionConfigurationControllerService);
  private readonly queryClient = inject(QueryClient);

  readonly actionId = this.route.snapshot.paramMap.get('id')!;

  readonly actionQuery = injectQuery(() => ({
    queryKey: ['action-configuration', this.actionId],
    queryFn: () =>
      lastValueFrom(this.actionService.apiActionConfigurationsIdGet(this.actionId)).then(
        (r) => r.actionConfiguration!
      ),
  }));

  readonly deleteMutation = injectMutation(() => ({
    mutationFn: () => lastValueFrom(this.actionService.apiActionConfigurationsIdDelete(this.actionId)),
    onSuccess: () => {
      this.queryClient.invalidateQueries({ queryKey: ['action-configurations'] });
      this.router.navigate(['/action-configurations']);
    },
  }));

  onDelete() {
    if (confirm('Are you sure you want to delete this action?')) {
      this.deleteMutation.mutate();
    }
  }
}
