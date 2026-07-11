import { TestBed } from '@angular/core/testing';

import { TelemetryLogTailComponent } from './telemetry-log-tail.component';

describe('TelemetryLogTailComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TelemetryLogTailComponent],
    }).compileComponents();
  });

  it('renders a log record attribute map as key/value pairs', () => {
    const fixture = TestBed.createComponent(TelemetryLogTailComponent);
    fixture.componentRef.setInput('logs', [
      {
        epochNanos: 1_700_000_000_000_000,
        severityText: 'INFO',
        serviceName: 'greeting',
        body: 'deprecated config used',
        attributes: {
          'code.function.name': 'io.quarkus.ConfigDiagnostic.deprecated',
          'code.line.number': '83',
        },
      },
    ]);
    fixture.componentRef.setInput('services', ['greeting']);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('code.function.name');
    expect(el.textContent).toContain('io.quarkus.ConfigDiagnostic.deprecated');
    expect(el.textContent).toContain('code.line.number');
    expect(el.textContent).toContain('83');
  });

  it('shows "No attributes" for a log without attributes', () => {
    const fixture = TestBed.createComponent(TelemetryLogTailComponent);
    fixture.componentRef.setInput('logs', [
      { epochNanos: 1_700_000_000_000_000, severityText: 'INFO', body: 'hello' },
    ]);
    fixture.componentRef.setInput('services', []);
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('No attributes.');
  });

  it('emits serviceChange when the service filter changes', () => {
    const fixture = TestBed.createComponent(TelemetryLogTailComponent);
    fixture.componentRef.setInput('logs', []);
    fixture.componentRef.setInput('services', ['greeting']);
    fixture.detectChanges();

    let emitted: string | null | undefined;
    fixture.componentInstance.serviceChange.subscribe((v) => (emitted = v));

    const select = (fixture.nativeElement as HTMLElement).querySelector(
      'select',
    ) as HTMLSelectElement;
    select.value = 'greeting';
    select.dispatchEvent(new Event('change'));

    expect(emitted).toBe('greeting');
  });
});
