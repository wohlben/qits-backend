import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { injectMutation, injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { WorkspaceServiceControllerService } from '@/api/api/workspaceServiceController.service';
import { ServiceInstanceDto } from '@/api/model/serviceInstanceDto';
import { ServiceStatus } from '@/api/model/serviceStatus';
import { ServiceTerminalComponent } from '@/pattern/service/service-terminal.component';
import { ZardButtonComponent } from '@/shared/components/button';
import { ServiceHealthChecksComponent } from '@/ui/components/daemon/service-health-checks.component';
import { ServiceStatusChipComponent } from '@/ui/components/daemon/service-status-chip.component';

/**
 * The workspace's services panel: every effective service (running or not — the everything-visible
 * convention) with its supervised status chip, start/stop, and a logs link re-attaching to the
 * instance's registry command. The events feed ({@link WorkspaceServiceEventsComponent}) renders
 * below this panel in the same Services tab; this panel's mutations still invalidate its query key.
 */
@Component({
  selector: 'app-workspace-services',
  imports: [
    RouterLink,
    ZardButtonComponent,
    ServiceHealthChecksComponent,
    ServiceStatusChipComponent,
    ServiceTerminalComponent,
  ],
  template: `
    <section class="flex flex-col gap-3" aria-label="Services">
      <h2 class="text-lg font-semibold">Services</h2>

      @if (servicesQuery.isPending()) {
        <div class="text-sm text-muted-foreground">Loading services…</div>
      } @else if (servicesQuery.isError()) {
        <div class="text-sm text-destructive">Failed to load services</div>
      } @else {
        @let instances = servicesQuery.data() ?? [];
        @if (instances.length === 0) {
          <p class="text-sm text-muted-foreground">
            No services declared in this repository's .qits-config.yml.
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
                <app-service-status-chip
                  [status]="instance.status ?? 'STOPPED'"
                  [restartCount]="instance.restartCount ?? 0"
                />
                @if (instance.health?.length) {
                  <app-service-health-checks [health]="instance.health!" />
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
                  <app-service-terminal
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
export class WorkspaceServicesComponent {
  readonly repoId = input.required<string>();
  readonly workspaceId = input.required<string>();

  private readonly serviceApi = inject(WorkspaceServiceControllerService);
  private readonly queryClient = inject(QueryClient);

  readonly servicesQuery = injectQuery(() => ({
    queryKey: ['workspace-services', this.repoId(), this.workspaceId()],
    queryFn: () =>
      lastValueFrom(
        this.serviceApi.apiRepositoriesRepoIdWorkspacesWorkspaceIdServicesGet(
          this.repoId(),
          this.workspaceId(),
        ),
      ).then(
        (r) =>
          r.entries
            ?.map((e) => e.instance)
            .filter((i): i is ServiceInstanceDto => !!i) ?? [],
      ),
  }));

  readonly startMutation = injectMutation(() => ({
    mutationFn: (daemonId: string) =>
      lastValueFrom(
        // NB: the generated client orders path params alphabetically (daemonId, repoId, workspaceId),
        // not in path order — pass them in that order or the URL segments get scrambled (404).
        this.serviceApi.apiRepositoriesRepoIdWorkspacesWorkspaceIdServicesDaemonIdStartPost(
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
        this.serviceApi.apiRepositoriesRepoIdWorkspacesWorkspaceIdServicesDaemonIdStopPost(
          daemonId,
          this.repoId(),
          this.workspaceId(),
        ),
      ),
    onSettled: () => this.invalidate(),
  }));

  isLive(instance: ServiceInstanceDto): boolean {
    return (
      instance.status === ServiceStatus.Starting ||
      instance.status === ServiceStatus.Ready ||
      instance.status === ServiceStatus.Restarting
    );
  }

  private invalidate() {
    this.queryClient.invalidateQueries({
      queryKey: ['workspace-services', this.repoId(), this.workspaceId()],
    });
    this.queryClient.invalidateQueries({
      queryKey: ['workspace-service-events', this.repoId(), this.workspaceId()],
    });
  }
}
