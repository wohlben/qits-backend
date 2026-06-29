import { ChangeDetectionStrategy, Component, effect, input, output, signal } from '@angular/core';
import { form, required, submit } from '@angular/forms/signals';

import { FormField } from '@angular/forms/signals';
import { ActionVariant } from '@/api/model/actionVariant';
import { ZardButtonComponent } from '@/shared/components/button';
import { ZardCheckboxComponent } from '@/shared/components/checkbox';
import { ZardInputDirective } from '@/shared/components/input';
import { ZardSelectImports } from '@/shared/components/select/select.imports';
import { FormFieldLayoutComponent } from '@/ui/layout/form-field-layout/form-field-layout.component';
import { FormFieldSlotDirective } from '@/ui/layout/form-field-layout/form-field-slot.directive';

export interface EnvVarRow {
  key: string;
  value: string;
}

export interface ActionConfigurationFormData {
  name: string;
  description: string;
  executeScript: string;
  checkScript: string;
  interactive: boolean;
  variant: ActionVariant;
  environment: EnvVarRow[];
}

@Component({
  selector: 'app-action-configuration-form',
  imports: [
    FormField,
    FormFieldLayoutComponent,
    FormFieldSlotDirective,
    ZardButtonComponent,
    ZardCheckboxComponent,
    ZardInputDirective,
    ZardSelectImports,
  ],
  template: `
    <form (submit)="onSubmit($event)" class="flex flex-col gap-4 max-w-xl">
      <app-form-field-layout [field]="form.name" id="action-name" label="Name" autocomplete="off" />

      <app-form-field-layout [field]="form.description" id="action-description" label="Description">
        <textarea appFormFieldSlot="input" z-input rows="3" [formField]="form.description"></textarea>
      </app-form-field-layout>

      <app-form-field-layout [field]="form.executeScript" id="action-execute-script" label="Execute Script">
        <textarea appFormFieldSlot="input" z-input rows="4" [formField]="form.executeScript"></textarea>
      </app-form-field-layout>

      <app-form-field-layout [field]="form.checkScript" id="action-check-script" label="Check Script (optional)">
        <textarea appFormFieldSlot="input" z-input rows="4" [formField]="form.checkScript"></textarea>
      </app-form-field-layout>

      <!-- The variant is a typed, backend-rendered parameterization. Shell runs the script as-is;
           special variants (e.g. Claude + actions MCP) have their flags built by the backend. -->
      <app-form-field-layout [field]="form.variant" id="action-variant" label="Variant">
        <z-select appFormFieldSlot="input" [formField]="form.variant">
          <z-select-item zValue="SHELL">Shell — run the script verbatim</z-select-item>
          <z-select-item zValue="CLAUDE_ACTIONS_MCP">
            Claude Code + actions MCP (scoped to the repository)
          </z-select-item>
          <z-select-item zValue="CLAUDE_REPOSITORY_MCP">
            Claude Code + repository MCP (narrowed to one repository)
          </z-select-item>
          <z-select-item zValue="CLAUDE_PROJECT_MCP">
            Claude Code + repository MCP (scoped to the whole project)
          </z-select-item>
        </z-select>
      </app-form-field-layout>

      <!-- Interactive actions (a shell, Claude Code) run in the worktree terminal and are offered by
           the Run… picker. One-off commands (e.g. mvn test) are not interactive. -->
      <z-checkbox [formField]="form.interactive">
        Interactive (runs in a worktree terminal)
      </z-checkbox>

      <!-- Environment variables overlaid on the process env when the action runs in a terminal. -->
      <fieldset class="flex flex-col gap-2">
        <legend class="text-sm font-medium">Environment variables</legend>
        @for (row of model().environment; track $index) {
          <div class="flex items-center gap-2">
            <input
              z-input
              class="flex-1"
              placeholder="KEY"
              autocomplete="off"
              [value]="row.key"
              (input)="updateEnvKey($index, $any($event.target).value)"
              [attr.aria-label]="'Variable ' + ($index + 1) + ' name'"
            />
            <input
              z-input
              class="flex-1"
              placeholder="value"
              autocomplete="off"
              [value]="row.value"
              (input)="updateEnvValue($index, $any($event.target).value)"
              [attr.aria-label]="'Variable ' + ($index + 1) + ' value'"
            />
            <button
              z-button
              zType="ghost"
              type="button"
              (click)="removeEnvRow($index)"
              [attr.aria-label]="'Remove variable ' + ($index + 1)"
            >
              Remove
            </button>
          </div>
        }
        <div>
          <button z-button zType="secondary" type="button" (click)="addEnvRow()">
            Add variable
          </button>
        </div>
      </fieldset>

      <div class="flex items-center gap-2">
        <button z-button type="submit" [zLoading]="loading()">Save</button>
        <ng-content select="[formActions]" />
      </div>
    </form>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ActionConfigurationFormComponent {
  readonly initialData = input<ActionConfigurationFormData>();
  readonly loading = input(false);
  readonly submitted = output<ActionConfigurationFormData>();

  readonly model = signal<ActionConfigurationFormData>({
    name: '',
    description: '',
    executeScript: '',
    checkScript: '',
    interactive: false,
    variant: ActionVariant.Shell,
    environment: [],
  });
  readonly form = form(this.model, (schemaPath) => {
    required(schemaPath.name, { message: 'Name is required' });
    required(schemaPath.executeScript, { message: 'Execute script is required' });
  });

  constructor() {
    effect(() => {
      const data = this.initialData();
      if (data) this.model.set(data);
    });
  }

  addEnvRow() {
    this.model.update((m) => ({ ...m, environment: [...m.environment, { key: '', value: '' }] }));
  }

  removeEnvRow(index: number) {
    this.model.update((m) => ({
      ...m,
      environment: m.environment.filter((_, i) => i !== index),
    }));
  }

  updateEnvKey(index: number, key: string) {
    this.model.update((m) => ({
      ...m,
      environment: m.environment.map((row, i) => (i === index ? { ...row, key } : row)),
    }));
  }

  updateEnvValue(index: number, value: string) {
    this.model.update((m) => ({
      ...m,
      environment: m.environment.map((row, i) => (i === index ? { ...row, value } : row)),
    }));
  }

  async onSubmit(event: Event) {
    event.preventDefault();
    await submit(this.form, {
      action: async () => this.submitted.emit(this.model()),
    });
  }
}
