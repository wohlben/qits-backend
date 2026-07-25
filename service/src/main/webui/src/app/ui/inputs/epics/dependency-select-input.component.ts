import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { FormField } from '@angular/forms/signals';
import type { FieldTree } from '@angular/forms/signals';

import { ZardSelectComponent } from '@/shared/components/select';
import { ZardSelectItemComponent } from '@/shared/components/select/select-item.component';
import { FormFieldLayoutComponent } from '@/ui/layout/form-field-layout/form-field-layout.component';
import { FormFieldSlotDirective } from '@/ui/layout/form-field-layout/form-field-slot.directive';

export interface DependencyOption {
  id: string;
  title: string;
}

/**
 * Optional depends-on picker over sibling features/tasks. The empty value means "no dependency";
 * excluding the entity itself from the options is the caller's job.
 */
@Component({
  selector: 'app-dependency-select-input',
  imports: [
    FormField,
    FormFieldLayoutComponent,
    FormFieldSlotDirective,
    ZardSelectComponent,
    ZardSelectItemComponent,
  ],
  template: `
    <app-form-field-layout [field]="field()" [id]="id()" [label]="label()">
      <z-select appFormFieldSlot="input" [id]="id()" [formField]="field()" zPlaceholder="None">
        <z-select-item zValue="">None</z-select-item>
        @for (option of options(); track option.id) {
          <z-select-item [zValue]="option.id">{{ option.title }}</z-select-item>
        }
      </z-select>
    </app-form-field-layout>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DependencySelectInputComponent {
  readonly field = input.required<FieldTree<string>>();
  readonly options = input.required<DependencyOption[]>();
  readonly id = input.required<string>();
  readonly label = input('Depends on');
}
