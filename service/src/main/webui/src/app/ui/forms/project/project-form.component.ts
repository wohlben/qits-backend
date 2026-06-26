import { ChangeDetectionStrategy, Component, effect, input, output, signal } from '@angular/core';
import { form, required, submit } from '@angular/forms/signals';

import { ZardButtonComponent } from '@/shared/components/button';
import { ProjectDescriptionInputComponent } from '@/ui/inputs/projects/project-description-input.component';
import { FormFieldLayoutComponent } from '@/ui/layout/form-field-layout/form-field-layout.component';

export interface ProjectFormData {
  name: string;
  description: string;
}

@Component({
  selector: 'app-project-form',
  imports: [FormFieldLayoutComponent, ProjectDescriptionInputComponent, ZardButtonComponent],
  template: `
    <form (submit)="onSubmit($event)" class="flex flex-col gap-4 max-w-xl">
      <app-form-field-layout [field]="form.name" id="project-name" label="Name" autocomplete="off" />

      <app-project-description-input [field]="form.description" />

      <div class="flex items-center gap-2">
        <button z-button type="submit" [zLoading]="loading()">Save</button>
        <ng-content select="[formActions]" />
      </div>
    </form>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectFormComponent {
  readonly initialData = input<ProjectFormData>();
  readonly loading = input(false);
  readonly submitted = output<ProjectFormData>();

  readonly model = signal<ProjectFormData>({ name: '', description: '' });
  readonly form = form(this.model, (schemaPath) => {
    required(schemaPath.name, { message: 'Name is required' });
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
