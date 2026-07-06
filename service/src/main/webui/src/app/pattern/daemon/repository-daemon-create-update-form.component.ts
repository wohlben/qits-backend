import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { Router } from '@angular/router';
import { injectMutation, QueryClient } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { RepositoryDaemonControllerService } from '@/api/api/repositoryDaemonController.service';
import { CreateRepositoryDaemonRequest } from '@/api/model/createRepositoryDaemonRequest';
import { RepositoryDaemonDto } from '@/api/model/repositoryDaemonDto';
import { UpdateRepositoryDaemonRequest } from '@/api/model/updateRepositoryDaemonRequest';
import { WebViewInput } from '@/api/model/webViewInput';
import { ZardButtonComponent } from '@/shared/components/button';
import {
  DaemonFormComponent,
  DaemonFormData,
  DaemonObserverRow,
} from '@/ui/forms/daemon/daemon-form.component';

@Component({
  selector: 'app-repository-daemon-create-update-form',
  imports: [DaemonFormComponent, ZardButtonComponent],
  template: `
    <app-daemon-form
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
    </app-daemon-form>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RepositoryDaemonCreateUpdateFormComponent {
  readonly repoId = input.required<string>();
  readonly daemon = input<RepositoryDaemonDto>();
  readonly saved = output<void>();

  private readonly daemonService = inject(RepositoryDaemonControllerService);
  private readonly queryClient = inject(QueryClient);
  private readonly router = inject(Router);

  readonly initialData = computed<DaemonFormData | undefined>(() => {
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
          otel: d.otel ?? false,
          webViewPort: d.webView?.port != null ? String(d.webView.port) : '',
          webViewEntryPath: d.webView?.entryPath ?? '',
          webViewBasePath: d.webView?.basePath ?? '',
          environment: Object.entries(d.environment ?? {}).map(([key, value]) => ({ key, value })),
          observers: (d.observers ?? []).map((o) => ({
            kind: o.kind ?? 'PATTERN',
            pattern: o.pattern ?? '',
            severity: o.severity ?? 'ERROR',
          })),
          sources: (d.sources ?? []).map((s) => ({
            path: s.path ?? '',
            label: s.label ?? '',
          })),
        }
      : undefined;
  });

  readonly createMutation = injectMutation(() => ({
    mutationFn: (req: CreateRepositoryDaemonRequest) =>
      lastValueFrom(
        this.daemonService.apiRepositoriesRepositoryIdDaemonsPost(this.repoId(), req),
      ),
    onSuccess: () => this.afterSave(),
  }));

  readonly updateMutation = injectMutation(() => ({
    mutationFn: (req: UpdateRepositoryDaemonRequest) =>
      lastValueFrom(
        this.daemonService.apiRepositoriesRepositoryIdDaemonsDaemonIdPut(
          this.daemon()!.id!,
          this.repoId(),
          req,
        ),
      ),
    onSuccess: () => this.afterSave(),
  }));

  readonly deleteMutation = injectMutation(() => ({
    mutationFn: () =>
      lastValueFrom(
        this.daemonService.apiRepositoriesRepositoryIdDaemonsDaemonIdDelete(
          this.daemon()!.id!,
          this.repoId(),
        ),
      ),
    onSuccess: () => this.afterSave(),
  }));

  onSubmitted(data: DaemonFormData) {
    const request = {
      name: data.name,
      description: data.description,
      startScript: data.startScript,
      // Send "" (not undefined) so an emptied ready pattern clears the stored value on update.
      readyPattern: data.readyPattern,
      stopSignal: data.stopSignal,
      restartPolicy: data.restartPolicy,
      maxRestarts: this.parseMaxRestarts(data.maxRestarts),
      otel: data.otel,
      webView: this.toWebView(data),
      environment: this.toEnvMap(data.environment),
      observers: data.observers.map((row) => this.toObserver(row)),
      sources: data.sources
        .filter((row) => row.path.trim().length > 0)
        .map((row) => ({ path: row.path.trim(), label: row.label.trim() || undefined })),
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
    this.router.navigate(['/repositories', this.repoId(), 'daemons']);
  }

  private afterSave() {
    this.queryClient.invalidateQueries({ queryKey: ['repository-daemons', this.repoId()] });
    const id = this.daemon()?.id;
    if (id) {
      this.queryClient.invalidateQueries({ queryKey: ['repository-daemon', this.repoId(), id] });
    }
    this.router.navigate(['/repositories', this.repoId(), 'daemons']);
    this.saved.emit();
  }

  /** The form keeps the count as text; anything non-numeric falls back to the default. */
  private parseMaxRestarts(value: string): number {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) || parsed < 0 ? 3 : parsed;
  }

  /**
   * An empty port means "not web-viewable": on update the backend clears the stored config with
   * port 0, on create the block must simply be omitted (0 would be rejected as out of range).
   * With a port, the block travels whole — the backend replaces both paths from it ("" clears).
   */
  private toWebView(data: DaemonFormData): WebViewInput | undefined {
    const port = Number.parseInt(data.webViewPort, 10);
    if (Number.isNaN(port) || port <= 0) {
      return this.daemon() ? { port: 0 } : undefined;
    }
    return {
      port,
      entryPath: data.webViewEntryPath.trim(),
      basePath: data.webViewBasePath.trim(),
    };
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
