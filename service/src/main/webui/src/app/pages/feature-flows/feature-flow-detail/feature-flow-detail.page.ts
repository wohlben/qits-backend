import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { injectMutation, injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { FeatureFlowConfigurationControllerService } from '@/api/api/featureFlowConfigurationController.service';
import { PageLayoutComponent } from '@/layout/page-layout/page-layout.component';
import { FeatureFlowPhaseBuilderComponent } from '@/pattern/feature-flow/feature-flow-phase-builder.component';
import { ZardButtonComponent } from '@/shared/components/button';

@Component({
  selector: 'app-feature-flow-detail-page',
  imports: [PageLayoutComponent, FeatureFlowPhaseBuilderComponent, RouterLink, ZardButtonComponent],
  template: `
    <app-page-layout
      [request]="featureFlowQuery"
      pendingText="Loading feature flow…"
      errorText="Failed to load feature flow"
    >
      <ng-template #pageTitle let-flow>
        <h1 class="text-2xl font-bold">{{ flow.name }}</h1>
        @if (flow.projectId) {
          <p class="text-sm text-muted-foreground">Project: {{ flow.projectId }}</p>
        }
      </ng-template>

      <div pageActions>
        <a z-button zType="ghost" routerLink="/action-configurations">Actions</a>
        <button z-button zType="secondary" (click)="toggleCreatePhase()">
          {{ isCreatingPhase() ? 'Cancel' : 'Add Phase' }}
        </button>
        <a z-button zType="secondary" [routerLink]="['/feature-flows', featureFlowId, 'edit']">Edit</a>
        <button z-button zType="destructive" (click)="onDelete()" [zLoading]="deleteMutation.isPending()">
          Delete
        </button>
      </div>

      <app-feature-flow-phase-builder [featureFlowId]="featureFlowId" [showCreate]="isCreatingPhase()" />
    </app-page-layout>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FeatureFlowDetailPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly featureFlowService = inject(FeatureFlowConfigurationControllerService);
  private readonly queryClient = inject(QueryClient);

  readonly featureFlowId = this.route.snapshot.paramMap.get('id')!;
  readonly isCreatingPhase = signal(false);

  readonly featureFlowQuery = injectQuery(() => ({
    queryKey: ['feature-flow', this.featureFlowId],
    queryFn: () =>
      lastValueFrom(this.featureFlowService.apiFeatureFlowConfigurationsIdGet(this.featureFlowId)).then(
        (r) => r.featureFlowConfiguration!
      ),
  }));

  readonly deleteMutation = injectMutation(() => ({
    mutationFn: () => lastValueFrom(this.featureFlowService.apiFeatureFlowConfigurationsIdDelete(this.featureFlowId)),
    onSuccess: () => {
      this.queryClient.invalidateQueries({ queryKey: ['feature-flows'] });
      this.router.navigate(['/feature-flows']);
    },
  }));

  toggleCreatePhase() {
    this.isCreatingPhase.update((v) => !v);
  }

  onDelete() {
    if (confirm('Are you sure you want to delete this feature flow?')) {
      this.deleteMutation.mutate();
    }
  }
}
