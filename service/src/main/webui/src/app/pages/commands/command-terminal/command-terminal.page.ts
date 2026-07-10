import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { QueryClient, injectMutation, injectQuery } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { AgentControllerService } from '@/api/api/agentController.service';
import { CommandControllerService } from '@/api/api/commandController.service';
import { AgentLaunchMode } from '@/api/model/agentLaunchMode';
import { AgentMcpScope } from '@/api/model/agentMcpScope';
import { CommandKind } from '@/api/model/commandKind';
import { CommandStatus } from '@/api/model/commandStatus';
import { PageLayoutComponent } from '@/layout/page-layout/page-layout.component';
import { CommandChatComponent } from '@/pattern/command/command-chat.component';
import { CommandChatLogComponent } from '@/pattern/command/command-chat-log.component';
import { CommandLogComponent } from '@/pattern/command/command-log.component';
import { CommandTranscriptComponent } from '@/pattern/command/command-transcript.component';
import { WebTerminalComponent } from '@/pattern/repository/web-terminal.component';
import { ZardButtonComponent } from '@/shared/components/button';
import { ZardTabComponent, ZardTabGroupComponent } from '@/shared/components/tabs';

/**
 * The view for a single registry command. A running command re-attaches to its live process
 * (replaying scrollback) so navigating here is "picking back up where you left off"; a finished
 * command shows its read-only captured log instead. Either way the header shows where it came from —
 * the action, branch and the commit checked out at launch.
 *
 * A finished agent command (one with a session lineage) additionally offers the extracted session
 * transcript — the auditable conversation, imported from the harness's own persistence on exit —
 * and Resume / Fork, which relaunch the command's current (last) session as a new command.
 */
@Component({
  selector: 'app-command-terminal-page',
  imports: [
    PageLayoutComponent,
    WebTerminalComponent,
    CommandLogComponent,
    CommandChatComponent,
    CommandChatLogComponent,
    CommandTranscriptComponent,
    ZardButtonComponent,
    ZardTabComponent,
    ZardTabGroupComponent,
    RouterLink,
  ],
  template: `
    <app-page-layout>
      <div pageTitle class="flex flex-col gap-1">
        @let command = commandQuery.data();
        <span class="text-sm text-muted-foreground">Command</span>
        <h1 class="text-2xl font-semibold">{{ command?.actionName ?? '…' }}</h1>
        @if (command) {
          <span class="font-mono text-xs text-muted-foreground">
            {{ command.branch }} · {{ command.shortCommitHash }} · {{ command.status }}
          </span>
        }
      </div>

      <div pageActions class="flex items-center gap-2">
        @if (canResume()) {
          <button
            z-button
            zType="secondary"
            [zDisabled]="relaunchMutation.isPending()"
            (click)="relaunch(false)"
            title="Continue this agent session in a new command"
          >
            Resume session
          </button>
          <button
            z-button
            zType="secondary"
            [zDisabled]="relaunchMutation.isPending()"
            (click)="relaunch(true)"
            title="Branch this agent session into a new, independent one"
          >
            Fork session
          </button>
        }
        @let repoId = commandQuery.data()?.repoId;
        @if (repoId) {
          <a z-button zType="secondary" [routerLink]="['/repositories', repoId]">Back to repository</a>
        }
      </div>

      @if (commandQuery.data(); as command) {
        <!-- Tracked by command id so Resume/Fork navigation (same route, new param) recreates the
             children — the terminal/chat sockets connect once per component instance. -->
        @for (cid of [commandId()]; track cid) {
          @if (command.kind === CommandKind.Chat) {
            @if (command.status === CommandStatus.Running) {
              <app-command-chat [commandId]="cid" />
            } @else {
              <app-command-chat-log [commandId]="cid" />
            }
          } @else if (command.status === CommandStatus.Running) {
            <app-web-terminal [commandId]="cid" />
          } @else if (hasAgentSessions()) {
            <!-- A finished interactive agent run: the transcript is the readable conversation
                 (imported on exit); the terminal log is the raw ANSI byte stream. -->
            <z-tab-group>
              <z-tab label="Transcript">
                <div class="pt-4">
                  <app-command-transcript [commandId]="cid" />
                </div>
              </z-tab>
              <z-tab label="Terminal">
                <div class="pt-4">
                  <app-command-log
                    [commandId]="cid"
                    [highlightFrom]="highlightFrom"
                    [highlightTo]="highlightTo"
                  />
                </div>
              </z-tab>
            </z-tab-group>
          } @else {
            <app-command-log
              [commandId]="cid"
              [highlightFrom]="highlightFrom"
              [highlightTo]="highlightTo"
            />
          }
        }
        @if (relaunchMutation.isError()) {
          <div class="mt-2 text-sm text-destructive">Failed to relaunch the session</div>
        }
      } @else if (commandQuery.isError()) {
        <div class="text-sm text-destructive">Failed to load command</div>
      } @else {
        <div class="text-sm text-muted-foreground">Loading command…</div>
      }
    </app-page-layout>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommandTerminalPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly queryClient = inject(QueryClient);
  private readonly commandService = inject(CommandControllerService);
  private readonly agentService = inject(AgentControllerService);

  protected readonly CommandStatus = CommandStatus;
  protected readonly CommandKind = CommandKind;

  /** Reactive: Resume/Fork navigates to the new command on this same route. */
  private readonly params = toSignal(this.route.paramMap, {
    initialValue: this.route.snapshot.paramMap,
  });
  readonly commandId = computed(() => this.params().get('commandId')!);

  /** Optional ?seq=&seqTo= from a daemon event's "open in source" link. */
  readonly highlightFrom = this.queryParamNumber('seq');
  readonly highlightTo = this.queryParamNumber('seqTo');

  private queryParamNumber(name: string): number | null {
    const raw = this.route.snapshot.queryParamMap.get(name);
    const parsed = raw === null ? Number.NaN : Number.parseInt(raw, 10);
    return Number.isNaN(parsed) ? null : parsed;
  }

  readonly commandQuery = injectQuery(() => ({
    queryKey: ['command', this.commandId()],
    queryFn: () =>
      lastValueFrom(this.commandService.apiCommandsCommandIdGet(this.commandId())).then(
        (r) => r.command ?? null,
      ),
  }));

  readonly hasAgentSessions = computed(
    () => (this.commandQuery.data()?.agentSessions?.length ?? 0) > 0,
  );

  /** Resume/Fork act on the command's current (last) session, once the run has finished. */
  readonly canResume = computed(() => {
    const command = this.commandQuery.data();
    return (
      !!command && command.status !== CommandStatus.Running && this.hasAgentSessions()
    );
  });

  readonly relaunchMutation = injectMutation(() => ({
    mutationFn: (fork: boolean) => {
      const command = this.commandQuery.data()!;
      const sessions = command.agentSessions ?? [];
      const currentSession = sessions[sessions.length - 1]!.sessionId!;
      return lastValueFrom(
        this.agentService.apiRepositoriesRepoIdWorkspacesWorkspaceIdAgentsPost(
          command.repoId!,
          command.workspaceId!,
          {
            scope: AgentMcpScope.Repository,
            resumeSessionId: currentSession,
            fork,
            mode:
              command.kind === CommandKind.Chat ? AgentLaunchMode.Chat : AgentLaunchMode.Interactive,
          },
        ),
      );
    },
    onSuccess: (res) => {
      void this.queryClient.invalidateQueries({ queryKey: ['commands'] });
      const newId = res.command?.id;
      if (newId) {
        void this.router.navigate(['/commands', newId]);
      }
    },
  }));

  relaunch(fork: boolean) {
    this.relaunchMutation.mutate(fork);
  }
}
