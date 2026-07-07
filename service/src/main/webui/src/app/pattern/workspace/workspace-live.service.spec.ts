import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WorkspaceLiveService } from './workspace-live.service';

/** Stand-in for the browser's EventSource; lets a test drive open/message frames synchronously. */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  close(): void {
    this.closed = true;
  }

  emitOpen(): void {
    this.onopen?.();
  }

  emitTopic(data: string): void {
    this.onmessage?.({ data });
  }
}

// Provides the service exactly as the page does (component-scoped), so destroy tears it down.
@Component({ selector: 'app-test-live-host', template: '', providers: [WorkspaceLiveService] })
class TestLiveHost {
  readonly live = inject(WorkspaceLiveService);
  constructor() {
    this.live.connect('repo-1', 'wt-1');
  }
}

describe('WorkspaceLiveService', () => {
  let queryClient: QueryClient;
  let invalidate: ReturnType<typeof vi.spyOn>;
  const originalEventSource = globalThis.EventSource;

  beforeEach(() => {
    FakeEventSource.instances = [];
    (globalThis as unknown as { EventSource: unknown }).EventSource = FakeEventSource;

    queryClient = new QueryClient();
    invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);

    TestBed.configureTestingModule({
      imports: [TestLiveHost],
      providers: [provideTanStackQuery(queryClient)],
    });
  });

  afterEach(() => {
    (globalThis as unknown as { EventSource: unknown }).EventSource = originalEventSource;
  });

  function connect() {
    const fixture = TestBed.createComponent(TestLiveHost);
    fixture.detectChanges();
    return { fixture, source: FakeEventSource.instances[0] };
  }

  function invalidatedKeys(): string[] {
    const calls = invalidate.mock.calls as Array<[{ queryKey: unknown }]>;
    return calls.map((call) => JSON.stringify(call[0].queryKey));
  }

  it('opens one EventSource at the workspace events path', () => {
    const { source } = connect();
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(source.url).toBe('/api/repositories/repo-1/workspaces/wt-1/events');
  });

  it('maps a topic hint to its query invalidation', () => {
    const { source } = connect();
    invalidate.mockClear();

    source.emitTopic('daemons');
    expect(invalidatedKeys()).toEqual([JSON.stringify(['workspace-daemons', 'repo-1', 'wt-1'])]);

    invalidate.mockClear();
    source.emitTopic('daemon-events');
    expect(invalidatedKeys()).toEqual([JSON.stringify(['workspace-daemon-events', 'repo-1', 'wt-1'])]);

    invalidate.mockClear();
    source.emitTopic('commands');
    expect(invalidatedKeys()).toEqual([JSON.stringify(['commands'])]);
  });

  it('a single telemetry hint refreshes all four telemetry views', () => {
    const { source } = connect();
    invalidate.mockClear();

    source.emitTopic('telemetry');

    expect(invalidatedKeys()).toEqual([
      JSON.stringify(['telemetry-errors', 'repo-1', 'wt-1']),
      JSON.stringify(['telemetry-spans', 'repo-1', 'wt-1']),
      JSON.stringify(['telemetry-metrics', 'repo-1', 'wt-1']),
      JSON.stringify(['telemetry-logs', 'repo-1', 'wt-1']),
    ]);
  });

  it('ignores unknown topics such as the heartbeat', () => {
    const { source } = connect();
    invalidate.mockClear();

    source.emitTopic('ping');

    expect(invalidate).not.toHaveBeenCalled();
  });

  it('on (re)connect, invalidates every mapped key exactly once', () => {
    const { source } = connect();
    invalidate.mockClear();

    source.emitOpen();

    // daemons(1) + daemon-events(1) + telemetry(4) + commands(1) = 7
    expect(invalidate).toHaveBeenCalledTimes(7);
    const keys = invalidatedKeys();
    expect(keys).toContain(JSON.stringify(['workspace-daemons', 'repo-1', 'wt-1']));
    expect(keys).toContain(JSON.stringify(['workspace-daemon-events', 'repo-1', 'wt-1']));
    expect(keys).toContain(JSON.stringify(['telemetry-logs', 'repo-1', 'wt-1']));
    expect(keys).toContain(JSON.stringify(['commands']));
  });

  it('closes the EventSource when the providing component is destroyed', () => {
    const { fixture, source } = connect();
    expect(source.closed).toBe(false);

    fixture.destroy();

    expect(source.closed).toBe(true);
  });
});
