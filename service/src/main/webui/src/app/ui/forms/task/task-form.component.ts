import { ChangeDetectionStrategy, Component, effect, input, output, signal } from '@angular/core';
import { form, required, submit } from '@angular/forms/signals';

import { ZardButtonComponent } from '@/shared/components/button';
import {
  DependencyOption,
  DependencySelectInputComponent,
} from '@/ui/inputs/epics/dependency-select-input.component';
import { EpicDescriptionInputComponent } from '@/ui/inputs/epics/epic-description-input.component';
import {
  RepositoryOption,
  RepositorySelectInputComponent,
} from '@/ui/inputs/epics/repository-select-input.component';
import { FormFieldLayoutComponent } from '@/ui/layout/form-field-layout/form-field-layout.component';

export interface TaskFormData {
  title: string;
  description: string;
  repositoryId: string;
  /** Empty string means "no dependency". */
  dependsOnTaskId: string;
}

/**
 * In edit mode the repository picker is hidden: the API cannot rebind a task's repository
 * (UpdateTaskRequest has no repositoryId) — the model still carries the current binding so the
 * required() validation passes.
 */
@Component({
  selector: 'app-task-form',
  imports: [
    DependencySelectInputComponent,
    EpicDescriptionInputComponent,
    FormFieldLayoutComponent,
    RepositorySelectInputComponent,
    ZardButtonComponent,
  ],
  template: `
    <form (submit)="onSubmit($event)" class="flex flex-col gap-4 max-w-xl">
      <app-form-field-layout [field]="form.title" id="task-title" label="Title" autocomplete="off" />

      <app-epic-description-input [field]="form.description" id="task-description" />

      @if (mode() === 'create') {
        <app-repository-select-input
          [field]="form.repositoryId"
          [options]="repositoryOptions()"
          id="task-repository"
        />
      }

      <app-dependency-select-input
        [field]="form.dependsOnTaskId"
        [options]="dependencyOptions()"
        id="task-depends-on"
        label="Depends on task"
      />

      <div class="flex items-center gap-2">
        <button z-button type="submit" [zLoading]="loading()">Save</button>
        <ng-content select="[formActions]" />
      </div>
    </form>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TaskFormComponent {
  readonly initialData = input<TaskFormData>();
  readonly loading = input(false);
  readonly mode = input<'create' | 'edit'>('create');
  readonly repositoryOptions = input<RepositoryOption[]>([]);
  readonly dependencyOptions = input<DependencyOption[]>([]);
  readonly submitted = output<TaskFormData>();

  readonly model = signal<TaskFormData>({
    title: '',
    description: '',
    repositoryId: '',
    dependsOnTaskId: '',
  });
  readonly form = form(this.model, (schemaPath) => {
    required(schemaPath.title, { message: 'Title is required' });
    required(schemaPath.repositoryId, { message: 'Repository is required' });
  });

  constructor() {
    effect(() => {
      const data = this.initialData();
      if (data) {
        this.model.set(data);
      }
    });
  }

  async onSubmit(event: Event) {
    event.preventDefault();
    await submit(this.form, {
      action: async () => this.submitted.emit(this.model()),
    });
  }
}
