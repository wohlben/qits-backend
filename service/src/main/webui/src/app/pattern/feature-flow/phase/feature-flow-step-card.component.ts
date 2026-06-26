/**
 * Step card for the feature-flow phase builder.
 *
 * **Design contract:** This component is part of the phase editing
 * surface. It does **not** own its own edit state; `editable` is
 * inherited from the parent phase card. For the user, "the phase"
 * is the entire configuration surface — name, description, steps,
 * and actions. The backend hierarchy (phase → step → action) is a
 * pure implementation detail that must not leak into the UX.
 *
 * - In edit mode the step name is an inline input immediately.
 * - There is **no** "Edit" button on individual steps.
 * - Mutations (rename, add/remove action, delete step) are available
 *   while the phase is in edit mode.
 */
import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { FormField, form, required, submit } from '@angular/forms/signals';
import { injectMutation, injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { ActionConfigurationControllerService } from '@/api/api/actionConfigurationController.service';
import { FeatureFlowPhaseActionControllerService } from '@/api/api/featureFlowPhaseActionController.service';
import { FeatureFlowPhaseStepControllerService } from '@/api/api/featureFlowPhaseStepController.service';
import { ActionType } from '@/api/model/actionType';
import { CreateFeatureFlowPhaseActionRequest } from '@/api/model/createFeatureFlowPhaseActionRequest';
import { FeatureFlowPhaseStepDto } from '@/api/model/featureFlowPhaseStepDto';
import { UpdateFeatureFlowPhaseStepRequest } from '@/api/model/updateFeatureFlowPhaseStepRequest';
import { ZardButtonComponent } from '@/shared/components/button';
import { ZardInputDirective } from '@/shared/components/input/input.directive';

@Component({
  selector: 'app-feature-flow-step-card',
  imports: [FormField, ZardButtonComponent, ZardInputDirective],
  template: `
    <div class="px-4 py-3">
      @if (editable()) {
        <div class="flex flex-col gap-3">
          <div class="flex flex-col gap-1">
            <input
              id="step-name-{{ step().id }}"
              z-input
              type="text"
              placeholder="Name"
              autocomplete="off"
              [formField]="editForm.name"
            />
            @if (editForm.name().touched() && editForm.name().invalid()) {
              <p class="text-sm text-destructive">{{ editForm.name().errors()[0]?.message }}</p>
            }
          </div>

          @if (step().actions && step().actions!.length > 0) {
            <div class="flex flex-col gap-1">
              @for (action of step().actions; track action.id) {
                <div class="flex items-center justify-between">
                  <span class="text-xs bg-muted px-2 py-0.5 rounded">
                    {{ action.actionType }}: {{ action.actionConfiguration?.name }}
                  </span>
                  <button z-button zType="ghost" zSize="sm" type="button" (click)="onDeleteAction(action.id!)">Remove</button>
                </div>
              }
            </div>
          }

          @if (isAddingAction()) {
            <div class="flex flex-col gap-2">
              <div class="flex items-center gap-2">
                <select
                  class="rounded-md border bg-background px-2 py-1 text-sm"
                  [value]="selectedActionConfigId()"
                  (change)="selectedActionConfigId.set($any($event.target).value)"
                >
                  <option value="">Select action…</option>
                  @if (actionConfigsQuery.isPending()) {
                    <option disabled>Loading…</option>
                  } @else if (actionConfigsQuery.data(); as configs) {
                    @for (config of configs; track config.id) {
                      <option [value]="config.id">{{ config.name }}</option>
                    }
                  }
                </select>
                <select
                  class="rounded-md border bg-background px-2 py-1 text-sm"
                  [value]="selectedActionType()"
                  (change)="selectedActionType.set($any($event.target).value)"
                >
                  <option value="PREREQUISITE">Prerequisite</option>
                  <option value="QUALITY_GATE">Quality Gate</option>
                </select>
              </div>
              <div class="flex items-center gap-2">
                <button z-button zSize="sm" type="button" (click)="onCreateAction()">Add</button>
                <button z-button zType="secondary" zSize="sm" type="button" (click)="cancelAddAction()">Cancel</button>
              </div>
            </div>
          } @else {
            <button z-button zType="ghost" zSize="sm" type="button" (click)="startAddAction()">+ Add Action</button>
          }

          <div class="flex items-center justify-between">
            <button z-button zType="destructive" zSize="sm" type="button" (click)="onDelete()" [zLoading]="deleteMutation.isPending()">
              Delete Step
            </button>
            <button z-button zSize="sm" type="button" (click)="onSaveStep()" [zLoading]="updateMutation.isPending()">
              Save Step
            </button>
          </div>
        </div>
      } @else {
        <div class="flex items-center justify-between gap-4">
          <div class="flex flex-col gap-1 min-w-0">
            <span class="font-medium">{{ step().name }}</span>
            @if (step().actions && step().actions!.length > 0) {
              <div class="flex flex-wrap gap-1">
                @for (action of step().actions; track action.id) {
                  <span class="text-xs bg-muted px-2 py-0.5 rounded">
                    {{ action.actionType }}: {{ action.actionConfiguration?.name }}
                  </span>
                }
              </div>
            }
          </div>
        </div>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FeatureFlowStepCardComponent {
  readonly step = input.required<FeatureFlowPhaseStepDto>();
  readonly editable = input(true);

  private readonly stepService = inject(FeatureFlowPhaseStepControllerService);
  private readonly actionService = inject(FeatureFlowPhaseActionControllerService);
  private readonly actionConfigService = inject(ActionConfigurationControllerService);
  private readonly queryClient = inject(QueryClient);

  readonly editModel = signal<{ name: string }>({ name: '' });
  readonly editForm = form(this.editModel, (schemaPath) => {
    required(schemaPath.name, { message: 'Name is required' });
  });

  readonly isAddingAction = signal(false);
  readonly selectedActionConfigId = signal('');
  readonly selectedActionType = signal('PREREQUISITE');

  readonly actionConfigsQuery = injectQuery(() => ({
    queryKey: ['action-configurations'],
    queryFn: () =>
      lastValueFrom(this.actionConfigService.apiActionConfigurationsGet()).then(
        (r) => r.entries?.map((e) => e.actionConfiguration!).filter((a): a is NonNullable<typeof a> => !!a) ?? []
      ),
  }));

  readonly updateMutation = injectMutation(() => ({
    mutationFn: (req: UpdateFeatureFlowPhaseStepRequest) =>
      lastValueFrom(this.stepService.apiFeatureFlowPhaseStepsIdPut(this.step().id!, req)),
    onSuccess: () => {
      this.queryClient.invalidateQueries({ queryKey: ['feature-flow-steps'] });
    },
  }));

  readonly deleteMutation = injectMutation(() => ({
    mutationFn: () => lastValueFrom(this.stepService.apiFeatureFlowPhaseStepsIdDelete(this.step().id!)),
    onSuccess: () => {
      this.queryClient.invalidateQueries({ queryKey: ['feature-flow-steps'] });
    },
  }));

  readonly createActionMutation = injectMutation(() => ({
    mutationFn: (req: CreateFeatureFlowPhaseActionRequest) =>
      lastValueFrom(this.actionService.apiFeatureFlowPhaseActionsPost(req)),
    onSuccess: () => {
      this.queryClient.invalidateQueries({ queryKey: ['feature-flow-steps'] });
      this.isAddingAction.set(false);
      this.selectedActionConfigId.set('');
    },
  }));

  readonly deleteActionMutation = injectMutation(() => ({
    mutationFn: (id: string) => lastValueFrom(this.actionService.apiFeatureFlowPhaseActionsIdDelete(id)),
    onSuccess: () => {
      this.queryClient.invalidateQueries({ queryKey: ['feature-flow-steps'] });
    },
  }));

  constructor() {
    effect(() => {
      this.editModel.set({ name: this.step().name ?? '' });
    });
  }

  onSaveStep() {
    submit(this.editForm, {
      action: async () => {
        this.updateMutation.mutate({
          name: this.editModel().name,
        });
      },
    });
  }

  onDelete() {
    if (confirm('Are you sure you want to delete this step?')) {
      this.deleteMutation.mutate();
    }
  }

  startAddAction() {
    this.isAddingAction.set(true);
  }

  cancelAddAction() {
    this.isAddingAction.set(false);
    this.selectedActionConfigId.set('');
  }

  onCreateAction() {
    if (!this.selectedActionConfigId()) return;
    this.createActionMutation.mutate({
      stepId: this.step().id!,
      actionConfigurationId: this.selectedActionConfigId(),
      actionType: this.selectedActionType() as ActionType,
      sortOrder: this.step().actions?.length ?? 0,
    });
  }

  onDeleteAction(id: string) {
    if (confirm('Remove this action?')) {
      this.deleteActionMutation.mutate(id);
    }
  }
}
