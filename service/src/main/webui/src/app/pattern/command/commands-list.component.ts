import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { Router } from '@angular/router';
import { injectMutation, injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { CommandControllerService } from '@/api/api/commandController.service';
import { CommandDto } from '@/api/model/commandDto';
import { CommandStatus } from '@/api/model/commandStatus';
import { CardLayoutComponent } from '@/layout/card-layout/card-layout.component';
import { ZardBadgeComponent } from '@/shared/components/badge';
import { ZardBadgeTypeVariants } from '@/shared/components/badge';
import { ZardButtonComponent } from '@/shared/components/button';
import { EmptyStateComponent } from '@/ui/components/empty-state/empty-state.component';

/**
 * The Commands list: what's currently active and where it came from. Running commands can be
 * re-opened (re-attaching to the live process, replaying its scrollback) or terminated; finished
 * commands are shown as history (the log view arrives in Phase 3). The query polls so a command that
 * exits on its own moves from Running to History without a manual refresh.
 */
@Component({
  selector: 'app-commands-list',
  imports: [
    DatePipe,
    NgTemplateOutlet,
    CardLayoutComponent,
    ZardBadgeComponent,
    ZardButtonComponent,
    EmptyStateComponent,
  ],
  template: `
    @if (commandsQuery.isPending()) {
      <div class="py-12 text-center text-muted-foreground">Loading commands…</div>
    } @else if (commandsQuery.isError()) {
      <div class="py-12 text-center text-destructive">Failed to load commands</div>
    } @else if ((commandsQuery.data() ?? []).length === 0) {
      <app-empty-state>
        <span title>No commands yet</span>
        <span description>Run an action in a workspace and it will show up here.</span>
      </app-empty-state>
    } @else {
      @if (running().length) {
        <section class="flex flex-col gap-3">
          <h2 class="text-sm font-semibold text-muted-foreground">Running</h2>
          <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            @for (command of running(); track command.id) {
              <app-card-layout [hasActions]="true">
                <div cardTitle class="flex items-center gap-2">
                  <h3 class="font-semibold">{{ command.actionName }}</h3>
                  <z-badge [zType]="badgeType(command.status)">{{ statusLabel(command.status) }}</z-badge>
                </div>
                <div cardActions class="flex gap-2">
                  <button z-button (click)="open(command)">Open</button>
                  <button
                    z-button
                    zType="destructive"
                    [zLoading]="isTerminating(command)"
                    (click)="terminate(command)"
                  >
                    Terminate
                  </button>
                </div>
                <ng-container [ngTemplateOutlet]="meta" [ngTemplateOutletContext]="{ $implicit: command }" />
              </app-card-layout>
            }
          </div>
        </section>
      }

      @if (finished().length) {
        <section class="mt-6 flex flex-col gap-3">
          <h2 class="text-sm font-semibold text-muted-foreground">History</h2>
          <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            @for (command of finished(); track command.id) {
              <app-card-layout [hasActions]="true">
                <div cardTitle class="flex items-center gap-2">
                  <h3 class="font-semibold">{{ command.actionName }}</h3>
                  <z-badge [zType]="badgeType(command.status)">{{ statusLabel(command.status) }}</z-badge>
                </div>
                <div cardActions>
                  <button z-button zType="secondary" (click)="open(command)">View log</button>
                </div>
                <ng-container [ngTemplateOutlet]="meta" [ngTemplateOutletContext]="{ $implicit: command }" />
              </app-card-layout>
            }
          </div>
        </section>
      }
    }

    <!-- Where the command came from: branch/workspace, the commit checked out at launch, and when. -->
    <ng-template #meta let-command>
      <dl class="mt-1 flex flex-col gap-0.5 text-sm text-muted-foreground">
        <div class="flex gap-2">
          <span class="font-mono">{{ command.branch }}</span>
          <span>·</span>
          <span class="font-mono text-xs">{{ command.shortCommitHash }}</span>
        </div>
        <div class="text-xs">workspace {{ command.workspaceId }}</div>
        <div class="text-xs">{{ command.launchedAt | date: 'short' }}</div>
        @if (command.exitCode !== undefined && command.exitCode !== null) {
          <div class="text-xs">exit {{ command.exitCode }}</div>
        }
      </dl>
    </ng-template>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommandsListComponent {
  private readonly commandService = inject(CommandControllerService);
  private readonly queryClient = inject(QueryClient);
  private readonly router = inject(Router);

  readonly commandsQuery = injectQuery(() => ({
    queryKey: ['commands'],
    // Poll so a self-exiting command moves from Running to History on its own.
    refetchInterval: 5000,
    queryFn: () =>
      lastValueFrom(this.commandService.apiCommandsGet()).then(
        (r) => r.entries?.map((e) => e.command!).filter((c): c is CommandDto => !!c) ?? [],
      ),
  }));

  readonly running = computed(() =>
    (this.commandsQuery.data() ?? []).filter((c) => c.status === CommandStatus.Running),
  );

  readonly finished = computed(() =>
    (this.commandsQuery.data() ?? []).filter((c) => c.status !== CommandStatus.Running),
  );

  readonly terminateMutation = injectMutation(() => ({
    mutationFn: (commandId: string) =>
      lastValueFrom(this.commandService.apiCommandsCommandIdTerminatePost(commandId)),
    onSuccess: () => this.queryClient.invalidateQueries({ queryKey: ['commands'] }),
  }));

  /** Open a command: a running one re-attaches to its live terminal, a finished one shows its log. */
  open(command: CommandDto) {
    if (command.id) {
      this.router.navigate(['/commands', command.id]);
    }
  }

  terminate(command: CommandDto) {
    if (command.id) {
      this.terminateMutation.mutate(command.id);
    }
  }

  isTerminating(command: CommandDto): boolean {
    return this.terminateMutation.isPending() && this.terminateMutation.variables() === command.id;
  }

  badgeType(status: CommandStatus | undefined): ZardBadgeTypeVariants {
    switch (status) {
      case CommandStatus.Running:
        return 'default';
      case CommandStatus.Terminated:
        return 'destructive';
      case CommandStatus.Interrupted:
        return 'outline';
      default:
        return 'secondary';
    }
  }

  statusLabel(status: CommandStatus | undefined): string {
    return status ? status.toLowerCase() : 'unknown';
  }
}
