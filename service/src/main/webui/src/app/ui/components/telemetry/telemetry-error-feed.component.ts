import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

import { TelemetryErrorGroupDto } from '@/api/model/telemetryErrorGroupDto';

/**
 * The recent-errors feed of the workspace telemetry tab: one card per trace, showing its
 * error-status spans (with any structured exception events) and correlated ERROR logs. Clicking a
 * group emits its traceId so the parent can load the full trace.
 */
@Component({
  selector: 'app-telemetry-error-feed',
  imports: [DatePipe],
  template: `
    @if (groups().length === 0) {
      <p class="text-sm text-muted-foreground">
        No errors in the buffered telemetry. Only processes launched with the OTel toggle (and
        instrumented) export here.
      </p>
    } @else {
      <ul class="flex flex-col gap-2">
        @for (group of groups(); track group.traceId) {
          <li>
            <button
              type="button"
              class="w-full rounded-md border p-3 text-left transition-colors hover:bg-accent"
              [class.ring-2]="group.traceId === selectedTraceId()"
              (click)="traceSelected.emit(group.traceId ?? '')"
            >
              <div class="flex flex-wrap items-center gap-2">
                <span class="font-medium">{{ group.serviceName }}</span>
                @if (group.traceId) {
                  <code class="text-xs text-muted-foreground">{{ group.traceId }}</code>
                } @else {
                  <span class="text-xs text-muted-foreground">uncorrelated</span>
                }
              </div>
              @for (span of group.errorSpans ?? []; track span.spanId) {
                <div class="mt-1 text-sm">
                  <span class="text-destructive">{{ span.name }}</span>
                  @if (span.statusMessage) {
                    <span class="text-muted-foreground"> — {{ span.statusMessage }}</span>
                  }
                  @for (event of span.events ?? []; track $index) {
                    @if (event.name === 'exception') {
                      <pre
                        class="mt-1 max-h-40 overflow-auto rounded bg-muted p-2 text-xs whitespace-pre-wrap"
                        >{{ event.attributes?.['exception.type'] }}: {{
                          event.attributes?.['exception.message']
                        }}
{{ event.attributes?.['exception.stacktrace'] }}</pre
                      >
                    }
                  }
                </div>
              }
              @for (log of group.errorLogs ?? []; track $index) {
                <div class="mt-1 text-sm">
                  <span class="text-xs text-muted-foreground">
                    {{ (log.epochNanos ?? 0) / 1000000 | date: 'HH:mm:ss' }}
                    {{ log.severityText }}
                  </span>
                  <span class="ml-1">{{ log.body }}</span>
                </div>
              }
            </button>
          </li>
        }
      </ul>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TelemetryErrorFeedComponent {
  readonly groups = input.required<TelemetryErrorGroupDto[]>();
  readonly selectedTraceId = input<string | null>(null);
  readonly traceSelected = output<string>();
}
