import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { WorktreeTelemetryControllerService } from '@/api/api/worktreeTelemetryController.service';
import { TelemetryErrorFeedComponent } from '@/ui/components/telemetry/telemetry-error-feed.component';
import { TelemetryLogTailComponent } from '@/ui/components/telemetry/telemetry-log-tail.component';
import { TelemetrySpanListComponent } from '@/ui/components/telemetry/telemetry-span-list.component';

/**
 * The worktree's telemetry tab (iteration one, deliberately thin): a polling recent-errors feed,
 * click-through to a flat span list for the selected trace, and a polling log tail filterable by
 * service. The data is the in-memory OTLP buffer — ephemeral by design, so "live" is a 5s refetch,
 * not a socket.
 */
@Component({
  selector: 'app-worktree-telemetry',
  imports: [TelemetryErrorFeedComponent, TelemetryLogTailComponent, TelemetrySpanListComponent],
  template: `
    <div class="flex flex-col gap-6">
      <section class="flex flex-col gap-2" aria-label="Recent errors">
        <h3 class="text-base font-semibold">Recent errors</h3>
        @if (errorsQuery.isPending()) {
          <p class="text-sm text-muted-foreground">Loading telemetry…</p>
        } @else if (errorsQuery.isError()) {
          <p class="text-sm text-destructive">Failed to load telemetry</p>
        } @else {
          <app-telemetry-error-feed
            [groups]="errorsQuery.data() ?? []"
            [selectedTraceId]="selectedTraceId()"
            (traceSelected)="selectedTraceId.set($event)"
          />
        }
      </section>

      @if (selectedTraceId(); as traceId) {
        <section class="flex flex-col gap-2" aria-label="Trace detail">
          <h3 class="text-base font-semibold">
            Trace <code class="text-sm text-muted-foreground">{{ traceId }}</code>
          </h3>
          @if (traceQuery.isPending()) {
            <p class="text-sm text-muted-foreground">Loading trace…</p>
          } @else if (traceQuery.isError()) {
            <p class="text-sm text-destructive">Failed to load trace</p>
          } @else {
            <app-telemetry-span-list
              [spans]="traceQuery.data()?.spans ?? []"
              [logs]="traceQuery.data()?.logs ?? []"
            />
          }
        </section>
      }

      <section class="flex flex-col gap-2" aria-label="Log tail">
        <h3 class="text-base font-semibold">Logs</h3>
        @if (logsQuery.isError()) {
          <p class="text-sm text-destructive">Failed to load logs</p>
        } @else {
          <app-telemetry-log-tail
            [logs]="logsQuery.data() ?? []"
            [services]="services()"
            [service]="serviceFilter()"
            (serviceChange)="serviceFilter.set($event)"
          />
        }
      </section>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorktreeTelemetryComponent {
  readonly repoId = input.required<string>();
  readonly worktreeId = input.required<string>();

  private readonly telemetryService = inject(WorktreeTelemetryControllerService);

  readonly selectedTraceId = signal<string | null>(null);
  readonly serviceFilter = signal<string | null>(null);

  readonly errorsQuery = injectQuery(() => ({
    queryKey: ['telemetry-errors', this.repoId(), this.worktreeId()],
    queryFn: () =>
      lastValueFrom(
        this.telemetryService.apiRepositoriesRepoIdWorktreesWorktreeIdTelemetryErrorsGet(
          this.repoId(),
          this.worktreeId(),
        ),
      ).then((r) => r.groups ?? []),
    refetchInterval: 5000,
  }));

  readonly traceQuery = injectQuery(() => ({
    queryKey: ['telemetry-trace', this.repoId(), this.worktreeId(), this.selectedTraceId()],
    enabled: !!this.selectedTraceId(),
    queryFn: () =>
      lastValueFrom(
        this.telemetryService.apiRepositoriesRepoIdWorktreesWorktreeIdTelemetryTracesTraceIdGet(
          this.repoId(),
          this.selectedTraceId()!,
          this.worktreeId(),
        ),
      ).then((r) => r.trace ?? { spans: [], logs: [] }),
  }));

  readonly logsQuery = injectQuery(() => ({
    queryKey: ['telemetry-logs', this.repoId(), this.worktreeId(), this.serviceFilter()],
    queryFn: () =>
      lastValueFrom(
        this.telemetryService.apiRepositoriesRepoIdWorktreesWorktreeIdTelemetryLogsGet(
          this.repoId(),
          this.worktreeId(),
          undefined,
          this.serviceFilter() ?? undefined,
        ),
      ).then((r) => r.logs ?? []),
    refetchInterval: 5000,
  }));

  /** Distinct exporting services seen in the current tail, for the filter dropdown. */
  readonly services = computed(() => {
    const names = new Set<string>();
    for (const log of this.logsQuery.data() ?? []) {
      if (log.serviceName) names.add(log.serviceName);
    }
    const filter = this.serviceFilter();
    if (filter) names.add(filter);
    return [...names].sort();
  });
}
