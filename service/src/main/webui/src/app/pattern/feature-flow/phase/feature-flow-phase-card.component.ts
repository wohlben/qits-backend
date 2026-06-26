/**
 * Phase card for the feature-flow detail page.
 *
 * This component is part of the phase editing surface. For the user, the
 * phase *is* the entire configuration: name, description, ordered steps,
 * and the actions attached to those steps. The backend models this as a
 * hierarchy (phase → step → action), but that is a pure implementation
 * detail that must not leak into the UX.
 *
 * This component owns the single `isEditing` signal that controls the
 * entire surface. Child components (step builder, step cards) inherit
 * `editable` from it and do not maintain their own edit toggles.
 *
 * When `phase` is omitted the card renders in **create** mode: it shows
 * the same edit-form shell but calls `POST` instead of `PUT` and emits
 * `created` / `cancelled` instead of mutating an existing entity.
 */
import { ChangeDetectionStrategy, Component, effect, inject, input, output, signal } from '@angular/core';
import { FormField, form, required, submit } from '@angular/forms/signals';
import { injectMutation, QueryClient } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { FeatureFlowPhaseControllerService } from '@/api/api/featureFlowPhaseController.service';
import { FeatureFlowPhaseStepControllerService } from '@/api/api/featureFlowPhaseStepController.service';
import { CreateFeatureFlowPhaseRequest } from '@/api/model/createFeatureFlowPhaseRequest';
import { CreateFeatureFlowPhaseStepRequest } from '@/api/model/createFeatureFlowPhaseStepRequest';
import { FeatureFlowPhaseDto } from '@/api/model/featureFlowPhaseDto';
import { UpdateFeatureFlowPhaseRequest } from '@/api/model/updateFeatureFlowPhaseRequest';
import { CardLayoutComponent } from '@/layout/card-layout/card-layout.component';
import { ZardButtonComponent } from '@/shared/components/button';
import { ZardInputDirective } from '@/shared/components/input/input.directive';
import { FormFieldLayoutComponent } from '@/ui/layout/form-field-layout/form-field-layout.component';
import { FormFieldSlotDirective } from '@/ui/layout/form-field-layout/form-field-slot.directive';
import { FeatureFlowStepBuilderComponent } from './feature-flow-step-builder.component';

interface PhaseFormData {
  name: string;
  description: string;
}

@Component({
  selector: 'app-feature-flow-phase-card',
  imports: [
    CardLayoutComponent,
    FormField,
    FormFieldLayoutComponent,
    FormFieldSlotDirective,
    ZardButtonComponent,
    ZardInputDirective,
    FeatureFlowStepBuilderComponent,
  ],
  template: `
    @if (isEditing()) {
      <form (submit)="onSubmit($event)">
        <app-card-layout>
          <div cardTitle class="flex flex-col gap-1">
            <input
              id="phase-name"
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

          <div cardActions>
            <button z-button zType="secondary" zSize="sm" type="button" (click)="onCancelEdit()">
              Cancel
            </button>
            @if (!isCreateMode()) {
              <button z-button zType="ghost" zSize="sm" type="button" (click)="startAddStep()">
                + Add Step
              </button>
            }
            <button z-button zSize="sm" type="submit" [zLoading]="saveMutation.isPending()">
              Save
            </button>
          </div>

          <div class="flex flex-col gap-4">
            <app-form-field-layout [field]="editForm.description" id="phase-description" label="Description">
              <textarea appFormFieldSlot="input" z-input rows="3" [formField]="editForm.description"></textarea>
            </app-form-field-layout>

            @if (!isCreateMode()) {
              <app-feature-flow-step-builder [phaseId]="phase()!.id!" [editable]="true" />

              @if (isAddingStep()) {
                <div class="flex flex-col gap-2 border rounded-md p-3 bg-card">
                  <input
                    id="new-step-name"
                    z-input
                    type="text"
                    placeholder="Step name"
                    autocomplete="off"
                    [formField]="addStepForm.name"
                  />
                  @if (addStepForm.name().touched() && addStepForm.name().invalid()) {
                    <p class="text-sm text-destructive">{{ addStepForm.name().errors()[0]?.message }}</p>
                  }
                  <div class="flex items-center gap-2">
                    <button z-button zSize="sm" type="button" (click)="onSaveNewStep()">Save</button>
                    <button z-button zType="secondary" zSize="sm" type="button" (click)="cancelAddStep()">Cancel</button>
                  </div>
                </div>
              }
            }
          </div>
        </app-card-layout>
      </form>
    } @else {
      <app-card-layout>
        <div cardTitle>
          <span class="font-semibold">{{ phase()?.name }}</span>
        </div>
        @if (phase()?.description) {
          <p class="text-sm text-muted-foreground">{{ phase()!.description }}</p>
        }
        <div cardActions>
          <button z-button zType="secondary" zSize="sm" (click)="onEdit()">Edit</button>
          <button z-button zType="destructive" zSize="sm" (click)="onDelete()" [zLoading]="deleteMutation.isPending()">
            Delete
          </button>
        </div>

        <app-feature-flow-step-builder [phaseId]="phase()!.id!" [editable]="false" />
      </app-card-layout>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FeatureFlowPhaseCardComponent {
  readonly phase = input<FeatureFlowPhaseDto>();
  readonly featureFlowId = input<string>();

  readonly saved = output<void>();
  readonly created = output<void>();
  readonly cancelled = output<void>();

  private readonly phaseService = inject(FeatureFlowPhaseControllerService);
  private readonly stepService = inject(FeatureFlowPhaseStepControllerService);
  private readonly queryClient = inject(QueryClient);

  readonly isEditing = signal(false);
  readonly isAddingStep = signal(false);

  readonly editModel = signal<PhaseFormData>({ name: '', description: '' });
  readonly editForm = form(this.editModel, (schemaPath) => {
    required(schemaPath.name, { message: 'Name is required' });
  });

  readonly isCreateMode = () => !this.phase();

  constructor() {
    effect(() => {
      if (this.isEditing()) {
        const p = this.phase();
        this.editModel.set({ name: p?.name ?? '', description: p?.description ?? '' });
      }
    });
  }

  readonly saveMutation = injectMutation(() => ({
    mutationFn: (req: UpdateFeatureFlowPhaseRequest | CreateFeatureFlowPhaseRequest) => {
      if (this.isCreateMode()) {
        return lastValueFrom(
          this.phaseService.apiFeatureFlowPhasesPost(req as CreateFeatureFlowPhaseRequest)
        );
      }
      return lastValueFrom(
        this.phaseService.apiFeatureFlowPhasesIdPut(this.phase()!.id!, req as UpdateFeatureFlowPhaseRequest)
      );
    },
    onSuccess: () => {
      this.queryClient.invalidateQueries({ queryKey: ['feature-flow-phases'] });
      this.queryClient.invalidateQueries({ queryKey: ['feature-flow'] });
      this.isEditing.set(false);
      if (this.isCreateMode()) {
        this.created.emit();
      } else {
        this.saved.emit();
      }
    },
  }));

  readonly deleteMutation = injectMutation(() => ({
    mutationFn: () => lastValueFrom(this.phaseService.apiFeatureFlowPhasesIdDelete(this.phase()!.id!)),
    onSuccess: () => {
      this.queryClient.invalidateQueries({ queryKey: ['feature-flow-phases'] });
      this.queryClient.invalidateQueries({ queryKey: ['feature-flow'] });
    },
  }));

  readonly createStepMutation = injectMutation(() => ({
    mutationFn: (req: CreateFeatureFlowPhaseStepRequest) =>
      lastValueFrom(this.stepService.apiFeatureFlowPhaseStepsPost(req)),
    onSuccess: () => {
      this.queryClient.invalidateQueries({ queryKey: ['feature-flow-steps', this.phase()!.id!] });
      this.isAddingStep.set(false);
      this.addStepModel.set({ name: '' });
    },
  }));

  readonly addStepModel = signal<{ name: string }>({ name: '' });
  readonly addStepForm = form(this.addStepModel, (schemaPath) => {
    required(schemaPath.name, { message: 'Name is required' });
  });

  onEdit() {
    this.isEditing.set(true);
  }

  onCancelEdit() {
    this.isEditing.set(false);
    this.isAddingStep.set(false);
    this.cancelled.emit();
  }

  async onSubmit(event: Event) {
    event.preventDefault();
    await submit(this.editForm, {
      action: async () => {
        const base = {
          name: this.editModel().name,
          description: this.editModel().description || undefined,
        };
        if (this.isCreateMode()) {
          this.saveMutation.mutate({
            ...base,
            featureFlowConfigurationId: this.featureFlowId()!,
            orderIndex: 0,
          } as CreateFeatureFlowPhaseRequest);
        } else {
          this.saveMutation.mutate(base as UpdateFeatureFlowPhaseRequest);
        }
      },
    });
  }

  onDelete() {
    if (confirm('Are you sure you want to delete this phase?')) {
      this.deleteMutation.mutate();
    }
  }

  startAddStep() {
    this.addStepModel.set({ name: '' });
    this.isAddingStep.set(true);
  }

  cancelAddStep() {
    this.isAddingStep.set(false);
    this.addStepModel.set({ name: '' });
  }

  async onSaveNewStep() {
    await submit(this.addStepForm, {
      action: async () => {
        const nextIndex = this.phase()!.steps?.length ?? 0;
        this.createStepMutation.mutate({
          phaseId: this.phase()!.id!,
          name: this.addStepModel().name,
          sortOrder: nextIndex,
        });
      },
    });
  }
}
