import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  effect,
  input,
  viewChild,
} from '@angular/core';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';

import { wsUrl } from '@/shared/utils/app-base';

/**
 * Smart component that renders a live PTY server-side (a process running in its workspace) over a
 * WebSocket, with xterm.js. By default it attaches to a registry command by `commandId` (opening
 * the socket re-attaches — replaying scrollback — and closing it only detaches; the process keeps
 * running). Pass an explicit `socketPath` to point it at a different terminal endpoint — e.g. the
 * daemon interactive-attach socket, which has no durable `commandId`.
 *
 * Abnormal closes auto-reconnect (reset the terminal, re-attach, let the replay repaint):
 * websockets-next closes every authenticated socket with 1008 "Authentication expired" when the
 * OIDC access token expires — the re-handshake carries the session cookie and quarkus-oidc
 * silently refreshes, so reconnecting IS the token renewal
 * (docs/issues/2026-07-17_idle-websocket-reaped-behind-proxy.md) — and 1006 covers network blips
 * and machine sleep. Only a clean server close (1000: the command is gone, or an explicit detach)
 * or exhausted retries print [disconnected] — and a spent retry budget re-arms when the tab
 * becomes visible or the browser comes back online (a sleep/outage outlives the ~8s backoff
 * window; the return-to-tab moment is the event to reconnect on, not a poll). Only the clean
 * server close is truly final.
 */
@Component({
  selector: 'app-web-terminal',
  imports: [],
  template: `<div #host class="h-[70vh] w-full overflow-hidden rounded-lg border bg-black p-2"></div>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WebTerminalComponent implements OnDestroy {
  /** The registry command id whose PTY this terminal attaches to (unless `socketPath` is set). */
  readonly commandId = input<string>();

  /**
   * An explicit WebSocket path (relative to the app origin, no leading slash), overriding the
   * default `api/terminal/commands/<commandId>`. Used by the daemon interactive terminal.
   */
  readonly socketPath = input<string>();

  private readonly host = viewChild<ElementRef<HTMLDivElement>>('host');

  private term?: Terminal;
  private fitAddon?: FitAddon;
  private ws?: WebSocket;
  private resizeObserver?: ResizeObserver;
  private connected = false;
  private retries = 0;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private destroyed = false;
  private path?: string;
  /** Set by a clean server close (the command is gone / explicit detach) — wake never re-opens. */
  private finalClose = false;

  /**
   * Re-arm after the retry budget is spent: a laptop sleep or an outage longer than the ~8s
   * backoff window exhausts the five attempts, and the natural "I'm back" signals are the tab
   * becoming visible and the browser regaining network — reconnect then, not on a poll.
   */
  private readonly wakeHandler = () => {
    if (document.visibilityState !== 'visible') {
      return;
    }
    this.wake();
  };

  private readonly onlineHandler = () => this.wake();

  constructor() {
    // Connect once the host element has rendered. The `connected` guard keeps this a one-shot.
    effect(() => {
      const path = this.resolvePath();
      const el = this.host()?.nativeElement;
      if (!path || !el || this.connected) {
        return;
      }
      this.connected = true;
      this.connect(path, el);
    });
  }

  /** The WS path to open: the explicit `socketPath`, else derived from `commandId`; null if neither. */
  private resolvePath(): string | null {
    const explicit = this.socketPath();
    if (explicit) {
      return explicit;
    }
    const commandId = this.commandId();
    return commandId ? `api/terminal/commands/${commandId}` : null;
  }

  private connect(path: string, el: HTMLElement): void {
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: 13,
      theme: { background: '#000000' },
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(el);
    fitAddon.fit();
    this.term = term;
    this.fitAddon = fitAddon;

    term.onData((data) => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'data', data }));
      }
    });

    this.resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      this.sendResize();
    });
    this.resizeObserver.observe(el);

    this.path = path;
    document.addEventListener('visibilitychange', this.wakeHandler);
    window.addEventListener('online', this.onlineHandler);
    this.openSocket(path, term);
  }

  /** Reconnect with a fresh retry budget if the socket is down and the server didn't end it. */
  private wake(): void {
    const state = this.ws?.readyState;
    if (
      this.destroyed ||
      this.finalClose ||
      !this.path ||
      !this.term ||
      state === WebSocket.OPEN ||
      state === WebSocket.CONNECTING
    ) {
      return;
    }
    clearTimeout(this.reconnectTimer);
    this.retries = 0;
    this.term.reset();
    this.openSocket(this.path, this.term);
  }

  private openSocket(path: string, term: Terminal): void {
    const ws = new WebSocket(wsUrl(path));
    this.ws = ws;

    ws.onopen = () => {
      this.retries = 0;
      this.sendResize();
      term.focus();
    };
    ws.onmessage = (event) => term.write(typeof event.data === 'string' ? event.data : '');
    ws.onclose = (event) => {
      if (this.destroyed) {
        return;
      }
      // A clean close is the server's word: the command is gone (it says so in-band first) or an
      // explicit detach — final. Everything else (1008 auth expiry, 1006 network/sleep, rejected
      // handshakes) gets a bounded reconnect: re-attach replays scrollback onto a reset terminal.
      // A spent budget isn't the end — the wake handlers re-arm on tab refocus / network-online.
      if (event.code === 1000) {
        this.finalClose = true;
        term.write('\r\n\x1b[31m[disconnected]\x1b[0m\r\n');
        return;
      }
      if (this.retries >= 5) {
        term.write('\r\n\x1b[31m[disconnected]\x1b[0m\r\n');
        return;
      }
      const delay = Math.min(250 * 2 ** this.retries, 4000);
      this.retries++;
      this.reconnectTimer = setTimeout(() => {
        term.reset();
        this.openSocket(path, term);
      }, delay);
    };
  }

  private sendResize(): void {
    if (this.ws?.readyState === WebSocket.OPEN && this.term) {
      this.ws.send(JSON.stringify({ type: 'resize', cols: this.term.cols, rows: this.term.rows }));
    }
  }

  ngOnDestroy(): void {
    // Detach only: closing the socket leaves the backend process running for re-attach.
    this.destroyed = true;
    clearTimeout(this.reconnectTimer);
    document.removeEventListener('visibilitychange', this.wakeHandler);
    window.removeEventListener('online', this.onlineHandler);
    this.resizeObserver?.disconnect();
    this.ws?.close();
    this.term?.dispose();
  }
}
