import { ChangeDetectionStrategy, Component } from '@angular/core';

import { PageLayoutComponent } from '@/layout/page-layout/page-layout.component';

@Component({
  selector: 'app-home-page',
  imports: [PageLayoutComponent],
  template: `
    <app-page-layout [hasActions]="false">
      <div pageTitle>
        <h1 class="text-2xl font-bold">Home</h1>
        <p class="text-sm text-muted-foreground">Welcome to QITS.</p>
      </div>

      <p>Dashboard content goes here.</p>
    </app-page-layout>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomePage {}
