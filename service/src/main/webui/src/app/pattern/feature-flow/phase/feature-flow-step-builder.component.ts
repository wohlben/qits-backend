/**
 * Step builder nested inside the feature-flow phase card.
 *
 * This component is part of the phase editing surface. The user does not
 * perceive steps as independent entities; they are simply part of "the
 * phase". This component fetches and renders the step list, but it does
 * not own edit state — `editable` is inherited from the parent phase
 * card. The backend hierarchy (phase → step) is an implementation detail
 * that must not leak into the UX.
 */
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { FeatureFlowPhaseStepControllerService } from '@/api/api/featureFlowPhaseStepController.service';
import { FeatureFlowStepCardComponent } from './feature-flow-step-card.component';

@Component({
  selector: 'app-feature-flow-step-builder',
  imports: [FeatureFlowStepCardComponent],
  template: `
    @if (stepsQuery.isPending()) {
      <div class="text-muted-foreground">Loading steps…</div>
    } @else if (stepsQuery.isError()) {
      <div class="text-destructive">Failed to load steps</div>
    } @else {
      @let steps = sortedSteps();
      @if (steps.length === 0) {
        <p class="text-sm text-muted-foreground">No steps yet.</p>
      } @else {
        <div class="flex flex-col border rounded-md divide-y bg-card">
          @for (step of steps; track step.id) {
            <app-feature-flow-step-card [step]="step" [editable]="editable()" />
          }
        </div>
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FeatureFlowStepBuilderComponent {
  readonly phaseId = input.required<string>();
  readonly editable = input(true);

  private readonly stepService = inject(FeatureFlowPhaseStepControllerService);

  readonly stepsQuery = injectQuery(() => ({
    queryKey: ['feature-flow-steps', this.phaseId()],
    queryFn: () =>
      lastValueFrom(
        this.stepService.apiFeatureFlowPhaseStepsGet(this.phaseId())
      ).then((r) => r.entries?.map((e) => e.featureFlowPhaseStep!).filter((s): s is NonNullable<typeof s> => !!s) ?? []),
  }));

  readonly sortedSteps = computed(() =>
    (this.stepsQuery.data() ?? []).slice().sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
  );
}
