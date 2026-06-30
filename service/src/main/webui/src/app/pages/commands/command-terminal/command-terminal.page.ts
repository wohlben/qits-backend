import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { CommandControllerService } from '@/api/api/commandController.service';
import { CommandStatus } from '@/api/model/commandStatus';
import { PageLayoutComponent } from '@/layout/page-layout/page-layout.component';
import { CommandLogComponent } from '@/pattern/command/command-log.component';
import { WebTerminalComponent } from '@/pattern/repository/web-terminal.component';
import { ZardButtonComponent } from '@/shared/components/button';

/**
 * The view for a single registry command. A running command re-attaches to its live process
 * (replaying scrollback) so navigating here is "picking back up where you left off"; a finished
 * command shows its read-only captured log instead. Either way the header shows where it came from —
 * the action, branch and the commit checked out at launch.
 */
@Component({
  selector: 'app-command-terminal-page',
  imports: [
    PageLayoutComponent,
    WebTerminalComponent,
    CommandLogComponent,
    ZardButtonComponent,
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

      <div pageActions>
        @let repoId = commandQuery.data()?.repoId;
        @if (repoId) {
          <a z-button zType="secondary" [routerLink]="['/repositories', repoId]">Back to repository</a>
        }
      </div>

      @if (commandQuery.data(); as command) {
        @if (command.status === CommandStatus.Running) {
          <app-web-terminal [commandId]="commandId" />
        } @else {
          <app-command-log [commandId]="commandId" />
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
  private readonly commandService = inject(CommandControllerService);

  protected readonly CommandStatus = CommandStatus;

  readonly commandId = this.route.snapshot.paramMap.get('commandId')!;

  readonly commandQuery = injectQuery(() => ({
    queryKey: ['command', this.commandId],
    queryFn: () =>
      lastValueFrom(this.commandService.apiCommandsCommandIdGet(this.commandId)).then(
        (r) => r.command ?? null,
      ),
  }));
}
