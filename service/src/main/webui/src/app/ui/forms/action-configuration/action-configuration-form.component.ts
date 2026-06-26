import { ChangeDetectionStrategy, Component, effect, input, output, signal } from '@angular/core';
import { form, required, submit } from '@angular/forms/signals';

import { FormField } from '@angular/forms/signals';
import { ZardButtonComponent } from '@/shared/components/button';
import { FormFieldLayoutComponent } from '@/ui/layout/form-field-layout/form-field-layout.component';
import { FormFieldSlotDirective } from '@/ui/layout/form-field-layout/form-field-slot.directive';

export interface ActionConfigurationFormData {
  name: string;
  description: string;
  executeScript: string;
  checkScript: string;
}

@Component({
  selector: 'app-action-configuration-form',
  imports: [FormField, FormFieldLayoutComponent, FormFieldSlotDirective, ZardButtonComponent],
  template: `
    <form (submit)="onSubmit($event)" class="flex flex-col gap-4 max-w-xl">
      <app-form-field-layout [field]="form.name" id="action-name" label="Name" autocomplete="off" />

      <app-form-field-layout [field]="form.description" id="action-description" label="Description">
        <textarea appFormFieldSlot="input" z-input rows="3" [formField]="form.description"></textarea>
      </app-form-field-layout>

      <app-form-field-layout [field]="form.executeScript" id="action-execute-script" label="Execute Script">
        <textarea appFormFieldSlot="input" z-input rows="4" [formField]="form.executeScript"></textarea>
      </app-form-field-layout>

      <app-form-field-layout [field]="form.checkScript" id="action-check-script" label="Check Script">
        <textarea appFormFieldSlot="input" z-input rows="4" [formField]="form.checkScript"></textarea>
      </app-form-field-layout>

      <div class="flex items-center gap-2">
        <button z-button type="submit" [zLoading]="loading()">Save</button>
        <ng-content select="[formActions]" />
      </div>
    </form>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ActionConfigurationFormComponent {
  readonly initialData = input<ActionConfigurationFormData>();
  readonly loading = input(false);
  readonly submitted = output<ActionConfigurationFormData>();

  readonly model = signal<ActionConfigurationFormData>({ name: '', description: '', executeScript: '', checkScript: '' });
  readonly form = form(this.model, (schemaPath) => {
    required(schemaPath.name, { message: 'Name is required' });
    required(schemaPath.executeScript, { message: 'Execute script is required' });
    required(schemaPath.checkScript, { message: 'Check script is required' });
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
