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
 * Smart component that renders a live registry command (a process running in its worktree, attached
 * to a real PTY server-side). It only opens a WebSocket to the command and renders the stream with
 * xterm.js. The process is owned by the backend `CommandRegistry`, so opening the socket re-attaches
 * to it — replaying the scrollback — and closing it (leaving the route) only detaches; the process
 * keeps running until it exits or is explicitly terminated.
 */
@Component({
  selector: 'app-web-terminal',
  imports: [],
  template: `<div #host class="h-[70vh] w-full overflow-hidden rounded-lg border bg-black p-2"></div>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WebTerminalComponent implements OnDestroy {
  /** The registry command id whose PTY this terminal attaches to. */
  readonly commandId = input.required<string>();

  private readonly host = viewChild<ElementRef<HTMLDivElement>>('host');

  private term?: Terminal;
  private fitAddon?: FitAddon;
  private ws?: WebSocket;
  private resizeObserver?: ResizeObserver;
  private connected = false;

  constructor() {
    // Connect once the host element has rendered. The `connected` guard keeps this a one-shot.
    effect(() => {
      const commandId = this.commandId();
      const el = this.host()?.nativeElement;
      if (!commandId || !el || this.connected) {
        return;
      }
      this.connected = true;
      this.connect(commandId, el);
    });
  }

  private connect(commandId: string, el: HTMLElement): void {
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
    const ws = new WebSocket(
      `${proto}://${window.location.host}/api/terminal/commands/${commandId}`,
    );
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
