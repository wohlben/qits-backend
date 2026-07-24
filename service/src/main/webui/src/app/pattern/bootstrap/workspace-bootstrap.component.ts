import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { injectMutation, injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { WorkspaceBootstrapControllerService } from '@/api/api/workspaceBootstrapController.service';
import { ZardButtonComponent } from '@/shared/components/button';
import { BootstrapOutcomeChipComponent } from '@/ui/components/bootstrap/bootstrap-outcome-chip.component';

/**
 * The workspace's bootstrap surface: the chain declared in the committed .qits-config.yml in file
 * order, each step with its last recorded run in this workspace (outcome chip + timestamp + a Logs
 * link re-attaching to the audit command row), a "Run all" chain trigger and per-step re-run.
 * Freshness rides the workspace SSE channel's `bootstrap` hints — the query refetches on every
 * chain/step state change, so the transient "chain running" indicator needs no poll.
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
        <div class="text-sm text-muted-foreground">Loading bootstrap steps…</div>
      } @else if (bootstrapQuery.isError()) {
        <div class="text-sm text-destructive">Failed to load bootstrap steps</div>
      } @else if (entries().length === 0) {
        <p class="text-sm text-muted-foreground">
          No bootstrap steps declared in this repository's .qits-config.yml.
        </p>
      } @else {
        <ul class="flex flex-col divide-y rounded-md border">
          @for (entry of entries(); track entry.step?.id) {
            <li class="flex flex-wrap items-center gap-3 px-3 py-2">
              <span class="w-6 shrink-0 text-right text-sm tabular-nums text-muted-foreground">
                {{ $index + 1 }}.
              </span>
              <div class="flex min-w-0 flex-1 flex-col">
                <span class="truncate font-medium">{{ entry.step?.name }}</span>
                @if (entry.step?.description) {
                  <span class="truncate text-xs text-muted-foreground">
                    {{ entry.step?.description }}
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
                [zLoading]="isRunningSingle(entry.step?.id)"
                (click)="runSingleMutation.mutate(entry.step!.id!)"
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
    mutationFn: (stepId: string) =>
      lastValueFrom(
        // NB: the generated client orders path params alphabetically (repoId, stepId, workspaceId).
        this.bootstrapService.apiRepositoriesRepoIdWorkspacesWorkspaceIdBootstrapCommandsStepIdRunPost(
          this.repoId(),
          stepId,
          this.workspaceId(),
        ),
      ),
    onSettled: () => this.invalidate(),
  }));

  /** Only the row whose step is actually running shows a spinner (one mutation drives them all). */
  isRunningSingle(stepId: string | undefined): boolean {
    return this.runSingleMutation.isPending() && this.runSingleMutation.variables() === stepId;
  }

  private invalidate() {
    this.queryClient.invalidateQueries({
      queryKey: ['workspace-bootstrap', this.repoId(), this.workspaceId()],
    });
  }
}
