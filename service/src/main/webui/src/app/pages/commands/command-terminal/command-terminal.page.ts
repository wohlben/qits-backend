import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { CommandControllerService } from '@/api/api/commandController.service';
import { PageLayoutComponent } from '@/layout/page-layout/page-layout.component';
import { WebTerminalComponent } from '@/pattern/repository/web-terminal.component';
import { ZardButtonComponent } from '@/shared/components/button';

/**
 * The terminal for a single registry command: re-attaches to the running process (replaying its
 * scrollback) and shows where it came from — its action, branch and the commit that was checked out
 * at launch. Reached both right after launching an action and by re-opening a running command, so
 * navigating here is "picking back up where you left off".
 */
@Component({
  selector: 'app-command-terminal-page',
  imports: [PageLayoutComponent, WebTerminalComponent, ZardButtonComponent, RouterLink],
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

      <app-web-terminal [commandId]="commandId" />
    </app-page-layout>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommandTerminalPage {
  private readonly route = inject(ActivatedRoute);
  private readonly commandService = inject(CommandControllerService);

  readonly commandId = this.route.snapshot.paramMap.get('commandId')!;

  readonly commandQuery = injectQuery(() => ({
    queryKey: ['command', this.commandId],
    queryFn: () =>
      lastValueFrom(this.commandService.apiCommandsCommandIdGet(this.commandId)).then(
        (r) => r.command ?? null,
      ),
  }));
}
