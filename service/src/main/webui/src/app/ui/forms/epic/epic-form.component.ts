import { ChangeDetectionStrategy, Component, effect, input, output, signal } from '@angular/core';
import { form, required, submit } from '@angular/forms/signals';

import { ZardButtonComponent } from '@/shared/components/button';
import { EpicDescriptionInputComponent } from '@/ui/inputs/epics/epic-description-input.component';
import { FormFieldLayoutComponent } from '@/ui/layout/form-field-layout/form-field-layout.component';

export interface EpicFormData {
  title: string;
  description: string;
}

@Component({
  selector: 'app-epic-form',
  imports: [EpicDescriptionInputComponent, FormFieldLayoutComponent, ZardButtonComponent],
  template: `
    <form (submit)="onSubmit($event)" class="flex flex-col gap-4 max-w-xl">
      <app-form-field-layout [field]="form.title" id="epic-title" label="Title" autocomplete="off" />

      <app-epic-description-input [field]="form.description" id="epic-description" />

      <div class="flex items-center gap-2">
        <button z-button type="submit" [zLoading]="loading()">Save</button>
        <ng-content select="[formActions]" />
      </div>
    </form>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EpicFormComponent {
  readonly initialData = input<EpicFormData>();
  readonly loading = input(false);
  readonly submitted = output<EpicFormData>();

  readonly model = signal<EpicFormData>({ title: '', description: '' });
  readonly form = form(this.model, (schemaPath) => {
    required(schemaPath.title, { message: 'Title is required' });
  });

  constructor() {
    effect(() => {
      const data = this.initialData();
      if (data) {
        this.model.set(data);
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
