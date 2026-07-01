import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  input,
  signal,
  viewChild,
} from '@angular/core';

import { ChatItem, ChatItemKind } from './chat-stream';

/**
 * Presentational: renders a Claude conversation as chat bubbles and, for the richer events (tool
 * calls, tool results, thinking, system/errors), compact rows. A small popover lets the viewer hide
 * event categories — nothing is hidden by default. Used by both the live chat and the replay.
 */
@Component({
  selector: 'app-chat-transcript',
  imports: [],
  template: `
    <div class="flex items-center justify-end">
      <div class="relative">
        <button
          type="button"
          class="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
          (click)="filterOpen.set(!filterOpen())"
        >
          Events ▾
        </button>
        @if (filterOpen()) {
          <div class="absolute right-0 z-10 mt-1 w-48 rounded-md border bg-background p-2 shadow-md">
            <p class="mb-1 px-1 text-xs font-medium text-muted-foreground">Show events</p>
            <label class="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted">
              <input type="checkbox" [checked]="showToolCall()" (change)="showToolCall.set(isChecked($event))" />
              Tool calls
            </label>
            <label class="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted">
              <input type="checkbox" [checked]="showToolResult()" (change)="showToolResult.set(isChecked($event))" />
              Tool results
            </label>
            <label class="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted">
              <input type="checkbox" [checked]="showThinking()" (change)="showThinking.set(isChecked($event))" />
              Thinking
            </label>
            <label class="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted">
              <input type="checkbox" [checked]="showSystem()" (change)="showSystem.set(isChecked($event))" />
              System
            </label>
          </div>
        }
      </div>
    </div>

    <div #scroll class="flex flex-1 flex-col gap-2 overflow-y-auto">
      @for (item of visible(); track $index) {
        @switch (item.kind) {
          @case ('user') {
            <div class="self-end max-w-[80%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground whitespace-pre-wrap">
              {{ item.text }}
            </div>
          }
          @case ('assistant') {
            <div class="self-start max-w-[80%] rounded-lg bg-muted px-3 py-2 text-sm whitespace-pre-wrap">
              {{ item.text }}
            </div>
          }
          @case ('thinking') {
            <div class="self-start max-w-[80%] whitespace-pre-wrap px-3 py-1 text-xs italic text-muted-foreground">
              {{ item.text }}
            </div>
          }
          @case ('toolCall') {
            <div class="self-start text-xs text-muted-foreground">⚙ using tool: {{ item.text }}</div>
          }
          @case ('toolResult') {
            <div
              class="self-start max-w-[80%] max-h-40 overflow-auto rounded-md border px-3 py-2 font-mono text-xs whitespace-pre-wrap"
              [class.text-destructive]="item.error"
              [class.border-destructive]="item.error"
            >
              {{ item.text || '(empty result)' }}
            </div>
          }
          @default {
            <div class="self-center text-xs" [class.text-destructive]="item.error" [class.text-muted-foreground]="!item.error">
              {{ item.text }}
            </div>
          }
        }
      }
      @if (waiting()) {
        <div class="self-start text-xs text-muted-foreground">Claude is thinking…</div>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatTranscriptComponent {
  readonly items = input.required<ChatItem[]>();
  readonly waiting = input(false);

  readonly filterOpen = signal(false);
  readonly showToolCall = signal(true);
  readonly showToolResult = signal(true);
  readonly showThinking = signal(true);
  readonly showSystem = signal(true);

  private readonly scroll = viewChild<ElementRef<HTMLDivElement>>('scroll');

  readonly visible = computed(() => this.items().filter((i) => this.isVisible(i.kind)));

  constructor() {
    effect(() => {
      this.visible();
      this.waiting();
      const el = this.scroll()?.nativeElement;
      if (el) {
        queueMicrotask(() => (el.scrollTop = el.scrollHeight));
      }
    });
  }

  protected isChecked(event: Event): boolean {
    return (event.target as HTMLInputElement).checked;
  }

  private isVisible(kind: ChatItemKind): boolean {
    switch (kind) {
      case 'toolCall':
        return this.showToolCall();
      case 'toolResult':
        return this.showToolResult();
      case 'thinking':
        return this.showThinking();
      case 'system':
        return this.showSystem();
      default:
        return true; // user + assistant text are always shown
    }
  }
}
