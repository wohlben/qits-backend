import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { CommandControllerService } from '@/api/api/commandController.service';
import { LogChannel } from '@/api/model/logChannel';
import { ChatTranscriptComponent } from './chat-transcript.component';
import { linesToItems } from './chat-stream';

/**
 * Read-only view of an agent command's extracted session transcript — the TRANSCRIPT log channel,
 * imported from the harness's own JSONL on command exit (main session + subagent sidechains). This
 * is the structured, auditable conversation of an interactive TUI run, whose terminal byte stream
 * is unreadable ANSI; it exists only after the command finishes (the import is post-exit).
 */
@Component({
  selector: 'app-command-transcript',
  imports: [ChatTranscriptComponent],
  template: `
    @if (logQuery.isPending()) {
      <div class="text-sm text-muted-foreground">Loading transcript…</div>
    } @else if (logQuery.isError()) {
      <div class="text-sm text-destructive">Failed to load transcript</div>
    } @else if (items().length === 0) {
      <div class="text-sm text-muted-foreground">
        No transcript was captured for this session yet — it is imported when the command exits.
      </div>
    } @else {
      <div class="flex h-[70vh] flex-col rounded-lg border p-4">
        <app-chat-transcript [items]="items()" />
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommandTranscriptComponent {
  readonly commandId = input.required<string>();

  private readonly commandService = inject(CommandControllerService);

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
