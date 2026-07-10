import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { CommandControllerService } from '@/api/api/commandController.service';
import { LogChannel } from '@/api/model/logChannel';
import { ChatTranscriptComponent } from './chat-transcript.component';
import { linesToItems } from './chat-stream';

/**
 * Read-only replay of a finished {@code CHAT} command: reads the durable conversation (the imported
 * agent transcript) from the same `/log` endpoint terminals use and renders it as chat bubbles via
 * {@link linesToItems}.
 */
@Component({
  selector: 'app-command-chat-log',
  imports: [ChatTranscriptComponent],
  template: `
    @if (logQuery.isPending()) {
      <div class="text-sm text-muted-foreground">Loading conversation…</div>
    } @else if (logQuery.isError()) {
      <div class="text-sm text-destructive">Failed to load conversation</div>
    } @else if (items().length === 0) {
      <div class="text-sm text-muted-foreground">This chat has no captured messages.</div>
    } @else {
      <div class="flex h-[70vh] flex-col rounded-lg border p-4">
        <app-chat-transcript [items]="items()" />
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommandChatLogComponent {
  readonly commandId = input.required<string>();

  private readonly commandService = inject(CommandControllerService);

  // Pinned to the TRANSCRIPT channel — for a chat that is "the durable conversation": the imported
  // agent transcript (incl. subagent sidechains) merged server-side with the persisted error
  // results, falling back to the full intercepted OUTPUT stream for pre-cutover chats.
  readonly logQuery = injectQuery(() => ({
    queryKey: ['command-log', this.commandId(), LogChannel.Transcript],
    queryFn: () =>
      lastValueFrom(
        this.commandService.apiCommandsCommandIdLogGet(this.commandId(), LogChannel.Transcript),
      ).then((r) => r.lines ?? []),
  }));

  readonly items = computed(() =>
    linesToItems((this.logQuery.data() ?? []).map((l) => l.content ?? '')),
  );
}
