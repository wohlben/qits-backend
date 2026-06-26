import { Directive, input } from '@angular/core';

@Directive({
  selector: '[appFormFieldSlot]',
})
export class FormFieldSlotDirective {
  readonly appFormFieldSlot = input.required<'label' | 'input' | 'error'>();
}
