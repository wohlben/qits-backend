import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { injectMutation, injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { CommandControllerService } from '@/api/api/commandController.service';
import { CommandDto } from '@/api/model/commandDto';
import { CommandKind } from '@/api/model/commandKind';
import { CommandStatus } from '@/api/model/commandStatus';
import { CommandChatComponent } from '@/pattern/command/command-chat.component';
import { newestRunningChat } from '@/pattern/command/running-chat';
import { WorkspacePromptPanelComponent } from '@/pattern/speech/workspace-prompt-panel.component';
import { ZardButtonComponent } from '@/shared/components/button';

/**
 * The workspace's Chat tab: the agent conversation rendered in place. No running session → the
 * speak-to-prompt panel; launching swaps to the chat in place. A running session (started from
 * anywhere — here, the WIP route, or the Commands page) → the chat re-attaches over its WebSocket,
 * replaying the scrollback. Switching tabs only hides the panel (the tab group keeps hidden tabs
 * mounted): the agent keeps running server-side — the dot on the tab label says so, via
 * {@link hasRunningSession} — and the socket stays attached, so coming back costs nothing.
 */
@Component({
  selector: 'app-workspace-chat',
  imports: [CommandChatComponent, WorkspacePromptPanelComponent, ZardButtonComponent],
  template: `
    <div class="flex flex-col gap-4">
      <div class="flex items-center justify-between gap-4">
        <span class="text-xs text-muted-foreground">
          Switching tabs keeps the agent running; come back to pick up the conversation.
        </span>
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
        <app-command-chat [commandId]="id" />
      } @else {
        <app-workspace-prompt-panel
          [repoId]="repoId()"
          [workspaceId]="workspaceId()"
          [preamble]="preamble()"
          [navigateOnLaunch]="false"
          (launched)="onLaunched($event)"
        />
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkspaceChatComponent {
  readonly repoId = input.required<string>();
  readonly workspaceId = input.required<string>();
  readonly preamble = input<string | null>(null);

  private readonly commandService = inject(CommandControllerService);
  private readonly queryClient = inject(QueryClient);
  private readonly router = inject(Router);

  // Same key AND shape as the commands list's query, so both share one cache entry.
  readonly commandsQuery = injectQuery(() => ({
    queryKey: ['commands'],
    queryFn: () =>
      lastValueFrom(this.commandService.apiCommandsGet()).then(
        (r) => r.entries?.map((e) => e.command!).filter((c): c is CommandDto => !!c) ?? [],
      ),
  }));

  /** Bridges the poll gap between launching from the tab and the registry reporting it. */
  readonly launchedCommandId = signal<string | null>(null);

  /** The session this tab attaches to: the registry's word, else the just-launched bridge. */
  readonly activeChatId = computed(() => {
    const session = newestRunningChat(this.commandsQuery.data(), this.workspaceId());
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

  onLaunched(commandId: string) {
    // When the agent isn't signed in the backend returns an interactive `claude` REPL login
    // terminal instead of a chat — it can't render inline, so redirect to its command page
    // (a real PTY) to finish OAuth. A chat stays here.
    void lastValueFrom(this.commandService.apiCommandsCommandIdGet(commandId)).then((response) => {
      const command = response.command;
      if (command?.kind && command.kind !== CommandKind.Chat) {
        void this.router.navigate(['/commands', commandId]);
        return;
      }
      this.launchedCommandId.set(commandId);
      void this.queryClient.invalidateQueries({ queryKey: ['commands'] });
    });
  }
}
