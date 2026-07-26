import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { injectMutation, injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { CommandControllerService } from '@/api/api/commandController.service';
import { WorkspaceActionsControllerService } from '@/api/api/workspaceActionsController.service';
import { ActionOrigin } from '@/api/model/actionOrigin';
import { CommandDto } from '@/api/model/commandDto';
import { CommandKind } from '@/api/model/commandKind';
import { CommandStatus } from '@/api/model/commandStatus';
import { WorkspaceActionDto } from '@/api/model/workspaceActionDto';
import { commandStatusBadgeType, commandStatusLabel } from '@/pattern/command/command-status';
import { CommandLogComponent } from '@/pattern/command/command-log.component';
import { ZardBadgeComponent } from '@/shared/components/badge';
import { ZardButtonComponent } from '@/shared/components/button';

/**
 * The workspace's Actions tab: the workspace action set (global code-based actions plus the actions
 * declared in the committed .qits-config.yml) with one-click launch into THIS workspace, and the
 * workspace's command run history below. Code actions launch through the regular command pipeline
 * (history + re-attach); config actions run fire-and-await through the workspace daemon and show
 * their captured exit code/stdout/stderr inline (no history). One fetch per query on load;
 * freshness after that is push-only — the history key sits under the `['commands']` prefix the
 * page's SSE `commands` hint already invalidates, so nothing here polls. The action list refreshes
 * on the usual mutation invalidations (definitions change rarely, and never from this tab).
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
              No actions configured — define global ones under Action Configurations or declare them
              in the repository's qits config (.config/qits/repository.yml).
            </p>
          } @else {
            <ul class="flex flex-col divide-y rounded-md border">
              @for (action of actions; track action.id) {
                <li class="flex flex-col gap-2 px-3 py-2">
                  <div class="flex flex-wrap items-center gap-3">
                    <div class="flex min-w-0 flex-1 flex-col">
                      <span class="truncate font-medium">{{ action.name }}</span>
                      @if (action.description) {
                        <span class="truncate text-xs text-muted-foreground">
                          {{ action.description }}
                        </span>
                      }
                    </div>
                    <z-badge [zType]="isConfigAction(action) ? 'outline' : 'secondary'">
                      {{ isConfigAction(action) ? 'config' : 'code' }}
                    </z-badge>
                    @if (action.interactive) {
                      <z-badge zType="default">interactive</z-badge>
                    }
                    <button
                      z-button
                      zSize="sm"
                      type="button"
                      [zLoading]="isLaunching(action)"
                      [zDisabled]="action.runnable === false"
                      [title]="
                        action.runnable === false
                          ? 'Interactive config actions cannot be run from here'
                          : ''
                      "
                      (click)="run(action)"
                    >
                      Run
                    </button>
                  </div>
                  @if (expandedResultActionId() === action.id) {
                    @if (configRunResults()[action.id!]; as result) {
                      <div class="flex flex-col gap-1 rounded-md border bg-muted/40 px-3 py-2">
                        <div class="flex items-center gap-2 text-xs">
                          <span
                            class="font-medium"
                            [class.text-destructive]="(result.exitCode ?? 1) !== 0"
                          >
                            {{ result.error ?? 'exit ' + result.exitCode }}
                          </span>
                          <button
                            z-button
                            zType="ghost"
                            zSize="sm"
                            type="button"
                            (click)="expandedResultActionId.set(null)"
                          >
                            Hide
                          </button>
                        </div>
                        @if (result.stdout) {
                          <pre class="max-h-64 overflow-auto text-xs">{{ result.stdout }}</pre>
                        }
                        @if (result.stderr) {
                          <pre
                            class="max-h-64 overflow-auto text-xs text-destructive"
                          >{{ result.stderr }}</pre>
                        }
                      </div>
                    }
                  }
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

  private readonly actionsService = inject(WorkspaceActionsControllerService);
  private readonly commandService = inject(CommandControllerService);
  private readonly queryClient = inject(QueryClient);
  private readonly router = inject(Router);

  readonly actionsQuery = injectQuery(() => ({
    queryKey: ['workspace-actions', this.repoId(), this.workspaceId()],
    queryFn: () =>
      lastValueFrom(
        this.actionsService.apiRepositoriesRepoIdWorkspacesWorkspaceIdActionsGet(
          this.repoId(),
          this.workspaceId(),
        ),
      ).then((r) => r.actions?.filter((a): a is WorkspaceActionDto => !!a) ?? []),
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
    mutationFn: (action: WorkspaceActionDto) =>
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

  /** Result of a fire-and-await config-action run (no Command history), keyed by action id. */
  readonly configRunResults = signal<
    Record<string, { exitCode?: number; stdout?: string; stderr?: string; error?: string }>
  >({});

  /** The action whose inline run result is expanded (one at a time; set on each finished run). */
  readonly expandedResultActionId = signal<string | null>(null);

  readonly runConfigMutation = injectMutation(() => ({
    mutationFn: (action: WorkspaceActionDto) =>
      lastValueFrom(
        this.actionsService.apiRepositoriesRepoIdWorkspacesWorkspaceIdActionsActionIdRunPost(
          action.id!,
          this.repoId(),
          this.workspaceId(),
        ),
      ).then((result) => ({ action, result })),
    onSuccess: ({ action, result }) => {
      this.configRunResults.update((results) => ({ ...results, [action.id!]: result }));
      this.expandedResultActionId.set(action.id ?? null);
    },
    onError: (error, action) => {
      this.configRunResults.update((results) => ({
        ...results,
        [action.id!]: { error: this.errorMessage(error) },
      }));
      this.expandedResultActionId.set(action.id ?? null);
    },
  }));

  readonly terminateMutation = injectMutation(() => ({
    mutationFn: (commandId: string) =>
      lastValueFrom(this.commandService.apiCommandsCommandIdTerminatePost(commandId)),
    onSuccess: () => this.queryClient.invalidateQueries({ queryKey: ['commands'] }),
  }));

  /** The finished command whose audit log is expanded inline (one at a time). */
  readonly expandedLogCommandId = signal<string | null>(null);

  isLaunching(action: WorkspaceActionDto): boolean {
    return (
      (this.launchMutation.isPending() && this.launchMutation.variables()?.id === action.id) ||
      (this.runConfigMutation.isPending() && this.runConfigMutation.variables()?.id === action.id)
    );
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

  isConfigAction(action: WorkspaceActionDto): boolean {
    return action.origin === ActionOrigin.Config;
  }

  /** CODE actions go through the command pipeline; CONFIG actions run fire-and-await via the daemon. */
  run(action: WorkspaceActionDto): void {
    if (this.isConfigAction(action)) {
      this.runConfigMutation.mutate(action);
    } else {
      this.launchMutation.mutate(action);
    }
  }

  /** A human-readable message from a failed config run: the backend {@code {message}} body, or fallback. */
  private errorMessage(error: unknown): string {
    const httpError = error as { error?: unknown; message?: string } | null;
    const body = httpError?.error;
    if (typeof body === 'string' && body.trim()) return body;
    if (body && typeof body === 'object') {
      const message = (body as { message?: unknown }).message;
      if (typeof message === 'string' && message.trim()) return message;
    }
    return httpError?.message ?? 'Failed to run the action';
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
