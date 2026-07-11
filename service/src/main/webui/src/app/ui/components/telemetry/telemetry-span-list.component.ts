import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import { TelemetryLogDto } from '@/api/model/telemetryLogDto';
import { TelemetrySpanDto } from '@/api/model/telemetrySpanDto';

/**
 * The flat span list for one trace (deliberately no waterfall — the spec's UI stays thin): name,
 * kind, duration and status per span, followed by the trace's correlated logs.
 */
@Component({
  selector: 'app-telemetry-span-list',
  imports: [DatePipe],
  template: `
    @if (spans().length === 0) {
      <p class="text-sm text-muted-foreground">No spans buffered for this trace.</p>
    } @else {
      <ul class="flex flex-col divide-y rounded-md border">
        @for (span of spans(); track span.spanId) {
          <li class="px-3 py-2 text-sm">
            <details>
              <summary
                class="flex cursor-pointer list-none flex-wrap items-center gap-2"
              >
                <span class="rounded bg-muted px-1.5 py-0.5 text-xs">{{ span.kind }}</span>
                <span class="min-w-0 flex-1 truncate font-medium">{{ span.name }}</span>
                @if (span.status === 'ERROR') {
                  <span class="text-xs text-destructive">ERROR</span>
                }
                <span class="text-xs text-muted-foreground">{{ span.durationMs }} ms</span>
              </summary>
              @if (attrEntries(span.attributes); as attrs) {
                @if (attrs.length) {
                  <dl class="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
                    @for (entry of attrs; track entry[0]) {
                      <dt class="font-mono break-all text-muted-foreground">{{ entry[0] }}</dt>
                      <dd class="font-mono break-all">{{ entry[1] }}</dd>
                    }
                  </dl>
                } @else {
                  <p class="mt-2 text-xs text-muted-foreground">No attributes.</p>
                }
              }
            </details>
          </li>
        }
      </ul>
      @if (logs().length > 0) {
        <h4 class="mt-3 text-sm font-medium">Correlated logs</h4>
        <ul class="mt-1 flex flex-col gap-1">
          @for (log of logs(); track $index) {
            <li class="text-sm">
              <details>
                <summary class="flex cursor-pointer list-none flex-wrap items-baseline gap-1">
                  <span class="text-xs text-muted-foreground">
                    {{ (log.epochNanos ?? 0) / 1000000 | date: 'HH:mm:ss.SSS' }}
                    {{ log.severityText }}
                  </span>
                  <span class="ml-1">{{ log.body }}</span>
                </summary>
                @if (attrEntries(log.attributes); as attrs) {
                  @if (attrs.length) {
                    <dl class="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
                      @for (entry of attrs; track entry[0]) {
                        <dt class="font-mono break-all text-muted-foreground">{{ entry[0] }}</dt>
                        <dd class="font-mono break-all">{{ entry[1] }}</dd>
                      }
                    </dl>
                  } @else {
                    <p class="mt-1 text-xs text-muted-foreground">No attributes.</p>
                  }
                }
              </details>
            </li>
          }
        </ul>
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TelemetrySpanListComponent {
  readonly spans = input.required<TelemetrySpanDto[]>();
  readonly logs = input.required<TelemetryLogDto[]>();

  /** Stable entries list for a span/log attribute map (empty when none), for the template @for. */
  protected attrEntries(attributes: { [key: string]: string } | undefined): [string, string][] {
    return Object.entries(attributes ?? {});
  }
}
