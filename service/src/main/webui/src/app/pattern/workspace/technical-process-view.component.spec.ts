import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TechnicalProcessViewComponent } from './technical-process-view.component';

/**
 * Stand-in for the browser's EventSource; lets a test drive open/message/error synchronously.
 * Mirrors the shape used by workspace-live.service.spec.ts, plus readyState/CLOSED because the
 * view distinguishes a final close from a transient error.
 */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  static readonly CLOSED = 2;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  closed = false;

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  close(): void {
    this.closed = true;
  }

  emitFrame(frame: object): void {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }

  emitFinalError(): void {
    this.readyState = FakeEventSource.CLOSED;
    this.onerror?.();
  }
}

@Component({
  selector: 'app-test-process-host',
  imports: [TechnicalProcessViewComponent],
  template: `<app-technical-process-view
    [processId]="processId()"
    (finished)="verdicts.push($event)"
  />`,
})
class TestProcessHost {
  readonly processId = signal('proc-1');
  readonly verdicts: Array<'ok' | 'failed'> = [];
}

describe('TechnicalProcessViewComponent', () => {
  const originalEventSource = globalThis.EventSource;

  beforeEach(() => {
    FakeEventSource.instances = [];
    (globalThis as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
    TestBed.configureTestingModule({ imports: [TestProcessHost] });
  });

  afterEach(() => {
    (globalThis as unknown as { EventSource: unknown }).EventSource = originalEventSource;
  });

  function mount() {
    const fixture = TestBed.createComponent(TestProcessHost);
    fixture.detectChanges();
    const view = fixture.debugElement.children[0].componentInstance as TechnicalProcessViewComponent;
    return { fixture, view, source: FakeEventSource.instances[0] };
  }

  it('opens one EventSource at the technical-process events path', () => {
    const { source } = mount();
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(source.url).toBe('/api/technical-processes/proc-1/events');
  });

  it('builds segments from open/line/settled frames and renders their status', () => {
    const { fixture, view, source } = mount();
    source.emitFrame({ segment: 'docker-run', kind: 'segment-open', seq: 0 });
    source.emitFrame({ segment: 'docker-run', kind: 'line', seq: 1, line: 'created abc123' });
    source.emitFrame({ segment: 'docker-run', kind: 'segment-settled', seq: 2, status: 'ok' });
    source.emitFrame({ segment: 'clone', kind: 'segment-open', seq: 3 });
    source.emitFrame({ segment: 'clone', kind: 'line', seq: 4, line: 'Cloning…' });
    fixture.detectChanges();

    expect(view.segments().map((s) => [s.name, s.status])).toEqual([
      ['docker-run', 'ok'],
      ['clone', 'open'],
    ]);
    expect(view.segments()[0].lines).toEqual(['created abc123']);
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('docker-run');
    expect(text).toContain('running…');
  });

  it('auto-expands the active segment and collapses settled ones (manual toggle wins)', () => {
    const { fixture, view, source } = mount();
    source.emitFrame({ segment: 'docker-run', kind: 'segment-open', seq: 0 });
    source.emitFrame({ segment: 'docker-run', kind: 'segment-settled', seq: 1, status: 'ok' });
    source.emitFrame({ segment: 'clone', kind: 'segment-open', seq: 2 });
    fixture.detectChanges();

    const [settled, active] = view.segments();
    expect(view.isExpanded(settled)).toBe(false);
    expect(view.isExpanded(active)).toBe(true);

    view.toggle('docker-run');
    expect(view.isExpanded(settled)).toBe(true);
  });

  it('freezes on done, closes the source, and emits the verdict once', () => {
    const { fixture, view, source } = mount();
    source.emitFrame({ segment: 'clone', kind: 'segment-open', seq: 0 });
    source.emitFrame({ segment: 'clone', kind: 'segment-settled', seq: 1, status: 'failed' });
    source.emitFrame({ kind: 'done', seq: 2, status: 'failed' });
    fixture.detectChanges();

    expect(view.done()).toBe('failed');
    expect(source.closed).toBe(true);
    const host = fixture.componentInstance;
    expect(host.verdicts).toEqual(['failed']);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Finished with errors.');
  });

  it('rebuilds from the replay on reconnect instead of duplicating state', () => {
    const { fixture, view, source } = mount();
    source.emitFrame({ segment: 'clone', kind: 'segment-open', seq: 0 });
    source.emitFrame({ segment: 'clone', kind: 'line', seq: 1, line: 'first' });

    // EventSource auto-reconnected: the server replays everything on the fresh connection.
    source.onopen?.();
    source.emitFrame({ segment: 'clone', kind: 'segment-open', seq: 0 });
    source.emitFrame({ segment: 'clone', kind: 'line', seq: 1, line: 'first' });
    fixture.detectChanges();

    expect(view.segments()).toHaveLength(1);
    expect(view.segments()[0].lines).toEqual(['first']);
  });

  it('reports a lost stream when the source closes for good before done', () => {
    const { fixture, view, source } = mount();
    source.emitFrame({ segment: 'clone', kind: 'segment-open', seq: 0 });
    source.emitFinalError();
    fixture.detectChanges();

    expect(view.lost()).toBe(true);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('ended before');
  });

  it('ignores ping heartbeat frames', () => {
    const { view, source } = mount();
    source.emitFrame({ kind: 'ping', seq: -1 });
    expect(view.segments()).toEqual([]);
    expect(view.done()).toBeNull();
  });
});
