import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import { TelemetryMetricDto } from '@/api/model/telemetryMetricDto';

/**
 * The metrics table of the workspace telemetry tab: the latest point of every buffered metric
 * series (a plain list — charts are a later iteration). The parent owns the query; this only
 * renders.
 */
@Component({
  selector: 'app-telemetry-metric-list',
  imports: [DecimalPipe],
  template: `
    @if (metrics().length === 0) {
      <p class="text-sm text-muted-foreground">
        No metrics captured yet — OTel-enabled processes export their runtime metrics here.
      </p>
    } @else {
      <ul class="flex flex-col divide-y rounded-md border">
        <!-- track $index: series identity is name+attributes, and names repeat (one row per
             memory pool etc.), so the name alone duplicates keys (NG0955). -->
        @for (metric of metrics(); track $index) {
          <li class="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
            <span class="rounded bg-muted px-1.5 py-0.5 text-xs">{{ metric.type }}</span>
            <span class="min-w-0 flex-1 truncate font-mono">{{ metric.name }}</span>
            @if (metric.serviceName) {
              <span class="text-xs text-muted-foreground">{{ metric.serviceName }}</span>
            }
            <span class="font-medium tabular-nums">
              {{ metric.value | number: '1.0-2' }}
              @if (metric.unit) {
                <span class="text-xs font-normal text-muted-foreground">{{ metric.unit }}</span>
              }
            </span>
          </li>
        }
      </ul>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TelemetryMetricListComponent {
  readonly metrics = input.required<TelemetryMetricDto[]>();
}
