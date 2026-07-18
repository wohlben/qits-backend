import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { RepositoryDaemonDto } from '@/api/model/repositoryDaemonDto';
import { CardLayoutComponent } from '@/layout/card-layout/card-layout.component';
import { configBaseName, isConfigManaged } from '@/shared/utils/config-origin';

@Component({
  selector: 'app-repository-daemon-card',
  imports: [RouterLink, CardLayoutComponent],
  template: `
    <app-card-layout [hasActions]="false">
      <!-- Config-managed daemons are read-only in the UI (edit the committed .qits-config.yml
           instead), so they render their name as plain text rather than an edit link. -->
      @if (isConfig()) {
        <div cardTitle class="flex items-center gap-2">
          <h3 class="font-semibold">{{ displayName() }}</h3>
          <span
            class="inline-flex w-fit items-center rounded-full border border-amber-500/40 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-700 dark:text-amber-400"
          >
            .qits-config
          </span>
        </div>
      } @else {
        <a
          cardTitle
          [routerLink]="['/repositories', daemon().repositoryId, 'daemons', daemon().id, 'edit']"
          class="hover:underline"
        >
          <h3 class="font-semibold">{{ displayName() }}</h3>
        </a>
      }

      <p class="text-sm text-muted-foreground line-clamp-2">{{ daemon().description }}</p>
      @if (daemon().autoStart) {
        <span
          class="mt-1 inline-flex w-fit items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
        >
          auto-start
        </span>
      }
      <p class="mt-1 text-xs text-muted-foreground">
        {{ daemon().restartPolicy }} · {{ daemon().observers?.length ?? 0 }} observer(s)
        @if (daemon().healthChecks?.length; as checkCount) {
          · {{ checkCount }} health check(s)
        }
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

  readonly isConfig = computed(() => isConfigManaged(this.daemon().origin, this.daemon().name));
  readonly displayName = computed(() => configBaseName(this.daemon().name));
}
