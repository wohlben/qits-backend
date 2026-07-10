import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import { HealthCheckState } from '@/api/model/healthCheckState';
import { HealthCheckStatusDto } from '@/api/model/healthCheckStatusDto';

/**
 * The glanceable health row of one daemon instance: one labelled dot per declared healthcheck
 * (green HEALTHY / red UNHEALTHY / grey UNKNOWN), rendered beside the lifecycle status chip. Health
 * is a display sidecar — a daemon can be READY while one of its services is down, and these dots
 * are what reveal it. Latency and failing evidence ride the native title tooltip.
 */
@Component({
  selector: 'app-daemon-health-checks',
  template: `
    <ul class="flex flex-wrap items-center gap-2" aria-label="Health checks">
      @for (check of health(); track check.name) {
        <li
          class="inline-flex items-center gap-1 text-xs text-muted-foreground"
          [title]="titleFor(check)"
        >
          <span class="size-1.5 rounded-full" [class]="dotClasses(check)" aria-hidden="true">
          </span>
          {{ check.name }}
          <span class="sr-only">{{ check.state ?? 'UNKNOWN' }}</span>
        </li>
      }
    </ul>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DaemonHealthChecksComponent {
  readonly health = input.required<HealthCheckStatusDto[]>();

  dotClasses(check: HealthCheckStatusDto): string {
    switch (check.state) {
      case HealthCheckState.Healthy:
        return 'bg-green-500';
      case HealthCheckState.Unhealthy:
        return 'bg-red-500';
      default:
        return 'bg-muted-foreground/50';
    }
  }

  titleFor(check: HealthCheckStatusDto): string {
    const parts = [`${check.name}: ${check.state ?? 'UNKNOWN'}`];
    if (check.lastLatencyMs != null) {
      parts.push(`${check.lastLatencyMs}ms`);
    }
    if (check.detail) {
      parts.push(check.detail);
    }
    if (check.lastCheckedAt) {
      parts.push(`checked ${check.lastCheckedAt}`);
    }
    return parts.join(' · ');
  }
}
