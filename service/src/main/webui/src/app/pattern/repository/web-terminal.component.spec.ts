import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { WebTerminalComponent } from './web-terminal.component';

/** xterm.js needs matchMedia + ResizeObserver, which jsdom doesn't provide. */
function stubXtermBrowserApis(): void {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    media: '',
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  }));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
}

/** Records every socket the component opens and lets tests drive open/close events. */
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static readonly OPEN = 1;
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(): void {}

  close(): void {
    this.readyState = 3;
  }

  serverOpens(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  serverCloses(code: number): void {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

describe('WebTerminalComponent', () => {
  beforeEach(async () => {
    FakeWebSocket.instances = [];
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeWebSocket);
    stubXtermBrowserApis();
    await TestBed.configureTestingModule({ imports: [WebTerminalComponent] }).compileComponents();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function createComponent() {
    const fixture = TestBed.createComponent(WebTerminalComponent);
    fixture.componentRef.setInput('commandId', 'cmd-1');
    fixture.detectChanges();
    return fixture;
  }

  it('reconnects after an abnormal close — 1008 auth expiry renews the token via re-handshake', () => {
    createComponent();
    expect(FakeWebSocket.instances).toHaveLength(1);

    const first = FakeWebSocket.instances[0];
    first.serverOpens();
    first.serverCloses(1008);
    expect(FakeWebSocket.instances).toHaveLength(1); // reconnect is delayed, not immediate

    vi.advanceTimersByTime(300);
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(FakeWebSocket.instances[1].url).toBe(first.url);
  });

  it('backs off and gives up after repeated failures instead of looping forever', () => {
    createComponent();
    for (let i = 0; i < 5; i++) {
      FakeWebSocket.instances[i].serverCloses(1006);
      vi.advanceTimersByTime(5000);
      expect(FakeWebSocket.instances).toHaveLength(i + 2);
    }
    // The 6th socket's failure exhausts the retry budget — no further attempts.
    FakeWebSocket.instances[5].serverCloses(1006);
    vi.advanceTimersByTime(60000);
    expect(FakeWebSocket.instances).toHaveLength(6);
  });

  it('treats a clean server close as final — the command is gone or explicitly detached', () => {
    createComponent();
    const first = FakeWebSocket.instances[0];
    first.serverOpens();
    first.serverCloses(1000);

    vi.advanceTimersByTime(60000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('a successful reopen resets the retry budget', () => {
    createComponent();
    FakeWebSocket.instances[0].serverCloses(1006);
    vi.advanceTimersByTime(5000);

    const second = FakeWebSocket.instances[1];
    second.serverOpens(); // resets retries
    second.serverCloses(1008);
    vi.advanceTimersByTime(300); // back to the first-retry delay
    expect(FakeWebSocket.instances).toHaveLength(3);
  });

  it('never reconnects after destroy', () => {
    const fixture = createComponent();
    const first = FakeWebSocket.instances[0];
    first.serverOpens();
    fixture.destroy();
    first.serverCloses(1006);

    vi.advanceTimersByTime(60000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});
