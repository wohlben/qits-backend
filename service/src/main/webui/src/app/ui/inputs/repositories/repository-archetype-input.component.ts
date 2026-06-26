import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { FormField } from '@angular/forms/signals';
import type { FieldTree } from '@angular/forms/signals';

import { ZardSelectComponent } from '@/shared/components/select';
import { ZardSelectItemComponent } from '@/shared/components/select/select-item.component';
import { FormFieldLayoutComponent } from '@/ui/layout/form-field-layout/form-field-layout.component';
import { FormFieldSlotDirective } from '@/ui/layout/form-field-layout/form-field-slot.directive';

@Component({
  selector: 'app-repository-archetype-input',
  imports: [FormField, FormFieldLayoutComponent, FormFieldSlotDirective, ZardSelectComponent, ZardSelectItemComponent],
  template: `
    <app-form-field-layout [field]="field()" id="repository-archetype" label="Archetype">
      <z-select appFormFieldSlot="input" [formField]="field()" zPlaceholder="Select…">
        <z-select-item zValue="SERVICE">Service</z-select-item>
        <z-select-item zValue="SERVICE_TEMPLATE">Service Template</z-select-item>
        <z-select-item zValue="FORK">Fork</z-select-item>
      </z-select>
    </app-form-field-layout>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RepositoryArchetypeInputComponent {
  readonly field = input.required<FieldTree<string>>();
}
