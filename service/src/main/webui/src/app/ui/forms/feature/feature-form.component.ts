import { ChangeDetectionStrategy, Component, effect, input, output, signal } from '@angular/core';
import { form, required, submit } from '@angular/forms/signals';

import { ZardButtonComponent } from '@/shared/components/button';
import {
  DependencyOption,
  DependencySelectInputComponent,
} from '@/ui/inputs/epics/dependency-select-input.component';
import { EpicDescriptionInputComponent } from '@/ui/inputs/epics/epic-description-input.component';
import { FormFieldLayoutComponent } from '@/ui/layout/form-field-layout/form-field-layout.component';

export interface FeatureFormData {
  title: string;
  description: string;
  /** Empty string means "no dependency". */
  dependsOnFeatureId: string;
}

@Component({
  selector: 'app-feature-form',
  imports: [
    DependencySelectInputComponent,
    EpicDescriptionInputComponent,
    FormFieldLayoutComponent,
    ZardButtonComponent,
  ],
  template: `
    <form (submit)="onSubmit($event)" class="flex flex-col gap-4 max-w-xl">
      <app-form-field-layout
        [field]="form.title"
        id="feature-title"
        label="Title"
        autocomplete="off"
      />

      <app-epic-description-input [field]="form.description" id="feature-description" />

      <app-dependency-select-input
        [field]="form.dependsOnFeatureId"
        [options]="dependencyOptions()"
        id="feature-depends-on"
        label="Depends on feature"
      />

      <div class="flex items-center gap-2">
        <button z-button type="submit" [zLoading]="loading()">Save</button>
        <ng-content select="[formActions]" />
      </div>
    </form>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FeatureFormComponent {
  readonly initialData = input<FeatureFormData>();
  readonly loading = input(false);
  readonly dependencyOptions = input<DependencyOption[]>([]);
  readonly submitted = output<FeatureFormData>();

  readonly model = signal<FeatureFormData>({ title: '', description: '', dependsOnFeatureId: '' });
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
