# Forms

This directory contains **presentational form components** — pure UI shells that collect user input and emit it. They do not make API calls, handle routing, or manage server state.

## Directory Structure

```
src/app/ui/forms/
  <domain>/
    <form-name>-form.component.ts
```

Example:
```
src/app/ui/forms/
  project/
    project-form.component.ts
  repository/
    repository-form.component.ts
    worktree-create-form.component.ts
```

## Conventions

### Signal Forms Only

Use `@angular/forms/signals` exclusively. Do not use reactive `FormGroup`/`FormControl` or template-driven forms.

```typescript
import { form, required, submit } from '@angular/forms/signals';

readonly model = signal<MyFormData>({ name: '' });
readonly form = form(this.model, (schemaPath) => {
  required(schemaPath.name, { message: 'Name is required' });
});
```

### Declare a FormData Interface

Every form exports its data shape:

```typescript
export interface ProjectFormData {
  name: string;
  description: string;
}
```

### Inputs and Outputs

| Input | Purpose |
|-------|---------|
| `initialData` | Populate the form for edit mode |
| `loading` | Show submission spinner on the submit button |

| Output | Purpose |
|--------|---------|
| `submitted` | Emits the form data when validation passes |

### Use `app-form-field-layout` Directly

For standard text inputs, use `app-form-field-layout` directly in the template. Do **not** create a domain-specific input component unless customization is needed.

```html
<app-form-field-layout [field]="form.name" id="project-name" label="Name" autocomplete="off" />
```

Only import a component from `ui/inputs` when the field requires a non-standard control (textarea, select, etc.).

```html
<app-project-description-input [field]="form.description" />
```

### Form Actions

Support `ng-content` with `[formActions]` for cancel buttons or secondary actions:

```html
<div class="flex items-center gap-2">
  <button z-button type="submit" [zLoading]="loading()">Save</button>
  <ng-content select="[formActions]" />
</div>
```

### No Side Effects

Forms must **not**:
- Inject services
- Call APIs
- Navigate
- Invalidate queries

They receive data via `@Input()` and emit results via `@Output()`. Smart parent components in `$pattern/` or `$page/` handle the rest.

## Example

```typescript
@Component({
  selector: 'app-project-form',
  imports: [FormFieldLayoutComponent, ProjectDescriptionInputComponent, ZardButtonComponent],
  template: `
    <form (submit)="onSubmit($event)" class="flex flex-col gap-4 max-w-xl">
      <app-form-field-layout [field]="form.name" id="project-name" label="Name" autocomplete="off" />
      <app-project-description-input [field]="form.description" />

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
