import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RepositoryLiveService } from './repository-live.service';

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

// Provides the service exactly as the sync component does (component-scoped), so destroy tears it down.
@Component({ selector: 'app-test-repo-live-host', template: '', providers: [RepositoryLiveService] })
class TestLiveHost {
  readonly live = inject(RepositoryLiveService);
  constructor() {
    this.live.connect('repo-1');
  }
}

describe('RepositoryLiveService', () => {
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

  it('opens one EventSource at the repository events path', () => {
    const { source } = connect();
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(source.url).toBe('/api/repositories/repo-1/events');
  });

  it('maps the process hint to the active-process invalidation', () => {
    const { source } = connect();
    invalidate.mockClear();

    source.emitTopic('process');

    expect(invalidatedKeys()).toEqual([JSON.stringify(['repository-active-process', 'repo-1'])]);
  });

  it('ignores unknown topics such as the heartbeat', () => {
    const { source } = connect();
    invalidate.mockClear();

    source.emitTopic('ping');

    expect(invalidate).not.toHaveBeenCalled();
  });

  it('on (re)connect, invalidates the active-process key once', () => {
    const { source } = connect();
    invalidate.mockClear();

    source.emitOpen();

    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidatedKeys()).toEqual([JSON.stringify(['repository-active-process', 'repo-1'])]);
  });

  it('closes the EventSource when the providing component is destroyed', () => {
    const { fixture, source } = connect();
    expect(source.closed).toBe(false);

    fixture.destroy();

    expect(source.closed).toBe(true);
  });
});
