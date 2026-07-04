import {
  ChangeDetectionStrategy,
  Component,
  TemplateRef,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideMessageSquare } from '@ng-icons/lucide';
import { injectMutation, injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { CommandControllerService } from '@/api/api/commandController.service';
import { CommandDto } from '@/api/model/commandDto';
import { CommandKind } from '@/api/model/commandKind';
import { CommandStatus } from '@/api/model/commandStatus';
import { CommandChatComponent } from '@/pattern/command/command-chat.component';
import { newestRunningChat } from '@/pattern/command/running-chat';
import { WorktreePromptPanelComponent } from '@/pattern/speech/worktree-prompt-panel.component';
import { ZardButtonComponent } from '@/shared/components/button';
import { ZardDialogRef, ZardDialogService } from '@/shared/components/dialog';

/**
 * The worktree's chat entry point: a header button that opens a near-fullscreen dialog holding the
 * worktree's agent conversation. No running session → the speak-to-prompt panel; launching swaps
 * to the chat in place. A running session (started from anywhere — here, the WIP route, or the
 * Commands page) → the chat re-attaches over its WebSocket, replaying the scrollback. Closing the
 * dialog only hides the viewport: the agent keeps running server-side (the dot on the button says
 * so), and reopening re-attaches losslessly.
 */
@Component({
  selector: 'app-worktree-chat',
  imports: [CommandChatComponent, WorktreePromptPanelComponent, ZardButtonComponent, NgIcon],
  template: `
    <button z-button zType="outline" class="relative" (click)="open()">
      <ng-icon name="lucideMessageSquare" class="size-4" />
      Chat
      @if (hasRunningSession()) {
        <span
          class="absolute -right-1 -top-1 size-2.5 rounded-full bg-primary"
          title="A chat session is running"
        ></span>
      }
    </button>

    <ng-template #chatTpl>
      <div class="flex h-full min-h-0 flex-col gap-4">
        <!-- Our own header (zTitle can't hold the terminate button); pr-8 clears the X button. -->
        <div class="flex items-center justify-between gap-4 pr-8">
          <div class="flex min-w-0 flex-col">
            <span class="font-semibold">Chat — {{ worktreeId() }}</span>
            <span class="text-xs text-muted-foreground">
              Closing this dialog keeps the agent running; reopen to pick up the conversation.
            </span>
          </div>
          @if (activeChatId(); as id) {
            <button
              z-button
              zType="destructive"
              [zLoading]="terminateMutation.isPending()"
              (click)="terminateMutation.mutate(id)"
            >
              Terminate
            </button>
          }
        </div>

        @if (activeChatId(); as id) {
          <app-command-chat class="block min-h-0 flex-1" [commandId]="id" heightClass="h-full" />
        } @else {
          <app-worktree-prompt-panel
            class="block min-h-0 flex-1 overflow-y-auto"
            [repoId]="repoId()"
            [worktreeId]="worktreeId()"
            [preamble]="preamble()"
            [navigateOnLaunch]="false"
            (launched)="onLaunched($event)"
          />
        }
      </div>
    </ng-template>
  `,
  viewProviders: [provideIcons({ lucideMessageSquare })],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorktreeChatComponent {
  readonly repoId = input.required<string>();
  readonly worktreeId = input.required<string>();
  readonly preamble = input<string | null>(null);

  private readonly commandService = inject(CommandControllerService);
  private readonly queryClient = inject(QueryClient);
  private readonly dialog = inject(ZardDialogService);
  private readonly router = inject(Router);

  private readonly chatTpl = viewChild<TemplateRef<unknown>>('chatTpl');

  private dialogRef: ZardDialogRef<unknown> | null = null;

  // Same key AND shape as the commands list's query, so both share one cache entry.
  readonly commandsQuery = injectQuery(() => ({
    queryKey: ['commands'],
    refetchInterval: 5000,
    queryFn: () =>
      lastValueFrom(this.commandService.apiCommandsGet()).then(
        (r) => r.entries?.map((e) => e.command!).filter((c): c is CommandDto => !!c) ?? [],
      ),
  }));

  /** Bridges the poll gap between launching from the dialog and the registry reporting it. */
  readonly launchedCommandId = signal<string | null>(null);

  /** The session this dialog attaches to: the registry's word, else the just-launched bridge. */
  readonly activeChatId = computed(() => {
    const session = newestRunningChat(this.commandsQuery.data(), this.worktreeId());
    if (session?.id) {
      return session.id;
    }
    const launched = this.launchedCommandId();
    if (!launched) {
      return null;
    }
    // Once the registry knows the launched command and it isn't running, stop bridging.
    const known = (this.commandsQuery.data() ?? []).find((c) => c.id === launched);
    return known && known.status !== CommandStatus.Running ? null : launched;
  });

  readonly hasRunningSession = computed(() => this.activeChatId() !== null);

  readonly terminateMutation = injectMutation(() => ({
    mutationFn: (commandId: string) =>
      lastValueFrom(this.commandService.apiCommandsCommandIdTerminatePost(commandId)),
    onSuccess: () => {
      this.launchedCommandId.set(null);
      return this.queryClient.invalidateQueries({ queryKey: ['commands'] });
    },
  }));

  open() {
    const content = this.chatTpl();
    if (!content) {
      return;
    }
    // Backdrop click must not close: it would silently drop an unsent transcript.
    this.dialogRef = this.dialog.create({
      zContent: content,
      zHideFooter: true,
      zMaskClosable: false,
      zCustomClasses: 'h-[90vh] w-[90vw] max-w-[90vw] grid-rows-[minmax(0,1fr)]',
    });
  }

  onLaunched(commandId: string) {
    // When the agent isn't signed in the backend returns an interactive `claude auth login`
    // terminal instead of a chat — it can't render inline, so close the dialog and redirect to its
    // command page (a real PTY) to finish OAuth. A chat stays here.
    void lastValueFrom(this.commandService.apiCommandsCommandIdGet(commandId)).then((response) => {
      const command = response.command;
      if (command?.kind && command.kind !== CommandKind.Chat) {
        this.dialogRef?.close();
        void this.router.navigate(['/commands', commandId]);
        return;
      }
      this.launchedCommandId.set(commandId);
      void this.queryClient.invalidateQueries({ queryKey: ['commands'] });
    });
  }
}
