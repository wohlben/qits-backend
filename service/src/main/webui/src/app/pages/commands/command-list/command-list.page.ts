import { ChangeDetectionStrategy, Component } from '@angular/core';

import { PageLayoutComponent } from '@/layout/page-layout/page-layout.component';
import { CommandsListComponent } from '@/pattern/command/commands-list.component';

@Component({
  selector: 'app-command-list-page',
  imports: [PageLayoutComponent, CommandsListComponent],
  template: `
    <app-page-layout>
      <div pageTitle>
        <h1 class="text-2xl font-bold">Commands</h1>
        <p class="text-sm text-muted-foreground">
          Processes running in your worktrees — re-open one to pick up where you left off, or
          terminate it.
        </p>
      </div>
      <app-commands-list />
    </app-page-layout>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommandListPage {}
