import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

import { TelemetryLogDto } from '@/api/model/telemetryLogDto';

/**
 * The live log tail of the workspace telemetry tab: the buffered log records, filterable by the
 * exporting service. The parent owns the query (and its polling); this only renders and emits the
 * chosen service filter.
 */
@Component({
  selector: 'app-telemetry-log-tail',
  imports: [DatePipe],
  template: `
    <div class="flex items-center gap-2">
      <label for="telemetry-log-service" class="text-sm text-muted-foreground">Service</label>
      <select
        id="telemetry-log-service"
        class="h-9 rounded-md border bg-transparent px-2 text-sm"
        [value]="service() ?? ''"
        (change)="serviceChange.emit($any($event.target).value || null)"
      >
        <option value="">All services</option>
        @for (name of services(); track name) {
          <option [value]="name">{{ name }}</option>
        }
      </select>
    </div>

    @if (logs().length === 0) {
      <p class="mt-2 text-sm text-muted-foreground">No logs exported yet.</p>
    } @else {
      <ul class="mt-2 flex max-h-96 flex-col gap-0.5 overflow-auto rounded-md border p-2 font-mono text-xs">
        @for (log of logs(); track $index) {
          <li class="whitespace-pre-wrap" [class.text-destructive]="(log.severityNumber ?? 0) >= 17">
            <span class="text-muted-foreground">
              {{ (log.epochNanos ?? 0) / 1000000 | date: 'HH:mm:ss.SSS' }}
            </span>
            <span class="ml-1">{{ log.severityText || 'LOG' }}</span>
            <span class="ml-1">{{ log.serviceName }}</span>
            <span class="ml-2">{{ log.body }}</span>
          </li>
        }
      </ul>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TelemetryLogTailComponent {
  readonly logs = input.required<TelemetryLogDto[]>();
  readonly services = input.required<string[]>();
  readonly service = input<string | null>(null);
  readonly serviceChange = output<string | null>();
}
