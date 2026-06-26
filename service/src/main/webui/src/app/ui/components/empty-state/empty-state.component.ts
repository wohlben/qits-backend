import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-empty-state',
  template: `
    <div class="flex flex-col items-center justify-center gap-2 py-12 text-center">
      <div class="text-muted-foreground">
        <ng-content select="[icon]" />
      </div>
      <h3 class="text-lg font-semibold"><ng-content select="[title]" /></h3>
      <p class="text-sm text-muted-foreground max-w-sm"><ng-content select="[description]" /></p>
      <div class="mt-2"><ng-content select="[action]" /></div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EmptyStateComponent {}
