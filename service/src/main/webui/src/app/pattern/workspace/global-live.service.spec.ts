import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GlobalLiveService } from './global-live.service';

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

// Provides the service exactly as the project page does (component-scoped), so destroy tears it down.
@Component({ selector: 'app-test-global-live-host', template: '', providers: [GlobalLiveService] })
class TestLiveHost {
  readonly live = inject(GlobalLiveService);
  constructor() {
    this.live.connect();
  }
}

describe('GlobalLiveService', () => {
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

  it('opens one EventSource at the global events path', () => {
    const { source } = connect();
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(source.url).toBe('/api/events');
  });

  it('maps the agent-activity hint to the workspaces prefix invalidation', () => {
    const { source } = connect();
    invalidate.mockClear();

    source.emitTopic('agent-activity');

    // The prefix ['workspaces'] — every observed repo's workspace list refetches.
    expect(invalidatedKeys()).toEqual([JSON.stringify(['workspaces'])]);
  });

  it('ignores unknown topics such as the heartbeat', () => {
    const { source } = connect();
    invalidate.mockClear();

    source.emitTopic('ping');

    expect(invalidate).not.toHaveBeenCalled();
  });

  it('on (re)connect, invalidates every topic key once', () => {
    const { source } = connect();
    invalidate.mockClear();

    source.emitOpen();

    expect(invalidatedKeys()).toEqual([JSON.stringify(['workspaces'])]);
  });

  it('closes the EventSource when the providing component is destroyed', () => {
    const { fixture, source } = connect();
    expect(source.closed).toBe(false);

    fixture.destroy();

    expect(source.closed).toBe(true);
  });
});
