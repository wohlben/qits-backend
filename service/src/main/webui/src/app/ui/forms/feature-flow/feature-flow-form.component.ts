import { ChangeDetectionStrategy, Component, effect, input, output, signal } from '@angular/core';
import { form, required, submit } from '@angular/forms/signals';

import { ZardButtonComponent } from '@/shared/components/button';
import { FormFieldLayoutComponent } from '@/ui/layout/form-field-layout/form-field-layout.component';

export interface FeatureFlowFormData {
  name: string;
}

@Component({
  selector: 'app-feature-flow-form',
  imports: [FormFieldLayoutComponent, ZardButtonComponent],
  template: `
    <form (submit)="onSubmit($event)" class="flex flex-col gap-4 max-w-xl">
      <app-form-field-layout [field]="form.name" id="feature-flow-name" label="Name" autocomplete="off" />

      <div class="flex items-center gap-2">
        <button z-button type="submit" [zLoading]="loading()">Save</button>
        <ng-content select="[formActions]" />
      </div>
    </form>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FeatureFlowFormComponent {
  readonly initialData = input<FeatureFlowFormData>();
  readonly loading = input(false);
  readonly submitted = output<FeatureFlowFormData>();

  readonly model = signal<FeatureFlowFormData>({ name: '' });
  readonly form = form(this.model, (schemaPath) => {
    required(schemaPath.name, { message: 'Name is required' });
  });

  constructor() {
    effect(() => {
      const data = this.initialData();
      if (data) {
        this.model.set(data);
      } else {
        this.model.set({ name: '' });
      }
    });
  }

  async onSubmit(event: Event) {
    event.preventDefault();
    await submit(this.form, {
      action: async () => this.submitted.emit(this.model()),
    });
  }
}
