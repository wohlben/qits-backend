import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { RepositoryDaemonControllerService } from '@/api/api/repositoryDaemonController.service';
import { RepositoryDaemonCardComponent } from '@/ui/components/daemon/repository-daemon-card.component';
import { EmptyStateComponent } from '@/ui/components/empty-state/empty-state.component';

@Component({
  selector: 'app-repository-daemon-list',
  imports: [RepositoryDaemonCardComponent, EmptyStateComponent],
  template: `
    @if (daemonsQuery.isPending()) {
      <div class="py-12 text-center text-muted-foreground">Loading daemons…</div>
    } @else if (daemonsQuery.isError()) {
      <div class="py-12 text-center text-destructive">Failed to load daemons</div>
    } @else {
      @let daemons = daemonsQuery.data() ?? [];
      @if (daemons.length === 0) {
        <app-empty-state>
          <span title>No daemons yet</span>
          <span description>
            Define this repository's first long-running process (e.g. its dev server)
          </span>
        </app-empty-state>
      } @else {
        <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          @for (daemon of daemons; track daemon.id) {
            <app-repository-daemon-card [daemon]="daemon" />
          }
        </div>
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RepositoryDaemonListComponent {
  readonly repoId = input.required<string>();

  private readonly daemonService = inject(RepositoryDaemonControllerService);

  readonly daemonsQuery = injectQuery(() => ({
    queryKey: ['repository-daemons', this.repoId()],
    queryFn: () =>
      lastValueFrom(this.daemonService.apiRepositoriesRepositoryIdDaemonsGet(this.repoId())).then(
        (r) =>
          r.entries?.map((e) => e.daemon).filter((d): d is NonNullable<typeof d> => !!d) ?? [],
      ),
  }));
}
