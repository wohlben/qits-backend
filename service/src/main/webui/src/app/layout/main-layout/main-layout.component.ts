import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { LayoutImports } from '@/shared/components/layout';
import { MainNavigationComponent } from '../main-navigation/main-navigation.component';

@Component({
  selector: 'app-main-layout',
  imports: [...LayoutImports, RouterOutlet, MainNavigationComponent],
  template: `
    <z-layout>
      <z-sidebar zCollapsible [zWidth]="240" [zCollapsedWidth]="64">
        <div class="flex h-full flex-col gap-4 p-4">
          <div class="flex items-center gap-2 px-2 text-lg font-semibold">
            <span class="truncate">QITS</span>
          </div>

          <app-main-navigation />
        </div>
      </z-sidebar>

      <z-content class="flex flex-col">
        <main class="flex-1 p-6">
          <router-outlet />
        </main>
      </z-content>
    </z-layout>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MainLayoutComponent {}
