import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

import { PageLayoutComponent } from '@/layout/page-layout/page-layout.component';
import { DaemonConfigurationListComponent } from '@/pattern/daemon-configuration/daemon-configuration-list.component';
import { ZardButtonComponent } from '@/shared/components/button';

@Component({
  selector: 'app-daemon-configuration-list-page',
  imports: [PageLayoutComponent, DaemonConfigurationListComponent, RouterLink, ZardButtonComponent],
  template: `
    <app-page-layout>
      <div pageTitle>
        <h1 class="text-2xl font-bold">Daemons</h1>
        <p class="text-sm text-muted-foreground">
          Managed long-running processes (dev servers, watchers) worktrees can run
        </p>
      </div>
      <div pageActions>
        <a z-button routerLink="/daemon-configurations/new">New Daemon</a>
      </div>
      <app-daemon-configuration-list />
    </app-page-layout>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DaemonConfigurationListPage {}
