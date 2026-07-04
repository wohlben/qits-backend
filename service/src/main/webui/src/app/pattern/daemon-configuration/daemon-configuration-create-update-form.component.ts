import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { Router } from '@angular/router';
import { injectMutation, QueryClient } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { DaemonConfigurationControllerService } from '@/api/api/daemonConfigurationController.service';
import { CreateDaemonConfigurationRequest } from '@/api/model/createDaemonConfigurationRequest';
import { DaemonConfigurationDto } from '@/api/model/daemonConfigurationDto';
import { UpdateDaemonConfigurationRequest } from '@/api/model/updateDaemonConfigurationRequest';
import { ZardButtonComponent } from '@/shared/components/button';
import {
  DaemonConfigurationFormComponent,
  DaemonConfigurationFormData,
  DaemonObserverRow,
} from '@/ui/forms/daemon-configuration/daemon-configuration-form.component';

@Component({
  selector: 'app-daemon-configuration-create-update-form',
  imports: [DaemonConfigurationFormComponent, ZardButtonComponent],
  template: `
    <app-daemon-configuration-form
      [initialData]="initialData()"
      [loading]="createMutation.isPending() || updateMutation.isPending()"
      (submitted)="onSubmitted($event)"
    >
      <button formActions z-button zType="secondary" type="button" (click)="onCancel()">
        Cancel
      </button>
      @if (daemon()) {
        <button
          formActions
          z-button
          zType="destructive"
          type="button"
          [zLoading]="deleteMutation.isPending()"
          (click)="onDelete()"
        >
          Delete
        </button>
      }
    </app-daemon-configuration-form>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DaemonConfigurationCreateUpdateFormComponent {
  readonly daemon = input<DaemonConfigurationDto>();
  readonly saved = output<void>();

  private readonly daemonService = inject(DaemonConfigurationControllerService);
  private readonly queryClient = inject(QueryClient);
  private readonly router = inject(Router);

  readonly initialData = computed<DaemonConfigurationFormData | undefined>(() => {
    const d = this.daemon();
    return d
      ? {
          name: d.name ?? '',
          description: d.description ?? '',
          startScript: d.startScript ?? '',
          readyPattern: d.readyPattern ?? '',
          stopSignal: d.stopSignal ?? 'TERM',
          restartPolicy: d.restartPolicy ?? 'ON_FAILURE',
          maxRestarts: String(d.maxRestarts ?? 3),
          environment: Object.entries(d.environment ?? {}).map(([key, value]) => ({ key, value })),
          observers: (d.observers ?? []).map((o) => ({
            kind: o.kind ?? 'PATTERN',
            pattern: o.pattern ?? '',
            severity: o.severity ?? 'ERROR',
          })),
        }
      : undefined;
  });

  readonly createMutation = injectMutation(() => ({
    mutationFn: (req: CreateDaemonConfigurationRequest) =>
      lastValueFrom(this.daemonService.apiDaemonConfigurationsPost(req)),
    onSuccess: () => this.afterSave(),
  }));

  readonly updateMutation = injectMutation(() => ({
    mutationFn: (req: UpdateDaemonConfigurationRequest) =>
      lastValueFrom(this.daemonService.apiDaemonConfigurationsIdPut(this.daemon()!.id!, req)),
    onSuccess: () => this.afterSave(),
  }));

  readonly deleteMutation = injectMutation(() => ({
    mutationFn: () =>
      lastValueFrom(this.daemonService.apiDaemonConfigurationsIdDelete(this.daemon()!.id!)),
    onSuccess: () => this.afterSave(),
  }));

  onSubmitted(data: DaemonConfigurationFormData) {
    const request = {
      name: data.name,
      description: data.description,
      startScript: data.startScript,
      // Send "" (not undefined) so an emptied ready pattern clears the stored value on update.
      readyPattern: data.readyPattern,
      stopSignal: data.stopSignal,
      restartPolicy: data.restartPolicy,
      maxRestarts: this.parseMaxRestarts(data.maxRestarts),
      environment: this.toEnvMap(data.environment),
      observers: data.observers.map((row) => this.toObserver(row)),
    };
    if (this.daemon()) {
      this.updateMutation.mutate(request);
    } else {
      this.createMutation.mutate(request);
    }
  }

  onDelete() {
    this.deleteMutation.mutate();
  }

  onCancel() {
    this.router.navigate(['/daemon-configurations']);
  }

  private afterSave() {
    this.queryClient.invalidateQueries({ queryKey: ['daemon-configurations'] });
    const id = this.daemon()?.id;
    if (id) {
      this.queryClient.invalidateQueries({ queryKey: ['daemon-configuration', id] });
    }
    this.router.navigate(['/daemon-configurations']);
    this.saved.emit();
  }

  /** The form keeps the count as text; anything non-numeric falls back to the default. */
  private parseMaxRestarts(value: string): number {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) || parsed < 0 ? 3 : parsed;
  }

  /** Only the fields of the selected kind travel; LOG_LEVEL needs no configuration. */
  private toObserver(row: DaemonObserverRow) {
    return row.kind === 'PATTERN'
      ? { kind: row.kind, pattern: row.pattern, severity: row.severity }
      : { kind: row.kind };
  }

  /** Collapse the editor rows into a map, dropping rows with a blank key and keeping the last dup. */
  private toEnvMap(rows: { key: string; value: string }[]): { [key: string]: string } {
    const map: { [key: string]: string } = {};
    for (const row of rows) {
      const key = row.key.trim();
      if (key) map[key] = row.value;
    }
    return map;
  }
}
