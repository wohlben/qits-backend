import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { injectMutation, injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { WorkspaceDaemonControllerService } from '@/api/api/workspaceDaemonController.service';
import { DaemonInstanceDto } from '@/api/model/daemonInstanceDto';
import { DaemonStatus } from '@/api/model/daemonStatus';
import { DaemonTerminalComponent } from '@/pattern/daemon/daemon-terminal.component';
import { ZardButtonComponent } from '@/shared/components/button';
import { DaemonHealthChecksComponent } from '@/ui/components/daemon/daemon-health-checks.component';
import { DaemonStatusChipComponent } from '@/ui/components/daemon/daemon-status-chip.component';

/**
 * The workspace's daemons panel: every effective daemon (running or not — the everything-visible
 * convention) with its supervised status chip, start/stop, and a logs link re-attaching to the
 * instance's registry command. The events feed ({@link WorkspaceDaemonEventsComponent}) renders
 * below this panel in the same Daemons tab; this panel's mutations still invalidate its query key.
 */
@Component({
  selector: 'app-workspace-daemons',
  imports: [
    RouterLink,
    ZardButtonComponent,
    DaemonHealthChecksComponent,
    DaemonStatusChipComponent,
    DaemonTerminalComponent,
  ],
  template: `
    <section class="flex flex-col gap-3" aria-label="Daemons">
      <h2 class="text-lg font-semibold">Daemons</h2>

      @if (daemonsQuery.isPending()) {
        <div class="text-sm text-muted-foreground">Loading daemons…</div>
      } @else if (daemonsQuery.isError()) {
        <div class="text-sm text-destructive">Failed to load daemons</div>
      } @else {
        @let instances = daemonsQuery.data() ?? [];
        @if (instances.length === 0) {
          <p class="text-sm text-muted-foreground">
            No daemons defined for this repository.
          </p>
        } @else {
          <ul class="flex flex-col divide-y rounded-md border">
            @for (instance of instances; track instance.daemon?.id) {
              <li class="flex flex-wrap items-center gap-3 px-3 py-2">
                <div class="flex min-w-0 flex-1 flex-col">
                  <span class="truncate font-medium">{{ instance.daemon?.name }}</span>
                  @if (instance.daemon?.description) {
                    <span class="truncate text-xs text-muted-foreground">
                      {{ instance.daemon?.description }}
                    </span>
                  }
                </div>
                <app-daemon-status-chip
                  [status]="instance.status ?? 'STOPPED'"
                  [restartCount]="instance.restartCount ?? 0"
                />
                @if (instance.health?.length) {
                  <app-daemon-health-checks [health]="instance.health!" />
                }
                @if (instance.commandId) {
                  <a
                    z-button
                    zType="ghost"
                    zSize="sm"
                    [routerLink]="['/commands', instance.commandId]"
                  >
                    Logs
                  </a>
                }
                @if (isLive(instance)) {
                  <app-daemon-terminal
                    [repoId]="repoId()"
                    [workspaceId]="workspaceId()"
                    [daemonId]="instance.daemon!.id!"
                    [name]="instance.daemon!.name!"
                  />
                  <button
                    z-button
                    zType="secondary"
                    zSize="sm"
                    type="button"
                    [zLoading]="stopMutation.isPending()"
                    (click)="stopMutation.mutate(instance.daemon!.id!)"
                  >
                    Stop
                  </button>
                } @else {
                  <button
                    z-button
                    zSize="sm"
                    type="button"
                    [zLoading]="startMutation.isPending()"
                    (click)="startMutation.mutate(instance.daemon!.id!)"
                  >
                    Start
                  </button>
                }
              </li>
            }
          </ul>
        }
      }
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkspaceDaemonsComponent {
  readonly repoId = input.required<string>();
  readonly workspaceId = input.required<string>();

  private readonly daemonService = inject(WorkspaceDaemonControllerService);
  private readonly queryClient = inject(QueryClient);

  readonly daemonsQuery = injectQuery(() => ({
    queryKey: ['workspace-daemons', this.repoId(), this.workspaceId()],
    queryFn: () =>
      lastValueFrom(
        this.daemonService.apiRepositoriesRepoIdWorkspacesWorkspaceIdDaemonsGet(
          this.repoId(),
          this.workspaceId(),
        ),
      ).then(
        (r) =>
          r.entries
            ?.map((e) => e.instance)
            .filter((i): i is DaemonInstanceDto => !!i) ?? [],
      ),
  }));

  readonly startMutation = injectMutation(() => ({
    mutationFn: (daemonId: string) =>
      lastValueFrom(
        // NB: the generated client orders path params alphabetically (daemonId, repoId, workspaceId),
        // not in path order — pass them in that order or the URL segments get scrambled (404).
        this.daemonService.apiRepositoriesRepoIdWorkspacesWorkspaceIdDaemonsDaemonIdStartPost(
          daemonId,
          this.repoId(),
          this.workspaceId(),
        ),
      ),
    onSettled: () => this.invalidate(),
  }));

  readonly stopMutation = injectMutation(() => ({
    mutationFn: (daemonId: string) =>
      lastValueFrom(
        this.daemonService.apiRepositoriesRepoIdWorkspacesWorkspaceIdDaemonsDaemonIdStopPost(
          daemonId,
          this.repoId(),
          this.workspaceId(),
        ),
      ),
    onSettled: () => this.invalidate(),
  }));

  isLive(instance: DaemonInstanceDto): boolean {
    return (
      instance.status === DaemonStatus.Starting ||
      instance.status === DaemonStatus.Ready ||
      instance.status === DaemonStatus.Degraded ||
      instance.status === DaemonStatus.Restarting
    );
  }

  private invalidate() {
    this.queryClient.invalidateQueries({
      queryKey: ['workspace-daemons', this.repoId(), this.workspaceId()],
    });
    this.queryClient.invalidateQueries({
      queryKey: ['workspace-daemon-events', this.repoId(), this.workspaceId()],
    });
  }
}
