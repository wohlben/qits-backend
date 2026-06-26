---
name: create-form
description: Guidelines for creating Angular forms in this project. Use whenever a form, input validation, or form submission logic is needed. Enforces Signal Forms exclusively.
---

# Create Form

This project uses **Signal Forms** exclusively. Do **not** use template-driven forms or the legacy `FormGroup`/`FormControl` reactive forms API.

Signal Forms are part of `@angular/forms` (Angular v21+). Import from `@angular/forms/signals`.

> **Reference:** https://angular.dev/guide/forms/signals/overview  
> Signal Forms are currently experimental. The API may change.

## Directory Conventions

- **Presentational forms** (pure UI, no API calls) → `$ui/forms/<domain>/`
- **Domain-specific inputs** (custom label + control + error) → `$ui/inputs/<domain>/`
- See `src/app/ui/forms/AGENTS.md` and `src/app/ui/inputs/AGENTS.md` for full conventions.

## Basic Pattern

```typescript
import { Component, effect, input, output, signal } from '@angular/core';
import { form, required, submit } from '@angular/forms/signals';

import { ZardButtonComponent } from '@/shared/components/button';
import { FormFieldLayoutComponent } from '@/ui/layout/form-field-layout/form-field-layout.component';

export interface ProjectFormData {
  name: string;
  description: string;
}

@Component({
  selector: 'app-project-form',
  imports: [FormFieldLayoutComponent, ZardButtonComponent],
  template: `
    <form (submit)="onSubmit($event)" class="flex flex-col gap-4 max-w-xl">
      <app-form-field-layout [field]="form.name" id="project-name" label="Name" autocomplete="off" />
      <app-form-field-layout [field]="form.description" id="project-description" label="Description" />

      <div class="flex items-center gap-2">
        <button z-button type="submit" [zLoading]="loading()">Save</button>
        <ng-content select="[formActions]" />
      </div>
    </form>
  `,
})
export class ProjectFormComponent {
  readonly initialData = input<ProjectFormData>();
  readonly loading = input(false);
  readonly submitted = output<ProjectFormData>();

  readonly model = signal<ProjectFormData>({ name: '', description: '' });
  readonly form = form(this.model, (schemaPath) => {
    required(schemaPath.name, { message: 'Name is required' });
  });

  constructor() {
    effect(() => {
      const data = this.initialData();
      if (data) this.model.set(data);
    });
  }

  async onSubmit(event: Event) {
    event.preventDefault();
    await submit(this.form, {
      action: async () => this.submitted.emit(this.model()),
    });
  }
}
```

## Key Rules

1. **Model first** — Create a plain `signal()` holding the form data object. Always initialize every field.
2. **Field tree** — Pass the model to `form(model, schema?)`. This returns a field tree that mirrors the model shape.
3. **Binding** — Use `app-form-field-layout` for standard text inputs. It handles `[formField]` binding, label, and error display automatically. Only create a domain-specific input component in `$ui/inputs/<domain>/` when the control is non-standard (textarea, select, etc.).
4. **Validation** — Define rules in the schema callback (second arg to `form()`). Use built-in validators like `required()`, `email()`, `minLength()`, `maxLength()`, `pattern()`, etc.
5. **Field state** — Access per-field state by calling the field: `form.field()` returns a `FieldState` with signals:
   - `.value()` — current value (writable signal)
   - `.valid()` / `.invalid()` — validation status
   - `.errors()` — array of validation errors
   - `.touched()` / `.dirty()` — interaction state
   - `.pending()` — async validation in progress
6. **Reading values** — Read the whole model with `this.model()` for submission. Read individual values with `this.form.field().value()`.
7. **Updating values** — Set the whole model with `this.model.set({...})`. Update a single field with `this.form.field().value.set(newValue)` or `.update(v => v + 1)`.
8. **Submit** — Use the `submit()` function from `@angular/forms/signals`. It validates the form and runs the provided `action` only if valid.
9. **Types** — Always type the model signal explicitly. The field tree derives full type safety from it.
10. **No side effects** — Form components must not inject services, call APIs, or navigate. They receive data via `@Input()` and emit via `@Output()`. Smart parent components in `$pattern/` or `$page/` handle orchestration.

## `app-form-field-layout`

Use `app-form-field-layout` as the default building block for form fields. It provides:

- A label (auto-linked to the input via `id`)
- A zard-styled text input (`input[z-input]`)
- Error messages rendered automatically when `touched && invalid`

```html
<app-form-field-layout
  [field]="form.email"
  id="login-email"
  label="Email"
  placeholder="you@example.com"
  autocomplete="email"
/>
```

For non-standard controls (textarea, select, custom error styling), create a domain-specific component in `$ui/inputs/<domain>/`. See `src/app/ui/inputs/AGENTS.md`.
