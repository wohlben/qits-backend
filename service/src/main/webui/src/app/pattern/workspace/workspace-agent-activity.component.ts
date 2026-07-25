import { ChangeDetectionStrategy, Component, computed, inject, input, linkedSignal } from '@angular/core';
import { form, FormField } from '@angular/forms/signals';
import { injectMutation, injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { AgentActivityState, SettingControllerService, WorkspaceControllerService } from '@/api';
import type { WorkspaceDto } from '@/api';
import { ZardBadgeComponent } from '@/shared/components/badge/badge.component';
import { ZardCheckboxComponent } from '@/shared/components/checkbox/checkbox.component';

/** The instance setting gating whether qits injects the turn-boundary activity hooks. */
const ACTIVITY_TRACKING_KEY = 'agent.activity-tracking.enabled';

interface ActivityFormData {
  enabled: boolean;
}

/**
 * The Agents-tab activity section: shows the workspace's live coding-agent state ("cooking… / idle /
 * waiting on you") from {@code WorkspaceDto.agentActivity} — reported by the in-container
 * workspace-daemon hearing the agent's lifecycle hooks and refreshed over SSE (the `agent-activity`
 * topic invalidates the shared `['workspaces', repoId]` query). It also toggles the instance-wide
 * activity-tracking setting.
 */
@Component({
  selector: 'app-workspace-agent-activity',
  imports: [FormField, ZardBadgeComponent, ZardCheckboxComponent],
  template: `
    <section class="flex flex-col gap-3" aria-label="Agent activity">
      <h2 class="text-lg font-semibold">Activity</h2>

      <div class="flex items-center gap-2">
        <span class="text-sm text-muted-foreground">Current:</span>
        @if (activity(); as state) {
          <z-badge [zType]="badgeType()" [attr.title]="label()">{{ label() }}</z-badge>
        } @else {
          <span class="text-sm text-muted-foreground">No active agent</span>
        }
      </div>

      <label class="flex items-center gap-2 text-sm">
        <z-checkbox [formField]="form.enabled" (checkChange)="save($event)" />
        <span>Track agent activity (inject lifecycle hooks)</span>
      </label>
      @if (saveMutation.isError()) {
        <span class="text-sm text-destructive">Failed to save</span>
      }
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkspaceAgentActivityComponent {
  readonly repoId = input.required<string>();
  readonly workspaceId = input.required<string>();

  private readonly workspaceService = inject(WorkspaceControllerService);
  private readonly settingService = inject(SettingControllerService);
  private readonly queryClient = inject(QueryClient);

  // Shares the key + shape of the detail page's workspace list, so both read one cache entry that
  // the `agent-activity` SSE topic invalidates.
  readonly workspacesQuery = injectQuery(() => ({
    queryKey: ['workspaces', this.repoId()],
    queryFn: () =>
      lastValueFrom(this.workspaceService.apiRepositoriesRepoIdWorkspacesGet(this.repoId())).then(
        (r) => r.entries?.map((e) => e.workspace!).filter((w): w is WorkspaceDto => !!w) ?? [],
      ),
  }));

  readonly activity = computed<AgentActivityState | undefined>(
    () =>
      (this.workspacesQuery.data() ?? []).find((w) => w.workspaceId === this.workspaceId())
        ?.agentActivity,
  );

  readonly label = computed(() => {
    switch (this.activity()) {
      case AgentActivityState.Busy:
        return 'Cooking…';
      case AgentActivityState.Waiting:
        return 'Waiting on you';
      case AgentActivityState.Idle:
        return 'Idle';
      case AgentActivityState.Ended:
        return 'Ended';
      default:
        return '';
    }
  });

  readonly badgeType = computed(() => {
    switch (this.activity()) {
      case AgentActivityState.Busy:
        return 'default' as const;
      case AgentActivityState.Waiting:
        return 'destructive' as const;
      default:
        return 'secondary' as const;
    }
  });

  readonly settingQuery = injectQuery(() => ({
    queryKey: ['setting', ACTIVITY_TRACKING_KEY],
    queryFn: () =>
      lastValueFrom(this.settingService.apiSettingsKeyGet(ACTIVITY_TRACKING_KEY)).then(
        // Default on when unset — the backend defaults the same way.
        (res) => (res.setting?.value ?? 'true') === 'true',
      ),
  }));

  readonly model = linkedSignal<ActivityFormData>(() => ({
    enabled: this.settingQuery.data() ?? true,
  }));
  readonly form = form(this.model);

  readonly saveMutation = injectMutation(() => ({
    mutationFn: (enabled: boolean) =>
      lastValueFrom(
        this.settingService.apiSettingsKeyPut(ACTIVITY_TRACKING_KEY, { value: String(enabled) }),
      ),
    onSuccess: () =>
      this.queryClient.invalidateQueries({ queryKey: ['setting', ACTIVITY_TRACKING_KEY] }),
  }));

  save(enabled: boolean): void {
    this.saveMutation.mutate(enabled);
  }
}
