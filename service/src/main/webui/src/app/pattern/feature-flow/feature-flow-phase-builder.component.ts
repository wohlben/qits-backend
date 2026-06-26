/**
 * Phase builder for the feature-flow detail page.
 *
 * This component orchestrates the phase editing surface. For the user,
 * each phase is a single conceptual element that contains its name,
 * description, steps, and step actions. The backend represents this as
 * a hierarchy, but that is an implementation detail that must not leak
 * into the UX.
 */
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { FeatureFlowPhaseControllerService } from '@/api/api/featureFlowPhaseController.service';

import { FeatureFlowPhaseCardComponent } from './phase/feature-flow-phase-card.component';

@Component({
  selector: 'app-feature-flow-phase-builder',
  imports: [FeatureFlowPhaseCardComponent],
  template: `
    <div class="flex flex-col gap-6">
      @if (phasesQuery.isPending()) {
        <div class="text-muted-foreground">Loading phases…</div>
      } @else if (phasesQuery.isError()) {
        <div class="text-destructive">Failed to load phases</div>
      } @else {
        @let phases = sortedPhases();
        @if (phases.length === 0 && !showCreate()) {
          <p class="text-sm text-muted-foreground">No phases yet.</p>
        } @else {
          <div class="flex flex-col gap-3">
            @for (phase of phases; track phase.id) {
              <app-feature-flow-phase-card [phase]="phase" />
            }
          </div>
        }
      }

      @if (showCreate()) {
        <app-feature-flow-phase-card
          [featureFlowId]="featureFlowId()"
          (created)="onCreated()"
          (cancelled)="onCancelled()"
        />
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FeatureFlowPhaseBuilderComponent {
  readonly featureFlowId = input.required<string>();
  readonly showCreate = input(false);

  private readonly phaseService = inject(FeatureFlowPhaseControllerService);
  private readonly queryClient = inject(QueryClient);

  readonly phasesQuery = injectQuery(() => ({
    queryKey: ['feature-flow-phases', this.featureFlowId()],
    queryFn: () =>
      lastValueFrom(
        this.phaseService.apiFeatureFlowPhasesGet(this.featureFlowId())
      ).then((r) => r.entries?.map((e) => e.featureFlowPhase!).filter((p): p is NonNullable<typeof p> => !!p) ?? []),
  }));

  readonly sortedPhases = computed(() =>
    (this.phasesQuery.data() ?? []).slice().sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0))
  );

  onCreated() {
    this.queryClient.invalidateQueries({ queryKey: ['feature-flow-phases', this.featureFlowId()] });
    this.queryClient.invalidateQueries({ queryKey: ['feature-flow', this.featureFlowId()] });
  }

  onCancelled() {
    // no-op — parent handles visibility
  }
}
