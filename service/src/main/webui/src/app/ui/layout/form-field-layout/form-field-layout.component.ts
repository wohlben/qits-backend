import { ChangeDetectionStrategy, Component, computed, contentChildren, input } from '@angular/core';
import { FormField } from '@angular/forms/signals';
import type { FieldTree } from '@angular/forms/signals';

import { ZardInputDirective } from '@/shared/components/input/input.directive';

import { FormFieldSlotDirective } from './form-field-slot.directive';

@Component({
  selector: 'app-form-field-layout',
  imports: [FormField, ZardInputDirective],
  template: `
    <div class="flex flex-col gap-2">
      @if (hasCustomLabel()) {
        <ng-content select="[appFormFieldSlot='label']"></ng-content>
      } @else {
        <label [attr.for]="hasCustomInput() ? null : id()" class="text-sm font-medium">{{ label() }}</label>
      }

      @if (hasCustomInput()) {
        <ng-content select="[appFormFieldSlot='input']"></ng-content>
      } @else {
        <input
          [id]="id()"
          z-input
          type="text"
          [placeholder]="placeholder() ?? ''"
          [attr.autocomplete]="autocomplete()"
          [formField]="field()"
        />
      }

      @if (hasCustomError()) {
        <ng-content select="[appFormFieldSlot='error']"></ng-content>
      }
      @for (error of errors(); track error) {
        <p class="text-sm text-destructive">{{ error.message }}</p>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FormFieldLayoutComponent {
  readonly field = input.required<FieldTree<string>>();
  readonly id = input.required<string>();
  readonly label = input<string>();
  readonly placeholder = input<string>();
  readonly autocomplete = input<string>();

  private readonly customSlots = contentChildren(FormFieldSlotDirective);

  protected readonly hasCustomLabel = computed(() =>
    this.customSlots().some((s) => s.appFormFieldSlot() === 'label'),
  );

  protected readonly hasCustomInput = computed(() =>
    this.customSlots().some((s) => s.appFormFieldSlot() === 'input'),
  );

  protected readonly hasCustomError = computed(() =>
    this.customSlots().some((s) => s.appFormFieldSlot() === 'error'),
  );

  protected readonly fieldState = computed(() => this.field()());

  protected readonly errors = computed(() => {
    const state = this.fieldState();
    return state.touched() ? state.errors() : [];
  });
}
