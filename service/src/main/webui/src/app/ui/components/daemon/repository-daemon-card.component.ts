import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { RepositoryDaemonDto } from '@/api/model/repositoryDaemonDto';
import { CardLayoutComponent } from '@/layout/card-layout/card-layout.component';

@Component({
  selector: 'app-repository-daemon-card',
  imports: [RouterLink, CardLayoutComponent],
  template: `
    <app-card-layout [hasActions]="false">
      <a
        cardTitle
        [routerLink]="['/repositories', daemon().repositoryId, 'daemons', daemon().id, 'edit']"
        class="hover:underline"
      >
        <h3 class="font-semibold">{{ daemon().name }}</h3>
      </a>

      <p class="text-sm text-muted-foreground line-clamp-2">{{ daemon().description }}</p>
      <p class="mt-1 text-xs text-muted-foreground">
        {{ daemon().restartPolicy }} · {{ daemon().observers?.length ?? 0 }} observer(s)
        @if (daemon().webView?.port; as port) {
          · web view :{{ port
          }}@if (daemon().webView?.entryPath; as entryPath) {
            → /{{ entryPath }}
          }
        }
      </p>
    </app-card-layout>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RepositoryDaemonCardComponent {
  readonly daemon = input.required<RepositoryDaemonDto>();
}
