import { NgTemplateOutlet } from '@angular/common';
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

import { MarkdownComponent } from '@/ui/components/markdown/markdown.component';

import { ChatItem, ChatItemKind, foldSidechains } from './chat-stream';

/**
 * Presentational: renders a Claude conversation as chat bubbles and, for the richer events (tool
 * calls, tool results, thinking, system/errors), compact rows. A small popover lets the viewer hide
 * event categories — nothing is hidden by default. Used by both the live chat and the replay.
 *
 * Extracted transcripts additionally carry subagent sidechains: their items are folded into
 * collapsible groups anchored at the Task tool-call that spawned them (see {@code foldSidechains}),
 * labeled "agentType: description" and collapsed by default. A live stream has none, so it renders
 * exactly as before.
 */
@Component({
  selector: 'app-chat-transcript',
  imports: [MarkdownComponent, NgTemplateOutlet],
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
      @for (entry of entries(); track $index) {
        @if (entry.kind === 'group') {
          <div class="self-start w-[90%] rounded-md border border-dashed">
            <button
              type="button"
              class="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-muted-foreground hover:bg-muted"
              (click)="toggleGroup(entry.agentId)"
              [attr.aria-expanded]="isExpanded(entry.agentId)"
            >
              <span>{{ isExpanded(entry.agentId) ? '▾' : '▸' }}</span>
              <span class="font-medium">{{ entry.label }}</span>
              <span>({{ entry.items.length }} events)</span>
            </button>
            @if (isExpanded(entry.agentId)) {
              <div class="flex flex-col gap-2 border-t border-dashed p-3">
                @for (item of entry.items; track $index) {
                  <ng-container *ngTemplateOutlet="chatItem; context: { $implicit: item }" />
                }
              </div>
            }
          </div>
        } @else {
          <ng-container *ngTemplateOutlet="chatItem; context: { $implicit: entry.item }" />
        }
      }
      @if (waiting()) {
        <div class="self-start text-xs text-muted-foreground">Claude is thinking…</div>
      }
    </div>

    <ng-template #chatItem let-item>
      @switch (item.kind) {
        @case ('user') {
          <div class="self-end max-w-[80%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground">
            <app-markdown [text]="item.text" />
          </div>
        }
        @case ('assistant') {
          <div class="self-start max-w-[80%] rounded-lg bg-muted px-3 py-2 text-sm">
            <app-markdown [text]="item.text" />
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
    </ng-template>
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

  /** Sidechain groups the viewer opened (collapsed by default). */
  private readonly expandedGroups = signal<ReadonlySet<string>>(new Set());

  private readonly scroll = viewChild<ElementRef<HTMLDivElement>>('scroll');

  readonly visible = computed(() => this.items().filter((i) => this.isVisible(i.kind)));

  /** The visible items folded into main-thread rows + collapsible sidechain groups. */
  readonly entries = computed(() => foldSidechains(this.visible()));

  constructor() {
    effect(() => {
      this.entries();
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

  protected isExpanded(agentId: string): boolean {
    return this.expandedGroups().has(agentId);
  }

  protected toggleGroup(agentId: string): void {
    this.expandedGroups.update((current) => {
      const next = new Set(current);
      if (!next.delete(agentId)) {
        next.add(agentId);
      }
      return next;
    });
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
        return true; // user + assistant text (and sidechain labels) are always shown
    }
  }
}
