# Inputs

This directory contains **domain-specific input components** that wrap a `FormField` with a label, zard-styled control, and error display. They are **not** generic reusable inputs — they are tailored to a specific field in a specific domain.

## Directory Structure

```
src/app/ui/inputs/
  <domain>/
    <domain>-<field>-input.component.ts
```

Example:
```
src/app/ui/inputs/
  projects/
    project-description-input.component.ts
  repositories/
    repository-archetype-input.component.ts
```

## Golden Rule

**Only create an input component when customization is needed.**

For standard text inputs, use `app-form-field-layout` directly in the form template. Do **not** create a component.

```html
<!-- In a form — use directly -->
<app-form-field-layout [field]="form.name" id="project-name" label="Name" autocomplete="off" />
```

Create an input component **only** when the default text input is insufficient:
- Textarea instead of `input`
- Select / combobox
- Custom error styling
- Custom label behavior

## Conventions

### Single Required Input: `field`

```typescript
readonly field = input.required<FieldTree<string>>();
```

The component reads `FieldState` from the injected `FORM_FIELD` token (provided by the `[formField]` directive inside `app-form-field-layout`).

### Wrap `app-form-field-layout`

All input components wrap `app-form-field-layout`. They override the default input via content projection when needed.

```typescript
@Component({
  selector: 'app-project-description-input',
  imports: [FormField, FormFieldLayoutComponent, FormFieldSlotDirective, ZardInputDirective],
  template: `
    <app-form-field-layout [field]="field()" id="project-description" label="Description">
      <textarea appFormFieldSlot="input" z-input rows="3" [formField]="field()"></textarea>
    </app-form-field-layout>
  `,
})
export class ProjectDescriptionInputComponent {
  readonly field = input.required<FieldTree<string>>();
}
```

### Hardcoded Static `id`

The `id` is a static string, not dynamically generated. The component knows what it is.

```html
<app-form-field-layout [field]="field()" id="project-description" label="Description">
```

### Hardcoded Label

The label is baked into the component. Callers do not pass it.

### Use Zard Base Components

Use zard primitives (`z-input`, `z-select`, `z-select-item`) inside the layout. Do **not** reimplement styling.

### No `ControlValueAccessor`

Input components do **not** implement `ControlValueAccessor`. They read and write `FieldState` directly:

```html
<input [formField]="field()" />
<z-select [formField]="field()">...</z-select>
```

### Do Not Create Generic Inputs

Never create components like:
- `text-input`
- `textarea-input`
- `select-input`

These are antipatterns in this codebase. Use `app-form-field-layout` or create a domain-specific component.

## Slot Overrides

`app-form-field-layout` supports three optional content-projection slots via `appFormFieldSlot`:

```html
<app-form-field-layout [field]="field()" id="custom">
  <label appFormFieldSlot="label" class="font-bold">Custom Label</label>
  <input appFormFieldSlot="input" z-input type="email" [formField]="field()" />
  <p appFormFieldSlot="error" class="custom-error">Invalid!</p>
</app-form-field-layout>
```

| Slot | Overrides |
|------|-----------|
| `label` | Default label text |
| `input` | Default `input[type="text"]` |
| `error` | Default error message list |

The layout automatically shows all validation errors beneath the input unless the `error` slot is overridden.
