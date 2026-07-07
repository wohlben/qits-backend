import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { injectMutation, injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { WorkspaceControllerService } from '@/api/api/workspaceController.service';
import { WorkspaceDaemonControllerService } from '@/api/api/workspaceDaemonController.service';
import { DaemonInstanceDto } from '@/api/model/daemonInstanceDto';
import { DaemonStatus } from '@/api/model/daemonStatus';
import { DaemonTerminalComponent } from '@/pattern/daemon/daemon-terminal.component';
import { invalidateRepository } from '@/pattern/repository/invalidate-repository';
import { ZardButtonComponent } from '@/shared/components/button';
import { DaemonStatusChipComponent } from '@/ui/components/daemon/daemon-status-chip.component';

/**
 * The workspace's daemons panel: every effective daemon (running or not — the everything-visible
 * convention) with its supervised status chip, start/stop, and a logs link re-attaching to the
 * instance's registry command. The events feed lives in its own Events tab
 * ({@link WorkspaceDaemonEventsComponent}); this panel's mutations still invalidate its query key.
 */
@Component({
  selector: 'app-workspace-daemons',
  imports: [
    RouterLink,
    ZardButtonComponent,
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
                @if (instance.needsContainerRecreate) {
                  <!-- The container publishes web-view ports only at creation, so a port declared
                       after it existed needs a recreation — the one live constraint of the
                       web-view config, surfaced as an action instead of a 502 in the frame. -->
                  <div
                    class="flex w-full flex-wrap items-center gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-700 dark:text-amber-400"
                  >
                    <span class="min-w-0 flex-1">
                      Web view unavailable: this container does not publish port
                      :{{ instance.daemon?.webView?.port }}. Recreating the container stops all of
                      this workspace's running processes; start the daemon again afterwards.
                    </span>
                    <button
                      z-button
                      zType="secondary"
                      zSize="sm"
                      type="button"
                      [zLoading]="recreateContainerMutation.isPending()"
                      (click)="recreateContainerMutation.mutate()"
                    >
                      Recreate container
                    </button>
                  </div>
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
  private readonly workspaceService = inject(WorkspaceControllerService);
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
    refetchInterval: 3000,
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

  /**
   * Remove-and-reprovision the workspace container so it publishes newly-declared web-view ports
   * (publishing is container-create-time only). Stop pushes the branch first, so no work is lost;
   * running daemons die with the container and must be started again.
   */
  readonly recreateContainerMutation = injectMutation(() => ({
    mutationFn: async () => {
      await lastValueFrom(
        this.workspaceService.apiRepositoriesRepoIdWorkspacesWorkspaceIdStopContainerPost(
          this.repoId(),
          this.workspaceId(),
        ),
      );
      return lastValueFrom(
        this.workspaceService.apiRepositoriesRepoIdWorkspacesWorkspaceIdEnsureContainerPost(
          this.repoId(),
          this.workspaceId(),
        ),
      );
    },
    onSettled: async () => {
      this.invalidate();
      await invalidateRepository(this.queryClient, this.repoId());
    },
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
