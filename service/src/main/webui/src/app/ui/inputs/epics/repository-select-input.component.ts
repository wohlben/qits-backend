import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { FormField } from '@angular/forms/signals';
import type { FieldTree } from '@angular/forms/signals';

import { ZardSelectComponent } from '@/shared/components/select';
import { ZardSelectItemComponent } from '@/shared/components/select/select-item.component';
import { FormFieldLayoutComponent } from '@/ui/layout/form-field-layout/form-field-layout.component';
import { FormFieldSlotDirective } from '@/ui/layout/form-field-layout/form-field-slot.directive';

export interface RepositoryOption {
  id: string;
  url: string;
}

/** Picker over the project's repositories (a task's binding target); labeled by clone URL. */
@Component({
  selector: 'app-repository-select-input',
  imports: [
    FormField,
    FormFieldLayoutComponent,
    FormFieldSlotDirective,
    ZardSelectComponent,
    ZardSelectItemComponent,
  ],
  template: `
    <app-form-field-layout [field]="field()" [id]="id()" label="Repository">
      <z-select
        appFormFieldSlot="input"
        [id]="id()"
        [formField]="field()"
        zPlaceholder="Select a repository…"
      >
        @for (option of options(); track option.id) {
          <z-select-item [zValue]="option.id">{{ option.url }}</z-select-item>
        }
      </z-select>
    </app-form-field-layout>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RepositorySelectInputComponent {
  readonly field = input.required<FieldTree<string>>();
  readonly options = input.required<RepositoryOption[]>();
  readonly id = input.required<string>();
}
