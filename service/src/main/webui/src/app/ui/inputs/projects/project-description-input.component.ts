import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { FormField } from '@angular/forms/signals';
import type { FieldTree } from '@angular/forms/signals';

import { ZardInputDirective } from '@/shared/components/input/input.directive';
import { FormFieldLayoutComponent } from '@/ui/layout/form-field-layout/form-field-layout.component';
import { FormFieldSlotDirective } from '@/ui/layout/form-field-layout/form-field-slot.directive';

@Component({
  selector: 'app-project-description-input',
  imports: [FormField, FormFieldLayoutComponent, FormFieldSlotDirective, ZardInputDirective],
  template: `
    <app-form-field-layout [field]="field()" id="project-description" label="Description">
      <textarea appFormFieldSlot="input" z-input rows="3" [formField]="field()"></textarea>
    </app-form-field-layout>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectDescriptionInputComponent {
  readonly field = input.required<FieldTree<string>>();
}
