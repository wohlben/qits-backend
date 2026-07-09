import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { injectMutation, injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { CommandControllerService } from '@/api/api/commandController.service';
import { RepositoryActionsControllerService } from '@/api/api/repositoryActionsController.service';
import { ActionConfigurationDto } from '@/api/model/actionConfigurationDto';
import { ActionScope } from '@/api/model/actionScope';
import { CommandDto } from '@/api/model/commandDto';
import { CommandKind } from '@/api/model/commandKind';
import { CommandStatus } from '@/api/model/commandStatus';
import { commandStatusBadgeType, commandStatusLabel } from '@/pattern/command/command-status';
import { CommandLogComponent } from '@/pattern/command/command-log.component';
import { ZardBadgeComponent } from '@/shared/components/badge';
import { ZardButtonComponent } from '@/shared/components/button';

/**
 * The workspace's Actions tab: the repository's effective action set (global + repo-scoped, the
 * merge the branch-list "Run…" dialog never sees) with one-click launch into THIS workspace, and
 * the workspace's command run history below. One fetch per query on load; freshness after that is
 * push-only — the history key sits under the `['commands']` prefix the page's SSE `commands` hint
 * already invalidates, so nothing here polls. The action list refreshes on the usual mutation
 * invalidations (definitions change rarely, and never from this tab).
 */
@Component({
  selector: 'app-workspace-actions',
  imports: [DatePipe, CommandLogComponent, ZardBadgeComponent, ZardButtonComponent],
  template: `
    <div class="flex flex-col gap-6">
      <section class="flex flex-col gap-3" aria-label="Actions">
        <h2 class="text-lg font-semibold">Actions</h2>

        @if (actionsQuery.isPending()) {
          <div class="text-sm text-muted-foreground">Loading actions…</div>
        } @else if (actionsQuery.isError()) {
          <div class="text-sm text-destructive">Failed to load actions</div>
        } @else {
          @let actions = actionsQuery.data() ?? [];
          @if (actions.length === 0) {
            <p class="text-sm text-muted-foreground">
              No actions configured — define global ones under Action Configurations.
            </p>
          } @else {
            <ul class="flex flex-col divide-y rounded-md border">
              @for (action of actions; track action.id) {
                <li class="flex flex-wrap items-center gap-3 px-3 py-2">
                  <div class="flex min-w-0 flex-1 flex-col">
                    <span class="truncate font-medium">{{ action.name }}</span>
                    @if (action.description) {
                      <span class="truncate text-xs text-muted-foreground">
                        {{ action.description }}
                      </span>
                    }
                  </div>
                  <z-badge [zType]="isRepositoryScoped(action) ? 'outline' : 'secondary'">
                    {{ isRepositoryScoped(action) ? 'repository' : 'global' }}
                  </z-badge>
                  @if (action.interactive) {
                    <z-badge zType="default">interactive</z-badge>
                  }
                  <button
                    z-button
                    zSize="sm"
                    type="button"
                    [zLoading]="isLaunching(action)"
                    (click)="launchMutation.mutate(action)"
                  >
                    Run
                  </button>
                </li>
              }
            </ul>
          }
        }
      </section>

      <section class="flex flex-col gap-3" aria-label="Run history">
        <h2 class="text-lg font-semibold">Run history</h2>

        @if (commandsQuery.isPending()) {
          <div class="text-sm text-muted-foreground">Loading run history…</div>
        } @else if (commandsQuery.isError()) {
          <div class="text-sm text-destructive">Failed to load run history</div>
        } @else {
          @let commands = commandsQuery.data() ?? [];
          @if (commands.length === 0) {
            <p class="text-sm text-muted-foreground">
              Nothing has run in this workspace yet — hit Run on an action above.
            </p>
          } @else {
            <ul class="flex flex-col divide-y rounded-md border">
              @for (command of commands; track command.id) {
                <li class="flex flex-col gap-2 px-3 py-2">
                  <div class="flex flex-wrap items-center gap-3">
                    <div class="flex min-w-0 flex-1 flex-col">
                      <span class="truncate font-medium">{{ commandName(command) }}</span>
                      <span class="text-xs text-muted-foreground">
                        {{ command.launchedAt | date: 'short' }}
                        @if (command.exitCode !== undefined && command.exitCode !== null) {
                          · exit {{ command.exitCode }}
                        }
                      </span>
                    </div>
                    @if (showKindBadge(command)) {
                      <z-badge zType="outline">{{ kindLabel(command) }}</z-badge>
                    }
                    <z-badge [zType]="badgeType(command.status)">
                      {{ statusLabel(command.status) }}
                    </z-badge>
                    @if (isRunning(command)) {
                      <button z-button zType="ghost" zSize="sm" type="button" (click)="open(command)">
                        Open
                      </button>
                      <button
                        z-button
                        zType="destructive"
                        zSize="sm"
                        type="button"
                        [zLoading]="isTerminating(command)"
                        (click)="terminateMutation.mutate(command.id!)"
                      >
                        Terminate
                      </button>
                    } @else {
                      <button
                        z-button
                        zType="secondary"
                        zSize="sm"
                        type="button"
                        (click)="toggleLog(command)"
                      >
                        {{ expandedLogCommandId() === command.id ? 'Hide log' : 'Log' }}
                      </button>
                    }
                  </div>
                  @if (expandedLogCommandId() === command.id) {
                    <app-command-log [commandId]="command.id!" />
                  }
                </li>
              }
            </ul>
          }
        }
      </section>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkspaceActionsComponent {
  readonly repoId = input.required<string>();
  readonly workspaceId = input.required<string>();

  private readonly actionsService = inject(RepositoryActionsControllerService);
  private readonly commandService = inject(CommandControllerService);
  private readonly queryClient = inject(QueryClient);
  private readonly router = inject(Router);

  readonly actionsQuery = injectQuery(() => ({
    queryKey: ['repository-actions', this.repoId()],
    queryFn: () =>
      lastValueFrom(this.actionsService.apiRepositoriesRepositoryIdActionsGet(this.repoId())).then(
        (r) =>
          r.entries?.map((e) => e.action).filter((a): a is ActionConfigurationDto => !!a) ?? [],
      ),
  }));

  // Under the ['commands'] prefix so the SSE `commands` hint (and every sibling surface's
  // invalidation) refreshes it — this tab must never poll.
  readonly commandsQuery = injectQuery(() => ({
    queryKey: ['commands', this.repoId(), this.workspaceId()],
    queryFn: () =>
      lastValueFrom(
        this.commandService.apiCommandsGet(this.repoId(), undefined, this.workspaceId()),
      ).then((r) => r.entries?.map((e) => e.command!).filter((c): c is CommandDto => !!c) ?? []),
  }));

  readonly launchMutation = injectMutation(() => ({
    mutationFn: (action: ActionConfigurationDto) =>
      lastValueFrom(
        this.commandService.apiCommandsPost({
          repoId: this.repoId(),
          workspaceId: this.workspaceId(),
          actionId: action.id!,
        }),
      ),
    onSuccess: (res, action) => {
      this.queryClient.invalidateQueries({ queryKey: ['commands'] });
      // Interactive runs live on the command terminal page; non-interactive ones surface in the
      // run history below (the same split the Command/websocket level enforces).
      if (action.interactive && res.command?.id) {
        this.router.navigate(['/commands', res.command.id]);
      }
    },
  }));

  readonly terminateMutation = injectMutation(() => ({
    mutationFn: (commandId: string) =>
      lastValueFrom(this.commandService.apiCommandsCommandIdTerminatePost(commandId)),
    onSuccess: () => this.queryClient.invalidateQueries({ queryKey: ['commands'] }),
  }));

  /** The finished command whose audit log is expanded inline (one at a time). */
  readonly expandedLogCommandId = signal<string | null>(null);

  isLaunching(action: ActionConfigurationDto): boolean {
    return this.launchMutation.isPending() && this.launchMutation.variables()?.id === action.id;
  }

  isTerminating(command: CommandDto): boolean {
    return this.terminateMutation.isPending() && this.terminateMutation.variables() === command.id;
  }

  isRunning(command: CommandDto): boolean {
    return command.status === CommandStatus.Running;
  }

  toggleLog(command: CommandDto): void {
    this.expandedLogCommandId.update((id) => (id === command.id ? null : (command.id ?? null)));
  }

  open(command: CommandDto): void {
    if (command.id) {
      this.router.navigate(['/commands', command.id]);
    }
  }

  isRepositoryScoped(action: ActionConfigurationDto): boolean {
    return action.scope === ActionScope.Repository;
  }

  commandName(command: CommandDto): string {
    return command.actionName ?? this.kindLabel(command);
  }

  /** Non-terminal runs (chat sessions, daemons) get an origin badge — "what ran here", honestly. */
  showKindBadge(command: CommandDto): boolean {
    return command.kind !== undefined && command.kind !== CommandKind.Terminal;
  }

  kindLabel(command: CommandDto): string {
    switch (command.kind) {
      case CommandKind.Chat:
        return 'chat session';
      case CommandKind.Daemon:
        return 'daemon';
      default:
        return 'terminal';
    }
  }

  badgeType(status: CommandStatus | undefined) {
    return commandStatusBadgeType(status);
  }

  statusLabel(status: CommandStatus | undefined): string {
    return commandStatusLabel(status);
  }
}
