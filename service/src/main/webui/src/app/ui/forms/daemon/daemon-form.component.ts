import { ChangeDetectionStrategy, Component, effect, input, output, signal } from '@angular/core';
import { form, required, submit } from '@angular/forms/signals';

import { FormField } from '@angular/forms/signals';
import { ZardButtonComponent } from '@/shared/components/button';
import { ZardCheckboxComponent } from '@/shared/components/checkbox';
import { ZardInputDirective } from '@/shared/components/input';
import { ZardSelectComponent } from '@/shared/components/select';
import { ZardSelectItemComponent } from '@/shared/components/select/select-item.component';
import { FormFieldLayoutComponent } from '@/ui/layout/form-field-layout/form-field-layout.component';
import { FormFieldSlotDirective } from '@/ui/layout/form-field-layout/form-field-slot.directive';

export interface DaemonEnvVarRow {
  key: string;
  value: string;
}

export interface DaemonObserverRow {
  kind: 'PATTERN' | 'LOG_LEVEL';
  pattern: string;
  severity: 'INFO' | 'WARNING' | 'ERROR';
}

export interface DaemonSourceRow {
  path: string;
  label: string;
}

export interface DaemonFormData {
  name: string;
  description: string;
  startScript: string;
  readyPattern: string;
  stopSignal: string;
  restartPolicy: 'NEVER' | 'ON_FAILURE' | 'ALWAYS';
  /** Kept as text in the form (signal-form fields are string-typed); parsed on submit. */
  maxRestarts: string;
  otel: boolean;
  /** HTTP port the daemon serves in its container; empty = not web-viewable. Text like maxRestarts. */
  httpPort: string;
  environment: DaemonEnvVarRow[];
  observers: DaemonObserverRow[];
  sources: DaemonSourceRow[];
}

@Component({
  selector: 'app-daemon-form',
  imports: [
    FormField,
    FormFieldLayoutComponent,
    FormFieldSlotDirective,
    ZardButtonComponent,
    ZardCheckboxComponent,
    ZardInputDirective,
    ZardSelectComponent,
    ZardSelectItemComponent,
  ],
  template: `
    <form (submit)="onSubmit($event)" class="flex flex-col gap-4 max-w-xl">
      <app-form-field-layout [field]="form.name" id="daemon-name" label="Name" autocomplete="off" />

      <app-form-field-layout [field]="form.description" id="daemon-description" label="Description">
        <textarea appFormFieldSlot="input" z-input rows="2" [formField]="form.description"></textarea>
      </app-form-field-layout>

      <app-form-field-layout [field]="form.startScript" id="daemon-start-script" label="Start Script">
        <textarea appFormFieldSlot="input" z-input rows="3" [formField]="form.startScript"></textarea>
      </app-form-field-layout>

      <!-- The first output line matching this regex flips the instance STARTING to READY; leave
           empty to consider the daemon ready after a short grace period. -->
      <app-form-field-layout
        [field]="form.readyPattern"
        id="daemon-ready-pattern"
        label="Ready pattern (regex, optional)"
        autocomplete="off"
      />

      <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <app-form-field-layout [field]="form.restartPolicy" id="daemon-restart-policy" label="Restart policy">
          <z-select appFormFieldSlot="input" [formField]="form.restartPolicy" zPlaceholder="Select…">
            <z-select-item zValue="NEVER">Never</z-select-item>
            <z-select-item zValue="ON_FAILURE">On failure</z-select-item>
            <z-select-item zValue="ALWAYS">Always</z-select-item>
          </z-select>
        </app-form-field-layout>

        <app-form-field-layout [field]="form.maxRestarts" id="daemon-max-restarts" label="Max restarts">
          <input appFormFieldSlot="input" z-input inputmode="numeric" [formField]="form.maxRestarts" />
        </app-form-field-layout>

        <app-form-field-layout
          [field]="form.stopSignal"
          id="daemon-stop-signal"
          label="Stop signal"
          autocomplete="off"
        />
      </div>

      <!-- When set, the daemon's app becomes web-viewable in qits through the /daemon proxy;
           the dev server must listen on 0.0.0.0 and serve under $QITS_PUBLIC_BASE. -->
      <app-form-field-layout
        [field]="form.httpPort"
        id="daemon-http-port"
        label="HTTP port (optional — makes the daemon web-viewable)"
      >
        <input appFormFieldSlot="input" z-input inputmode="numeric" [formField]="form.httpPort" />
      </app-form-field-layout>

      <!-- With OTel on, the launch injects OTEL_EXPORTER_* env vars so an instrumented process
           exports traces/logs/metrics to qits — queryable in the workspace's Telemetry tab and by
           its agent. Instrumentation itself stays the app's business. -->
      <z-checkbox [formField]="form.otel">
        OpenTelemetry export (inject OTEL_* env vars at launch)
      </z-checkbox>

      <!-- Observers watch the daemon's output: PATTERN emits an event per matching line,
           LOG_LEVEL classifies output batches locally off standard severity tokens. -->
      <fieldset class="flex flex-col gap-2">
        <legend class="text-sm font-medium">Log observers</legend>
        @for (row of model().observers; track $index) {
          <div class="flex flex-wrap items-center gap-2 rounded-md border p-2">
            <select
              class="h-9 rounded-md border bg-transparent px-2 text-sm"
              [value]="row.kind"
              (change)="updateObserver($index, 'kind', $any($event.target).value)"
              [attr.aria-label]="'Observer ' + ($index + 1) + ' kind'"
            >
              <option value="PATTERN">Pattern</option>
              <option value="LOG_LEVEL">Log level</option>
            </select>
            @if (row.kind === 'PATTERN') {
              <input
                z-input
                class="flex-1"
                placeholder="regex, e.g. ERROR|Traceback"
                autocomplete="off"
                [value]="row.pattern"
                (input)="updateObserver($index, 'pattern', $any($event.target).value)"
                [attr.aria-label]="'Observer ' + ($index + 1) + ' pattern'"
              />
              <select
                class="h-9 rounded-md border bg-transparent px-2 text-sm"
                [value]="row.severity"
                (change)="updateObserver($index, 'severity', $any($event.target).value)"
                [attr.aria-label]="'Observer ' + ($index + 1) + ' severity'"
              >
                <option value="INFO">Info</option>
                <option value="WARNING">Warning</option>
                <option value="ERROR">Error</option>
              </select>
            } @else {
              <span class="flex-1 text-xs text-muted-foreground">
                Classifies ERROR/WARN tokens, exception names and stack traces in the output
              </span>
            }
            <button
              z-button
              zType="ghost"
              type="button"
              (click)="removeObserver($index)"
              [attr.aria-label]="'Remove observer ' + ($index + 1)"
            >
              Remove
            </button>
          </div>
        }
        <div>
          <button z-button zType="secondary" type="button" (click)="addObserver()">
            Add observer
          </button>
        </div>
      </fieldset>

      <!-- FILE log sources: workspace-relative files tailed alongside the process output; every
           observer above watches these too. -->
      <fieldset class="flex flex-col gap-2">
        <legend class="text-sm font-medium">Log sources (tailed files)</legend>
        @for (row of model().sources; track $index) {
          <div class="flex items-center gap-2">
            <input
              z-input
              class="flex-1"
              placeholder="workspace-relative path, e.g. logs/app.log"
              autocomplete="off"
              [value]="row.path"
              (input)="updateSource($index, 'path', $any($event.target).value)"
              [attr.aria-label]="'Source ' + ($index + 1) + ' path'"
            />
            <input
              z-input
              class="flex-1"
              placeholder="label (optional)"
              autocomplete="off"
              [value]="row.label"
              (input)="updateSource($index, 'label', $any($event.target).value)"
              [attr.aria-label]="'Source ' + ($index + 1) + ' label'"
            />
            <button
              z-button
              zType="ghost"
              type="button"
              (click)="removeSource($index)"
              [attr.aria-label]="'Remove source ' + ($index + 1)"
            >
              Remove
            </button>
          </div>
        }
        <div>
          <button z-button zType="secondary" type="button" (click)="addSource()">
            Add log source
          </button>
        </div>
      </fieldset>

      <!-- Environment variables overlaid on the process env when the daemon runs. -->
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
export class DaemonFormComponent {
  readonly initialData = input<DaemonFormData>();
  readonly loading = input(false);
  readonly submitted = output<DaemonFormData>();

  readonly model = signal<DaemonFormData>({
    name: '',
    description: '',
    startScript: '',
    readyPattern: '',
    stopSignal: 'TERM',
    restartPolicy: 'ON_FAILURE',
    maxRestarts: '3',
    otel: false,
    httpPort: '',
    environment: [],
    observers: [],
    sources: [],
  });
  readonly form = form(this.model, (schemaPath) => {
    required(schemaPath.name, { message: 'Name is required' });
    required(schemaPath.startScript, { message: 'Start script is required' });
  });

  constructor() {
    effect(() => {
      const data = this.initialData();
      if (data) this.model.set(data);
    });
  }

  addObserver() {
    this.model.update((m) => ({
      ...m,
      observers: [...m.observers, { kind: 'PATTERN', pattern: '', severity: 'ERROR' }],
    }));
  }

  removeObserver(index: number) {
    this.model.update((m) => ({
      ...m,
      observers: m.observers.filter((_, i) => i !== index),
    }));
  }

  updateObserver(index: number, field: keyof DaemonObserverRow, value: string) {
    this.model.update((m) => ({
      ...m,
      observers: m.observers.map((row, i) => (i === index ? { ...row, [field]: value } : row)),
    }));
  }

  addSource() {
    this.model.update((m) => ({
      ...m,
      sources: [...m.sources, { path: '', label: '' }],
    }));
  }

  removeSource(index: number) {
    this.model.update((m) => ({
      ...m,
      sources: m.sources.filter((_, i) => i !== index),
    }));
  }

  updateSource(index: number, field: keyof DaemonSourceRow, value: string) {
    this.model.update((m) => ({
      ...m,
      sources: m.sources.map((row, i) => (i === index ? { ...row, [field]: value } : row)),
    }));
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
