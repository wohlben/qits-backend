import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { injectMutation, injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { AgentPluginControllerService } from '@/api/api/agentPluginController.service';
import { WorkspaceControllerService } from '@/api/api/workspaceController.service';
import { ZardButtonComponent } from '@/shared/components/button';
import {
  PluginInstallStatus,
  PluginStatusChipComponent,
} from '@/ui/components/agent/plugin-status-chip.component';

import {
  AGENT_PLUGIN_REGISTRY,
  AgentPluginEntry,
  agentPluginKey,
} from './agent-plugin-registry';

/** One registry entry joined with its live install status + whether this workspace recommends it. */
interface PluginRow {
  readonly entry: AgentPluginEntry;
  readonly status: PluginInstallStatus;
  readonly recommended: boolean;
}

/**
 * The Plugins section of the workspace detail page's Agents tab: the curated coding-agent LSP plugins
 * ({@link AGENT_PLUGIN_REGISTRY}) joined with their install status on the shared credential volume.
 * The store is global to that volume, so status is identical in every workspace and an install here
 * turns the plugin green everywhere (see `docs/epics/qits-coding-agents/features/2026-07-07_agent-lsp-plugins.md`).
 *
 * Plugins the workspace's detected frameworks want are floated to the top and badged "Recommended",
 * without hiding the rest — the everything-visible-surfaced-by-rules convention. Framework detection
 * reuses the file browser's file listing (same query key + shape, so one cache entry).
 */
@Component({
  selector: 'app-workspace-plugins',
  imports: [ZardButtonComponent, PluginStatusChipComponent],
  template: `
    <section class="flex flex-col gap-3" aria-label="Agent plugins">
      <h2 class="text-lg font-semibold">Plugins</h2>
      <p class="text-sm text-muted-foreground">
        Language-server plugins for the coding agent, installed once on the shared agent home and
        available to every workspace.
      </p>

      @if (pluginsQuery.isPending()) {
        <div class="text-sm text-muted-foreground">Loading plugins…</div>
      } @else if (pluginsQuery.isError()) {
        <div class="text-sm text-destructive">Failed to load plugin status</div>
      } @else {
        <ul class="flex flex-col divide-y rounded-md border">
          @for (row of rows(); track row.entry.id) {
            <li class="flex flex-wrap items-center gap-3 px-3 py-2">
              <div class="flex min-w-0 flex-1 flex-col">
                <span class="flex items-center gap-2">
                  <span class="truncate font-medium">{{ row.entry.label }}</span>
                  @if (row.recommended) {
                    <span
                      class="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
                    >
                      Recommended
                    </span>
                  }
                </span>
                <span class="truncate text-xs text-muted-foreground">
                  {{ row.entry.description }}
                </span>
              </div>
              <app-plugin-status-chip [status]="row.status" />
              @if (row.status === 'available') {
                <button
                  z-button
                  zSize="sm"
                  type="button"
                  [zLoading]="isInstalling(row.entry.id)"
                  (click)="installMutation.mutate(row.entry.id)"
                >
                  Install
                </button>
              }
            </li>
          }
        </ul>

        @if (installMutation.isError()) {
          <div class="text-sm text-destructive">
            Install failed. The agent must be signed in and its container running.
          </div>
        }
      }
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkspacePluginsComponent {
  readonly repoId = input.required<string>();
  readonly workspaceId = input.required<string>();

  private readonly pluginService = inject(AgentPluginControllerService);
  private readonly workspaceService = inject(WorkspaceControllerService);
  private readonly queryClient = inject(QueryClient);

  /** Installed plugins on the shared volume, as a map of marketplace-qualified id → enabled. */
  readonly pluginsQuery = injectQuery(() => ({
    queryKey: ['workspace-plugins', this.repoId(), this.workspaceId()],
    queryFn: () =>
      lastValueFrom(
        this.pluginService.apiRepositoriesRepoIdWorkspacesWorkspaceIdAgentPluginsGet(
          this.repoId(),
          this.workspaceId(),
        ),
      ).then((r) => {
        const byId = new Map<string, boolean>();
        for (const p of r.installed ?? []) {
          if (p.pluginId) byId.set(p.pluginId, p.enabled ?? false);
        }
        return byId;
      }),
  }));

  /**
   * The workspace's server-computed framework detection, reused (same key) from the file browser so
   * we share its cache entry — so plugin recommendation and the file tree never disagree.
   */
  private readonly detectionQuery = injectQuery(() => ({
    queryKey: ['workspace-detection', this.repoId(), this.workspaceId()],
    queryFn: () =>
      lastValueFrom(
        this.workspaceService.apiRepositoriesRepoIdWorkspacesWorkspaceIdDetectionGet(
          this.repoId(),
          this.workspaceId(),
        ),
      ),
  }));

  /** The framework ids detected in this workspace (empty until the detection query resolves). */
  private readonly detectedFrameworkIds = computed(
    () =>
      new Set(
        (this.detectionQuery.data()?.projects ?? [])
          .map((p) => p.frameworkId)
          .filter((id): id is string => !!id),
      ),
  );

  /** The registry joined with status + recommendation, recommended plugins floated to the top. */
  readonly rows = computed<PluginRow[]>(() => {
    const installed = this.pluginsQuery.data();
    const detected = this.detectedFrameworkIds();
    const rows = AGENT_PLUGIN_REGISTRY.map((entry): PluginRow => {
      const enabled = installed?.get(agentPluginKey(entry));
      const status: PluginInstallStatus =
        enabled === undefined ? 'available' : enabled ? 'installed' : 'disabled';
      const recommended = entry.frameworkIds.some((id) => detected.has(id));
      return { entry, status, recommended };
    });
    // Recommended first, then stable by label — surfaces what this repo wants without hiding the rest.
    return rows.sort(
      (a, b) =>
        Number(b.recommended) - Number(a.recommended) ||
        a.entry.label.localeCompare(b.entry.label),
    );
  });

  readonly installMutation = injectMutation(() => ({
    mutationFn: (pluginId: string) =>
      lastValueFrom(
        // NB: the generated client orders path params alphabetically (pluginId, repoId, workspaceId).
        this.pluginService.apiRepositoriesRepoIdWorkspacesWorkspaceIdAgentPluginsPluginIdInstallPost(
          pluginId,
          this.repoId(),
          this.workspaceId(),
        ),
      ),
    onSettled: () =>
      this.queryClient.invalidateQueries({
        queryKey: ['workspace-plugins', this.repoId(), this.workspaceId()],
      }),
  }));

  /** Whether the given plugin is the one currently being installed (per-row spinner). */
  isInstalling(pluginId: string): boolean {
    return this.installMutation.isPending() && this.installMutation.variables() === pluginId;
  }
}
