import { ChangeDetectionStrategy, Component } from '@angular/core';

import { PageLayoutComponent } from '@/layout/page-layout/page-layout.component';
import { SettingsComponent } from '@/pattern/settings/settings.component';

@Component({
  selector: 'app-settings-page',
  imports: [PageLayoutComponent, SettingsComponent],
  template: `
    <app-page-layout [hasActions]="false">
      <div pageTitle>
        <h1 class="text-2xl font-bold">Settings</h1>
        <p class="text-sm text-muted-foreground">Configure defaults for this qits instance</p>
      </div>

      <app-settings />
    </app-page-layout>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsPage {}
