import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { form, required, submit } from '@angular/forms/signals';

import { ZardButtonComponent } from '@/shared/components/button';
import { RepositoryArchetypeInputComponent } from '@/ui/inputs/repositories/repository-archetype-input.component';
import { FormFieldLayoutComponent } from '@/ui/layout/form-field-layout/form-field-layout.component';

export interface RepositoryFormData {
  url: string;
  archetype: string;
}

@Component({
  selector: 'app-repository-form',
  imports: [FormFieldLayoutComponent, RepositoryArchetypeInputComponent, ZardButtonComponent],
  template: `
    <form (submit)="onSubmit($event)" class="flex flex-col gap-4 max-w-xl">
      <app-form-field-layout [field]="form.url" id="repository-url" label="Repository URL" autocomplete="off" />

      <app-repository-archetype-input [field]="form.archetype" />

      <div class="flex items-center gap-2">
        <button z-button type="submit" [zLoading]="loading()">Save</button>
        <ng-content select="[formActions]" />
      </div>
    </form>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RepositoryFormComponent {
  readonly loading = input(false);
  readonly submitted = output<RepositoryFormData>();

  readonly model = signal<RepositoryFormData>({ url: '', archetype: '' });
  readonly form = form(this.model, (schemaPath) => {
    required(schemaPath.url, { message: 'URL is required' });
  });

  async onSubmit(event: Event) {
    event.preventDefault();
    await submit(this.form, {
      action: async () => this.submitted.emit(this.model()),
    });
  }
}
