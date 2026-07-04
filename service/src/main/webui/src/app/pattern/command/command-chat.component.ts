import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  input,
  signal,
} from '@angular/core';

import { ZardButtonComponent } from '@/shared/components/button';
import { ZardInputDirective } from '@/shared/components/input';
import { ChatTranscriptComponent } from './chat-transcript.component';
import { isTurnEnd, linesToItems } from './chat-stream';

type Status = 'connecting' | 'open' | 'closed';

/**
 * Live view of a running {@code CHAT} command: attaches to the registry chat process over
 * `/api/chat/commands/{id}` (replaying the conversation so you pick up where you left off), sends
 * user turns, and renders the streamed events. Robust to connect timing — messages queue until the
 * socket opens and it auto-reconnects. The user's own turn is rendered from the server's echo, so it
 * appears in the same order live and on replay.
 */
@Component({
  selector: 'app-command-chat',
  imports: [ChatTranscriptComponent, ZardButtonComponent, ZardInputDirective],
  template: `
    <div class="flex flex-col gap-3 rounded-lg border p-4" [class]="heightClass()">
      <!-- The host must grow for the transcript's inner scroller to work and the form to pin. -->
      <app-chat-transcript class="flex min-h-0 flex-1 flex-col" [items]="items()" [waiting]="thinking()" />

      <form class="flex items-center gap-2" (submit)="onSubmit($event)">
        <input
          z-input
          class="flex-1"
          placeholder="Ask Claude…"
          autocomplete="off"
          [value]="draft()"
          (input)="draft.set($any($event.target).value)"
          aria-label="Message"
        />
        <button z-button type="submit" [disabled]="!draft().trim()">Send</button>
      </form>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommandChatComponent implements OnInit, OnDestroy {
  readonly commandId = input.required<string>();
  /** Container height; the chat dialog overrides this to fill its full-size body. */
  readonly heightClass = input('h-[70vh]');

  private readonly lines = signal<string[]>([]);
  readonly items = computed(() => linesToItems(this.lines()));
  readonly draft = signal('');
  readonly thinking = signal(false);
  readonly status = signal<Status>('connecting');

  private ws?: WebSocket;
  private readonly pending: string[] = [];
  private destroyed = false;
  private reconnectTimer?: ReturnType<typeof setTimeout>;

  ngOnInit(): void {
    this.connect();
  }

  private connect(): void {
    if (this.destroyed) {
      return;
    }
    this.status.set('connecting');
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${window.location.host}/api/chat/commands/${this.commandId()}`);
    this.ws = ws;
    ws.onopen = () => {
      this.status.set('open');
      for (const payload of this.pending.splice(0)) {
        ws.send(payload);
      }
    };
    ws.onmessage = (event) => this.onFrame(typeof event.data === 'string' ? event.data : '');
    ws.onclose = () => {
      this.status.set('closed');
      if (!this.destroyed) {
        this.reconnectTimer = setTimeout(() => this.connect(), 1500);
      }
    };
  }

  private onFrame(frame: string): void {
    // A frame may carry several JSON lines (e.g. replay on attach); split and accumulate.
    const incoming = frame.split('\n').filter((l) => l.trim().length > 0);
    if (incoming.length === 0) {
      return;
    }
    this.lines.update((current) => [...current, ...incoming]);
    if (incoming.some(isTurnEnd)) {
      this.thinking.set(false);
    }
  }

  onSubmit(event: Event): void {
    event.preventDefault();
    const text = this.draft().trim();
    if (!text) {
      return;
    }
    this.draft.set('');
    this.thinking.set(true);
    // Don't render the user bubble locally — the server echoes it back into the stream, keeping live
    // and replay identical.
    const payload = JSON.stringify({ type: 'user', text });
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(payload);
    } else {
      this.pending.push(payload);
      if (this.status() === 'closed') {
        this.connect();
      }
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }
}
