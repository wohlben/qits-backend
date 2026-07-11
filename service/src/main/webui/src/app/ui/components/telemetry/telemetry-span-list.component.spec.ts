import { TestBed } from '@angular/core/testing';

import { TelemetrySpanListComponent } from './telemetry-span-list.component';

describe('TelemetrySpanListComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TelemetrySpanListComponent],
    }).compileComponents();
  });

  it('renders a span attribute map as key/value pairs', () => {
    const fixture = TestBed.createComponent(TelemetrySpanListComponent);
    fixture.componentRef.setInput('spans', [
      {
        spanId: 's1',
        kind: 'SERVER',
        name: 'POST /greetings',
        durationMs: 4,
        status: 'OK',
        attributes: {
          'code.function.name': 'eu.wohlben.qits.testingrepo.GreetingResource.greet',
          'code.file.path': 'src/main/java/eu/wohlben/qits/testingrepo/GreetingResource.java',
        },
      },
    ]);
    fixture.componentRef.setInput('logs', []);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('code.function.name');
    expect(el.textContent).toContain('eu.wohlben.qits.testingrepo.GreetingResource.greet');
    expect(el.textContent).toContain('code.file.path');
    expect(el.textContent).toContain(
      'src/main/java/eu/wohlben/qits/testingrepo/GreetingResource.java',
    );
  });

  it('shows "No attributes" for a span without attributes', () => {
    const fixture = TestBed.createComponent(TelemetrySpanListComponent);
    fixture.componentRef.setInput('spans', [
      { spanId: 's1', kind: 'INTERNAL', name: 'compose', durationMs: 1, status: 'OK' },
    ]);
    fixture.componentRef.setInput('logs', []);
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('No attributes.');
  });

  it('renders correlated-log attributes', () => {
    const fixture = TestBed.createComponent(TelemetrySpanListComponent);
    fixture.componentRef.setInput('spans', [
      { spanId: 's1', kind: 'SERVER', name: 'POST /greetings', durationMs: 4, status: 'OK' },
    ]);
    fixture.componentRef.setInput('logs', [
      {
        epochNanos: 1_700_000_000_000_000,
        severityText: 'INFO',
        body: 'composed greeting',
        attributes: { 'code.line.number': '83' },
      },
    ]);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Correlated logs');
    expect(el.textContent).toContain('code.line.number');
    expect(el.textContent).toContain('83');
  });

  it('shows an empty state when there are no spans', () => {
    const fixture = TestBed.createComponent(TelemetrySpanListComponent);
    fixture.componentRef.setInput('spans', []);
    fixture.componentRef.setInput('logs', []);
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'No spans buffered for this trace.',
    );
  });
});
