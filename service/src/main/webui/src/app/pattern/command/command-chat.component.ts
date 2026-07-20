import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';

import { PromptDraftSyncService } from '@/pattern/workspace/prompt-draft-sync.service';
import { ZardButtonComponent } from '@/shared/components/button';
import { ZardInputDirective } from '@/shared/components/input';
import {
  type CodeReference,
  PickedSnippet,
  PromptContextStore,
} from '@/shared/state/prompt-context.store';
import { codeReferenceLabel, formatSnippetsForPrompt } from '@/shared/state/snippet-format';
import { wsUrl } from '@/shared/utils/app-base';
import { blobToAttachment, imageBlobFromClipboard } from '@/shared/utils/image-attach';
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

      <!-- Elements picked from a daemon web view and code references selected in the Files tab
           (root-scoped cache) — click to drop one into the draft: elements as a fenced HTML
           block, references as their one-line path:start-end form. -->
      @if (promptContext.count() > 0 || promptContext.references().length > 0) {
        <div class="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          <span>Picked:</span>
          @for (snippet of promptContext.snippets(); track snippet.id) {
            <button
              z-button
              zType="outline"
              zSize="sm"
              type="button"
              [title]="'Insert ' + snippet.selector + ' into the message'"
              (click)="insertSnippet(snippet)"
            >
              {{ snippet.component?.className ?? snippet.tag }}
            </button>
          }
          @for (ref of promptContext.references(); track refLabel(ref)) {
            <button
              z-button
              zType="outline"
              zSize="sm"
              type="button"
              [title]="'Insert ' + refLabel(ref) + ' into the message'"
              (click)="insertReference(ref)"
            >
              {{ refLabel(ref) }}
            </button>
          }
        </div>
      }

      <!-- Images attached to this workspace's draft (paste to add). On send the agent is nudged to
           re-fetch them via taskPrompt. Only shown where the chat has workspace context (not the
           standalone /commands view). -->
      @if (canAttachImages() && promptContext.images().length > 0) {
        <div class="flex flex-wrap items-center gap-2">
          @for (img of promptContext.images(); track img.id) {
            <div class="flex items-center gap-1 rounded-md border p-1 text-xs">
              <img
                [src]="'data:' + img.mimeType + ';base64,' + img.dataBase64"
                class="size-10 rounded object-cover"
                alt=""
              />
              <span class="max-w-32 truncate">{{ img.label }}</span>
              <button
                z-button
                zType="ghost"
                zSize="sm"
                type="button"
                (click)="removeImage(img.id)"
                [attr.aria-label]="'Remove image ' + img.label"
              >
                Remove
              </button>
            </div>
          }
        </div>
      }
      @if (attachError()) {
        <p class="text-xs text-destructive">
          Couldn't attach the image — it may be larger than the size limit.
        </p>
      }

      <form class="flex items-center gap-2" (submit)="onSubmit($event)">
        <input
          z-input
          class="flex-1"
          placeholder="Ask Claude…"
          autocomplete="off"
          [value]="draft()"
          (input)="draft.set($any($event.target).value)"
          (paste)="onPaste($event)"
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
  /**
   * The workspace this chat belongs to. Present when hosted on the workspace detail route (enables
   * image attach + the taskPrompt nudge); null on the standalone `/commands/{id}` view, where there
   * is no draft to attach to.
   */
  readonly repoId = input<string | null>(null);
  readonly workspaceId = input<string | null>(null);

  protected readonly promptContext = inject(PromptContextStore);
  // Route-scoped: present under the workspace detail route, absent on the standalone command view.
  private readonly sync = inject(PromptDraftSyncService, { optional: true });
  /** True only where we can attach images: workspace context + the draft sync service are present. */
  protected readonly canAttachImages = computed(
    () => !!this.repoId() && !!this.workspaceId() && !!this.sync,
  );
  /** Template alias: the `path:start[-end]` label a reference renders (and tracks) as. */
  protected readonly refLabel = codeReferenceLabel;

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
    const ws = new WebSocket(wsUrl(`api/chat/commands/${this.commandId()}`));
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

  insertSnippet(snippet: PickedSnippet): void {
    this.draft.update((draft) =>
      (draft ? draft + '\n' : '') + formatSnippetsForPrompt([snippet]),
    );
  }

  insertReference(ref: CodeReference): void {
    this.draft.update((draft) => (draft ? draft + '\n' : '') + codeReferenceLabel(ref));
  }

  /** An image paste failed to attach (e.g. it exceeded the server's per-image size cap → 413). */
  readonly attachError = signal(false);

  /**
   * Paste an image into the running chat: persist it as a draft attachment (so taskPrompt serves it)
   * instead of pasting text. No-op without workspace context (the standalone command view). The
   * outgoing turn (see {@link onSubmit}) nudges the agent to re-fetch the attachments. A failed
   * attach (oversize/reject) is surfaced rather than swallowed.
   */
  async onPaste(event: ClipboardEvent): Promise<void> {
    if (!this.canAttachImages()) {
      return;
    }
    const blob = imageBlobFromClipboard(event.clipboardData);
    if (!blob) {
      return;
    }
    event.preventDefault();
    this.attachError.set(false);
    try {
      const { dataBase64, mimeType } = await blobToAttachment(blob);
      await this.sync!.attachImage(dataBase64, mimeType, 'paste');
    } catch {
      this.attachError.set(true);
    }
  }

  /** Remove an attached image (deletes its server row via the sync service). */
  removeImage(id: string): void {
    void this.sync?.removeImage(id);
  }

  onSubmit(event: Event): void {
    event.preventDefault();
    const text = this.draft().trim();
    if (!text) {
      return;
    }
    this.draft.set('');
    this.thinking.set(true);
    // When images are attached, append a nudge so the running agent re-fetches them via taskPrompt
    // (the text-only chat turn can't carry an image; the attachment rows are the delivery path).
    const outgoing =
      this.canAttachImages() && this.promptContext.images().length > 0
        ? text + '\n\n(I attached an image — call taskPrompt to view the current attachments.)'
        : text;
    // Don't render the user bubble locally — the server echoes it back into the stream, keeping live
    // and replay identical.
    const payload = JSON.stringify({ type: 'user', text: outgoing });
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
