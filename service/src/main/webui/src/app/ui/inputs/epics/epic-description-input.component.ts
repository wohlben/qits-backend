import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { FormField } from '@angular/forms/signals';
import type { FieldTree } from '@angular/forms/signals';

import { ZardInputDirective } from '@/shared/components/input/input.directive';
import { FormFieldLayoutComponent } from '@/ui/layout/form-field-layout/form-field-layout.component';
import { FormFieldSlotDirective } from '@/ui/layout/form-field-layout/form-field-slot.directive';

/** Shared markdown-description textarea for the epic/feature/task forms. */
@Component({
  selector: 'app-epic-description-input',
  imports: [FormField, FormFieldLayoutComponent, FormFieldSlotDirective, ZardInputDirective],
  template: `
    <app-form-field-layout [field]="field()" [id]="id()" label="Description (Markdown)">
      <textarea appFormFieldSlot="input" z-input rows="6" [id]="id()" [formField]="field()"></textarea>
    </app-form-field-layout>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EpicDescriptionInputComponent {
  readonly field = input.required<FieldTree<string>>();
  readonly id = input.required<string>();
}
