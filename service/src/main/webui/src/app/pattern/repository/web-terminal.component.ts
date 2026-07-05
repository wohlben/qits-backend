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

/**
 * Smart component that renders a live PTY server-side (a process running in its worktree) over a
 * WebSocket, with xterm.js. By default it attaches to a registry command by `commandId` (opening
 * the socket re-attaches — replaying scrollback — and closing it only detaches; the process keeps
 * running). Pass an explicit `socketPath` to point it at a different terminal endpoint — e.g. the
 * daemon interactive-attach socket, which has no durable `commandId`.
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

    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${window.location.host}/${path}`);
    this.ws = ws;

    ws.onopen = () => {
      this.sendResize();
      term.focus();
    };
    ws.onmessage = (event) => term.write(typeof event.data === 'string' ? event.data : '');
    ws.onclose = () => term.write('\r\n\x1b[31m[disconnected]\x1b[0m\r\n');

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'data', data }));
      }
    });

    this.resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      this.sendResize();
    });
    this.resizeObserver.observe(el);
  }

  private sendResize(): void {
    if (this.ws?.readyState === WebSocket.OPEN && this.term) {
      this.ws.send(JSON.stringify({ type: 'resize', cols: this.term.cols, rows: this.term.rows }));
    }
  }

  ngOnDestroy(): void {
    // Detach only: closing the socket leaves the backend process running for re-attach.
    this.resizeObserver?.disconnect();
    this.ws?.close();
    this.term?.dispose();
  }
}
