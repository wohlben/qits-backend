import { ChangeDetectionStrategy, Component, effect, input, output, signal } from '@angular/core';
import { FormField } from '@angular/forms/signals';
import { form, required, submit } from '@angular/forms/signals';

import { ZardButtonComponent } from '@/shared/components/button';
import { FormFieldLayoutComponent } from '@/ui/layout/form-field-layout/form-field-layout.component';
import { FormFieldSlotDirective } from '@/ui/layout/form-field-layout/form-field-slot.directive';

export interface FeatureFlowPhaseFormData {
  name: string;
  description: string;
}

@Component({
  selector: 'app-feature-flow-phase-form',
  imports: [FormField, FormFieldLayoutComponent, FormFieldSlotDirective, ZardButtonComponent],
  template: `
    <form (submit)="onSubmit($event)" class="flex flex-col gap-4 max-w-xl">
      <app-form-field-layout [field]="form.name" id="phase-name" label="Name" autocomplete="off" />

      <app-form-field-layout [field]="form.description" id="phase-description" label="Description">
        <textarea appFormFieldSlot="input" z-input rows="3" [formField]="form.description"></textarea>
      </app-form-field-layout>

      <div class="flex items-center gap-2">
        <button z-button type="submit" [zLoading]="loading()">Save</button>
        <ng-content select="[formActions]" />
      </div>
    </form>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FeatureFlowPhaseFormComponent {
  readonly initialData = input<FeatureFlowPhaseFormData>();
  readonly loading = input(false);
  readonly submitted = output<FeatureFlowPhaseFormData>();

  readonly model = signal<FeatureFlowPhaseFormData>({ name: '', description: '' });
  readonly form = form(this.model, (schemaPath) => {
    required(schemaPath.name, { message: 'Name is required' });
  });

  constructor() {
    effect(() => {
      const data = this.initialData();
      if (data) this.model.set(data);
    });
  }

  async onSubmit(event: Event) {
    event.preventDefault();
    await submit(this.form, {
      action: async () => this.submitted.emit(this.model()),
    });
  }
}
