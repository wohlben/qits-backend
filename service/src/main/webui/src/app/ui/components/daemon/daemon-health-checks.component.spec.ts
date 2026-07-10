import { TestBed } from '@angular/core/testing';

import { HealthCheckKind } from '@/api/model/healthCheckKind';
import { HealthCheckState } from '@/api/model/healthCheckState';
import { HealthCheckStatusDto } from '@/api/model/healthCheckStatusDto';
import { DaemonHealthChecksComponent } from './daemon-health-checks.component';

describe('DaemonHealthChecksComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DaemonHealthChecksComponent],
    }).compileComponents();
  });

  function createComponent(health: HealthCheckStatusDto[]) {
    const fixture = TestBed.createComponent(DaemonHealthChecksComponent);
    fixture.componentRef.setInput('health', health);
    fixture.detectChanges();
    return fixture;
  }

  it('renders one labelled dot per check, coloured by state', () => {
    const fixture = createComponent([
      { name: 'Quarkus', kind: HealthCheckKind.Http, state: HealthCheckState.Healthy },
      { name: 'Angular', kind: HealthCheckKind.Http, state: HealthCheckState.Unhealthy },
      { name: 'Postgres', kind: HealthCheckKind.Tcp, state: HealthCheckState.Unknown },
    ]);
    const element = fixture.nativeElement as HTMLElement;

    expect(element.textContent).toContain('Quarkus');
    expect(element.textContent).toContain('Angular');
    expect(element.textContent).toContain('Postgres');

    const dots = Array.from(element.querySelectorAll('li span[aria-hidden="true"]'));
    expect(dots).toHaveLength(3);
    expect(dots[0].className).toContain('bg-green-500');
    expect(dots[1].className).toContain('bg-red-500');
    expect(dots[2].className).toContain('bg-muted-foreground/50');
  });

  it('carries latency and failing evidence in the title tooltip', () => {
    const fixture = createComponent([
      {
        name: 'Angular',
        kind: HealthCheckKind.Http,
        state: HealthCheckState.Unhealthy,
        lastLatencyMs: 12,
        detail: 'HTTP 503 (expected 2xx,3xx)',
      },
    ]);

    const item = (fixture.nativeElement as HTMLElement).querySelector('li')!;
    expect(item.title).toContain('Angular: UNHEALTHY');
    expect(item.title).toContain('12ms');
    expect(item.title).toContain('HTTP 503 (expected 2xx,3xx)');
  });

  it('a check with no runtime data yet reads UNKNOWN, not an empty title', () => {
    const fixture = createComponent([
      { name: 'Quarkus', kind: HealthCheckKind.Command, state: HealthCheckState.Unknown },
    ]);

    const item = (fixture.nativeElement as HTMLElement).querySelector('li')!;
    expect(item.title).toContain('Quarkus: UNKNOWN');
  });
});
