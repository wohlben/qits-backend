import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

@Component({
  selector: 'app-main-navigation',
  imports: [RouterLink, RouterLinkActive],
  template: `
    <nav aria-label="Main navigation">
      <ul class="flex flex-col gap-1">
        <li>
          <a
            routerLink="/"
            routerLinkActive="bg-accent text-accent-foreground"
            [routerLinkActiveOptions]="{ exact: true }"
            class="flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            Home
          </a>
        </li>
        <li>
          <a
            routerLink="/projects"
            routerLinkActive="bg-accent text-accent-foreground"
            class="flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            Projects
          </a>
        </li>
        <li>
          <a
            routerLink="/feature-flows"
            routerLinkActive="bg-accent text-accent-foreground"
            class="flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            Feature Flows
          </a>
        </li>
      </ul>
    </nav>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MainNavigationComponent {}
