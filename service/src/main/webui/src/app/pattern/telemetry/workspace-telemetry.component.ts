import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { WorkspaceTelemetryControllerService } from '@/api/api/workspaceTelemetryController.service';
import { ZardButtonComponent } from '@/shared/components/button';
import { ZardTabComponent, ZardTabGroupComponent } from '@/shared/components/tabs';
import { TelemetryErrorFeedComponent } from '@/ui/components/telemetry/telemetry-error-feed.component';
import { TelemetryLogTailComponent } from '@/ui/components/telemetry/telemetry-log-tail.component';
import { TelemetryMetricListComponent } from '@/ui/components/telemetry/telemetry-metric-list.component';
import { TelemetrySpanListComponent } from '@/ui/components/telemetry/telemetry-span-list.component';

/**
 * The workspace's telemetry tab, split into signal sub-tabs: **Traces** (a recent-errors feed,
 * every buffered span behind a Recent / Slowest lens, click-through to the flat span list of its
 * trace), **Logs** (a tail filterable by service) and **Metrics** (the latest point of every
 * series) — the whole in-memory OTLP buffer, so a healthy app shows its traffic too, not just
 * failures. Ephemeral by design. Hidden sub-tabs stay mounted (the z-tab-group contract), so
 * queries stay warm across switches. These queries do not poll: `WorkspaceLiveService`
 * invalidates them on a `telemetry` SSE hint (debounced server-side to ≤1/s), so freshness is
 * push-driven and an idle workspace fetches nothing.
 */
@Component({
  selector: 'app-workspace-telemetry',
  imports: [
    DatePipe,
    TelemetryErrorFeedComponent,
    TelemetryLogTailComponent,
    TelemetryMetricListComponent,
    TelemetrySpanListComponent,
    ZardButtonComponent,
    ZardTabComponent,
    ZardTabGroupComponent,
  ],
  template: `
    <z-tab-group>
      <z-tab label="Traces">
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

          <section class="flex flex-col gap-2" aria-label="Recent traces">
            <div class="flex items-center gap-1">
              <h3 class="flex-1 text-base font-semibold">Traces</h3>
              <button
                z-button
                zSize="sm"
                [zType]="spanSort() === 'recent' ? 'secondary' : 'ghost'"
                type="button"
                [attr.aria-pressed]="spanSort() === 'recent'"
                (click)="spanSort.set('recent')"
              >
                Recent
              </button>
              <button
                z-button
                zSize="sm"
                [zType]="spanSort() === 'slowest' ? 'secondary' : 'ghost'"
                type="button"
                [attr.aria-pressed]="spanSort() === 'slowest'"
                (click)="spanSort.set('slowest')"
              >
                Slowest
              </button>
            </div>
            @if (spansQuery.isPending()) {
              <p class="text-sm text-muted-foreground">Loading traces…</p>
            } @else if (spansQuery.isError()) {
              <p class="text-sm text-destructive">Failed to load traces</p>
            } @else {
              @let spans = spansQuery.data() ?? [];
              @if (spans.length === 0) {
                <p class="text-sm text-muted-foreground">
                  No spans captured yet — interact with the app to generate traces.
                </p>
              } @else {
                <ul class="flex flex-col divide-y rounded-md border">
                  @for (span of spans; track span.spanId) {
                    <li>
                      <button
                        type="button"
                        class="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-accent"
                        [class.ring-2]="span.traceId === selectedTraceId()"
                        (click)="selectedTraceId.set(span.traceId ?? null)"
                      >
                        <span class="text-xs text-muted-foreground">
                          {{ (span.startEpochNanos ?? 0) / 1000000 | date: 'HH:mm:ss' }}
                        </span>
                        <span class="rounded bg-muted px-1.5 py-0.5 text-xs">{{ span.kind }}</span>
                        <span class="min-w-0 flex-1 truncate font-medium">{{ span.name }}</span>
                        @if (span.status === 'ERROR') {
                          <span class="text-xs text-destructive">ERROR</span>
                        }
                        <span class="text-xs text-muted-foreground">{{ span.durationMs }} ms</span>
                      </button>
                    </li>
                  }
                </ul>
              }
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
        </div>
      </z-tab>

      <z-tab label="Logs">
        <section class="flex flex-col gap-2" aria-label="Log tail">
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
      </z-tab>

      <z-tab label="Metrics">
        <section class="flex flex-col gap-2" aria-label="Metrics">
          @if (metricsQuery.isPending()) {
            <p class="text-sm text-muted-foreground">Loading metrics…</p>
          } @else if (metricsQuery.isError()) {
            <p class="text-sm text-destructive">Failed to load metrics</p>
          } @else {
            <app-telemetry-metric-list [metrics]="metricsQuery.data() ?? []" />
          }
        </section>
      </z-tab>
    </z-tab-group>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkspaceTelemetryComponent {
  readonly repoId = input.required<string>();
  readonly workspaceId = input.required<string>();

  private readonly telemetryService = inject(WorkspaceTelemetryControllerService);

  readonly selectedTraceId = signal<string | null>(null);
  readonly serviceFilter = signal<string | null>(null);
  /** The traces lens: chronological ("what did I just do") or by duration ("what's slow"). */
  readonly spanSort = signal<'recent' | 'slowest'>('recent');

  readonly errorsQuery = injectQuery(() => ({
    queryKey: ['telemetry-errors', this.repoId(), this.workspaceId()],
    queryFn: () =>
      lastValueFrom(
        this.telemetryService.apiRepositoriesRepoIdWorkspacesWorkspaceIdTelemetryErrorsGet(
          this.repoId(),
          this.workspaceId(),
        ),
      ).then((r) => r.groups ?? []),
  }));

  readonly spansQuery = injectQuery(() => ({
    queryKey: ['telemetry-spans', this.repoId(), this.workspaceId(), this.spanSort()],
    queryFn: () =>
      lastValueFrom(
        // thresholdMs=0: every buffered span qualifies — the toggle only changes the sort.
        this.telemetryService.apiRepositoriesRepoIdWorkspacesWorkspaceIdTelemetrySlowSpansGet(
          this.repoId(),
          this.workspaceId(),
          undefined,
          this.spanSort() === 'slowest' ? 'duration' : 'recent',
          0,
        ),
      ).then((r) => r.spans ?? []),
  }));

  readonly traceQuery = injectQuery(() => ({
    queryKey: ['telemetry-trace', this.repoId(), this.workspaceId(), this.selectedTraceId()],
    enabled: !!this.selectedTraceId(),
    queryFn: () =>
      lastValueFrom(
        this.telemetryService.apiRepositoriesRepoIdWorkspacesWorkspaceIdTelemetryTracesTraceIdGet(
          this.repoId(),
          this.selectedTraceId()!,
          this.workspaceId(),
        ),
      ).then((r) => r.trace ?? { spans: [], logs: [] }),
  }));

  readonly metricsQuery = injectQuery(() => ({
    queryKey: ['telemetry-metrics', this.repoId(), this.workspaceId()],
    queryFn: () =>
      lastValueFrom(
        this.telemetryService.apiRepositoriesRepoIdWorkspacesWorkspaceIdTelemetryMetricsGet(
          this.repoId(),
          this.workspaceId(),
        ),
      ).then((r) => r.metrics ?? []),
  }));

  readonly logsQuery = injectQuery(() => ({
    queryKey: ['telemetry-logs', this.repoId(), this.workspaceId(), this.serviceFilter()],
    queryFn: () =>
      lastValueFrom(
        this.telemetryService.apiRepositoriesRepoIdWorkspacesWorkspaceIdTelemetryLogsGet(
          this.repoId(),
          this.workspaceId(),
          undefined,
          this.serviceFilter() ?? undefined,
        ),
      ).then((r) => r.logs ?? []),
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
