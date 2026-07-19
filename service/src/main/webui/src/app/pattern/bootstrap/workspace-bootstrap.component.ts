import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { injectMutation, injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { WorkspaceBootstrapControllerService } from '@/api/api/workspaceBootstrapController.service';
import { ZardButtonComponent } from '@/shared/components/button';
import { BootstrapOutcomeChipComponent } from '@/ui/components/bootstrap/bootstrap-outcome-chip.component';
import { configBaseName } from '@/shared/utils/config-origin';

/**
 * The workspace's bootstrap surface: the repository's chain in execution order, each command with
 * its last recorded run in this workspace (outcome chip + timestamp + a Logs link re-attaching to
 * the audit command row), a "Run all" chain trigger and per-command re-run. Freshness rides the
 * workspace SSE channel's `bootstrap` hints — the query refetches on every chain/command state
 * change, so the transient "chain running" indicator needs no poll.
 */
@Component({
  selector: 'app-workspace-bootstrap',
  imports: [DatePipe, RouterLink, ZardButtonComponent, BootstrapOutcomeChipComponent],
  template: `
    <section class="flex flex-col gap-3" aria-label="Bootstrap">
      <div class="flex items-center gap-3">
        <h2 class="text-lg font-semibold">Bootstrap</h2>
        @if (chainRunning()) {
          <span class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Chain running…
          </span>
        }
        <span class="flex-1"></span>
        @if (entries().length > 0) {
          <button
            z-button
            zSize="sm"
            type="button"
            [zDisabled]="chainRunning()"
            [zLoading]="runChainMutation.isPending()"
            (click)="runChainMutation.mutate()"
          >
            Run all
          </button>
        }
      </div>

      @if (bootstrapQuery.isPending()) {
        <div class="text-sm text-muted-foreground">Loading bootstrap commands…</div>
      } @else if (bootstrapQuery.isError()) {
        <div class="text-sm text-destructive">Failed to load bootstrap commands</div>
      } @else if (entries().length === 0) {
        <p class="text-sm text-muted-foreground">
          No bootstrap commands defined for this repository.
        </p>
      } @else {
        <ul class="flex flex-col divide-y rounded-md border">
          @for (entry of entries(); track entry.command?.id) {
            <li class="flex flex-wrap items-center gap-3 px-3 py-2">
              <span class="w-6 shrink-0 text-right text-sm tabular-nums text-muted-foreground">
                {{ $index + 1 }}.
              </span>
              <div class="flex min-w-0 flex-1 flex-col">
                <span class="truncate font-medium">{{ displayName(entry.command?.name) }}</span>
                @if (entry.command?.description) {
                  <span class="truncate text-xs text-muted-foreground">
                    {{ entry.command?.description }}
                  </span>
                }
              </div>
              @if (entry.lastRun; as lastRun) {
                <app-bootstrap-outcome-chip [outcome]="lastRun.outcome!" />
                <span class="text-xs text-muted-foreground">
                  {{ lastRun.ranAt | date: 'medium' }}
                  @if (lastRun.exitCode != null && lastRun.exitCode !== 0) {
                    · exit {{ lastRun.exitCode }}
                  }
                </span>
                @if (lastRun.commandId) {
                  <a z-button zType="ghost" zSize="sm" [routerLink]="['/commands', lastRun.commandId]">
                    Logs
                  </a>
                }
              } @else {
                <span class="text-xs text-muted-foreground">never ran</span>
              }
              <button
                z-button
                zType="secondary"
                zSize="sm"
                type="button"
                [zDisabled]="chainRunning()"
                [zLoading]="isRunningSingle(entry.command?.id)"
                (click)="runSingleMutation.mutate(entry.command!.id!)"
              >
                Run
              </button>
            </li>
          }
        </ul>
      }
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkspaceBootstrapComponent {
  readonly repoId = input.required<string>();
  readonly workspaceId = input.required<string>();

  private readonly bootstrapService = inject(WorkspaceBootstrapControllerService);
  private readonly queryClient = inject(QueryClient);

  readonly bootstrapQuery = injectQuery(() => ({
    queryKey: ['workspace-bootstrap', this.repoId(), this.workspaceId()],
    queryFn: () =>
      lastValueFrom(
        this.bootstrapService.apiRepositoriesRepoIdWorkspacesWorkspaceIdBootstrapCommandsGet(
          this.repoId(),
          this.workspaceId(),
        ),
      ),
  }));

  readonly entries = computed(() => this.bootstrapQuery.data()?.entries ?? []);
  readonly chainRunning = computed(() => this.bootstrapQuery.data()?.chainRunning ?? false);

  readonly runChainMutation = injectMutation(() => ({
    mutationFn: () =>
      lastValueFrom(
        this.bootstrapService.apiRepositoriesRepoIdWorkspacesWorkspaceIdBootstrapCommandsRunPost(
          this.repoId(),
          this.workspaceId(),
        ),
      ),
    onSettled: () => this.invalidate(),
  }));

  readonly runSingleMutation = injectMutation(() => ({
    mutationFn: (commandId: string) =>
      lastValueFrom(
        // NB: the generated client orders path params alphabetically (commandId, repoId, workspaceId).
        this.bootstrapService.apiRepositoriesRepoIdWorkspacesWorkspaceIdBootstrapCommandsCommandIdRunPost(
          commandId,
          this.repoId(),
          this.workspaceId(),
        ),
      ),
    onSettled: () => this.invalidate(),
  }));

  displayName(name: string | undefined): string {
    return configBaseName(name ?? '');
  }

  /** Only the row whose command is actually running shows a spinner (one mutation drives them all). */
  isRunningSingle(commandId: string | undefined): boolean {
    return this.runSingleMutation.isPending() && this.runSingleMutation.variables() === commandId;
  }

  private invalidate() {
    this.queryClient.invalidateQueries({
      queryKey: ['workspace-bootstrap', this.repoId(), this.workspaceId()],
    });
  }
}
