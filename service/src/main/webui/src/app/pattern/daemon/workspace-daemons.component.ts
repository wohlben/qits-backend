import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { injectMutation, injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { DaemonEventControllerService } from '@/api/api/daemonEventController.service';
import { WorkspaceControllerService } from '@/api/api/workspaceController.service';
import { WorkspaceDaemonControllerService } from '@/api/api/workspaceDaemonController.service';
import { DaemonEventDto } from '@/api/model/daemonEventDto';
import { DaemonEventSeverity } from '@/api/model/daemonEventSeverity';
import { DaemonInstanceDto } from '@/api/model/daemonInstanceDto';
import { DaemonStatus } from '@/api/model/daemonStatus';
import { DaemonTerminalComponent } from '@/pattern/daemon/daemon-terminal.component';
import { invalidateRepository } from '@/pattern/repository/invalidate-repository';
import { ZardButtonComponent } from '@/shared/components/button';
import { DaemonStatusChipComponent } from '@/ui/components/daemon/daemon-status-chip.component';

/** An event's "open in source" target for a tailed file: the path plus the anchored line range. */
export interface DaemonEventFileAnchor {
  path: string;
  startLine: number;
  endLine: number;
}

/**
 * The workspace's daemons panel: every effective daemon (running or not — the everything-visible
 * convention) with its supervised status chip, start/stop, and a logs link re-attaching to the
 * instance's registry command; below it, the daemon events feed read from the durable store
 * (severity-colored, each expandable to its log excerpt, with "open in source" jumping to the
 * anchored place in the command log or the tailed file).
 */
@Component({
  selector: 'app-workspace-daemons',
  imports: [
    DatePipe,
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
            No daemons defined. Add one in the global library or for this repository.
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

      @if (recentEvents().length > 0) {
        <div class="flex flex-col gap-1" aria-label="Recent daemon events">
          <h3 class="text-sm font-medium text-muted-foreground">Recent events</h3>
          <ul class="flex flex-col gap-1">
            @for (event of recentEvents(); track $index) {
              <li class="rounded-md border px-3 py-1.5 text-sm">
                <details>
                  <summary class="flex cursor-pointer list-none flex-wrap items-center gap-2">
                    <span class="size-2 rounded-full" [class]="severityDot(event)" aria-hidden="true"></span>
                    <span class="text-xs text-muted-foreground">
                      {{ event.timestamp | date: 'HH:mm:ss' }}
                    </span>
                    <span class="font-medium">{{ event.daemonName }}</span>
                    @if (event.source) {
                      <span class="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                        {{ sourceLabel(event) }}
                      </span>
                    }
                    <span class="min-w-0 flex-1 truncate text-muted-foreground">
                      {{ event.summary }}
                    </span>
                  </summary>
                  @if (event.logExcerpt) {
                    <pre
                      class="mt-2 max-h-64 overflow-auto rounded bg-muted p-2 text-xs whitespace-pre-wrap"
                      >{{ event.logExcerpt }}</pre
                    >
                  } @else {
                    <p class="mt-2 text-xs text-muted-foreground">No log excerpt captured.</p>
                  }
                  @if (isOutputAnchor(event)) {
                    <a
                      z-button
                      zType="ghost"
                      zSize="sm"
                      class="mt-1"
                      [routerLink]="['/commands', event.commandId]"
                      [queryParams]="{ seq: event.anchorFrom, seqTo: event.anchorTo }"
                    >
                      Open in command log
                    </a>
                  } @else if (isFileAnchor(event)) {
                    <button
                      z-button
                      zType="ghost"
                      zSize="sm"
                      class="mt-1"
                      type="button"
                      (click)="emitFileAnchor(event)"
                    >
                      Open {{ event.source }}:{{ event.anchorFrom }}
                    </button>
                  }
                </details>
              </li>
            }
          </ul>
        </div>
      }
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkspaceDaemonsComponent {
  readonly repoId = input.required<string>();
  readonly workspaceId = input.required<string>();
  /** A file event's "open in source" click — the page routes it into the file browser. */
  readonly openFile = output<DaemonEventFileAnchor>();

  private readonly daemonService = inject(WorkspaceDaemonControllerService);
  private readonly eventService = inject(DaemonEventControllerService);
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

  readonly eventsQuery = injectQuery(() => ({
    queryKey: ['workspace-daemon-events', this.repoId(), this.workspaceId()],
    queryFn: () =>
      lastValueFrom(
        // Durable store, newest first: page 0 of 20 is exactly the feed's window.
        this.eventService.apiDaemonEventsGet(
          0,
          20,
          this.repoId(),
          undefined,
          undefined,
          undefined,
          this.workspaceId(),
        ),
      ).then((r) => r.events ?? []),
    refetchInterval: 5000,
  }));

  readonly recentEvents = computed(() => this.eventsQuery.data() ?? []);

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

  sourceLabel(event: DaemonEventDto): string {
    if (event.source === 'output') {
      return 'output';
    }
    return event.anchorFrom != null ? `${event.source}:${event.anchorFrom}` : (event.source ?? '');
  }

  isOutputAnchor(event: DaemonEventDto): boolean {
    return event.source === 'output' && !!event.commandId && event.anchorFrom != null;
  }

  isFileAnchor(event: DaemonEventDto): boolean {
    return !!event.source && event.source !== 'output' && event.anchorFrom != null;
  }

  emitFileAnchor(event: DaemonEventDto): void {
    this.openFile.emit({
      path: event.source!,
      startLine: event.anchorFrom!,
      endLine: event.anchorTo ?? event.anchorFrom!,
    });
  }

  severityDot(event: DaemonEventDto): string {
    switch (event.severity) {
      case DaemonEventSeverity.Error:
        return 'bg-red-500';
      case DaemonEventSeverity.Warning:
        return 'bg-amber-500';
      default:
        return 'bg-muted-foreground/50';
    }
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
