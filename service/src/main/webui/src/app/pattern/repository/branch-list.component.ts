import {
  ChangeDetectionStrategy,
  Component,
  TemplateRef,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormField, form, required, submit } from '@angular/forms/signals';
import { injectMutation, injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';
import { patchState, signalState } from '@ngrx/signals';

import { ActionConfigurationControllerService } from '@/api/api/actionConfigurationController.service';
import { AgentControllerService } from '@/api/api/agentController.service';
import { CommandControllerService } from '@/api/api/commandController.service';
import { RepositoryControllerService } from '@/api/api/repositoryController.service';
import { WorkspaceControllerService } from '@/api/api/workspaceController.service';
import { ActionConfigurationDto } from '@/api/model/actionConfigurationDto';
import { AgentMcpScope } from '@/api/model/agentMcpScope';
import { WorkspaceDto } from '@/api/model/workspaceDto';
import { ZardButtonComponent } from '@/shared/components/button';
import { ZardDialogRef, ZardDialogService } from '@/shared/components/dialog';
import { ZardSelectImports } from '@/shared/components/select/select.imports';
import { EmptyStateComponent } from '@/ui/components/empty-state/empty-state.component';
import {
  BranchTreeComponent,
  BranchTreeNode,
  CommitsPreview,
} from '@/ui/components/repository/branch-tree.component';
import { FormFieldLayoutComponent } from '@/ui/layout/form-field-layout/form-field-layout.component';
import { FormFieldSlotDirective } from '@/ui/layout/form-field-layout/form-field-slot.directive';
import { invalidateRepository } from './invalidate-repository';

interface CreateWorkspaceForm {
  id: string;
  branch: string;
}

@Component({
  selector: 'app-branch-list',
  imports: [
    ZardButtonComponent,
    ZardSelectImports,
    EmptyStateComponent,
    BranchTreeComponent,
    FormFieldLayoutComponent,
    FormFieldSlotDirective,
    FormField,
    RouterLink,
  ],
  template: `
    <div class="flex flex-col gap-4">
      <h2 class="text-lg font-semibold">Branches</h2>

      @if (branchesQuery.isPending() || workspacesQuery.isPending()) {
        <div class="text-sm text-muted-foreground">Loading branches…</div>
      } @else if (branchesQuery.isError() || workspacesQuery.isError()) {
        <div class="text-sm text-destructive">Failed to load branches</div>
      } @else {
        @let branchRows = treeNodes();
        @if (branchRows.length === 0) {
          <app-empty-state>
            <span title>No branches yet</span>
            <span description>This repository has no branches to work from</span>
          </app-empty-state>
        } @else {
          <app-branch-tree
            [nodes]="branchRows"
            [repoId]="repoId()"
            [cleanupable]="cleanupableBranches()"
            [branchSummaries]="branchSummaries()"
            [claudeConfigurable]="true"
            (viewCommits)="viewCommits($event)"
            (ensureContainer)="onEnsureContainer($event)"
            (stopContainer)="onStopContainer($event)"
            (openWorkspace)="openWorkspace($event)"
            (run)="openRun($event)"
            (configureWithClaude)="configureWithClaude($event)"
            (resolveConflict)="openResolveConflict($event)"
            (branchOff)="openCreate($event)"
            (createWorkspace)="onCreateWorkspace($event)"
            (integrate)="openIntegrate($event)"
            (abandon)="openAbandon($event)"
            (cleanup)="onCleanup($event)"
            (delete)="openDelete($event)"
            (fastForward)="onFastForward($event)"
            (update)="onUpdate($event)"
            [commitsPreview]="commitsPreview()"
            (peek)="onPeek($event)"
          />
          @if (fastForwardMutation.isError()) {
            <div class="text-sm text-destructive">Failed to fast-forward branch</div>
          }
          @if (updateMutation.isError()) {
            <div class="text-sm text-destructive">Failed to merge parent into branch</div>
          }
          @if (cleanupMutation.isError()) {
            <div class="text-sm text-destructive">Failed to clean up branch</div>
          }
          @if (ensureContainerMutation.isError()) {
            <div class="text-sm text-destructive">
              Failed to start the container: {{ errorMessage(ensureContainerMutation.error()) }}
            </div>
          }
          @if (stopContainerMutation.isError()) {
            <div class="text-sm text-destructive">Failed to stop the container</div>
          }
        }
      }
    </div>

    <!-- Branch off (create) -->
    <ng-template #createTpl>
      <p class="text-sm text-muted-foreground">
        Fork a new workspace from <span class="font-medium">{{ ui().parent }}</span
        >. The workspace gets its own branch so it never shares commits with another workspace.
      </p>
      <form (submit)="onCreate($event)" class="flex flex-col gap-3">
        <app-form-field-layout
          [field]="createForm.id"
          id="workspace-id"
          label="Workspace ID"
          autocomplete="off"
        />

        <app-form-field-layout
          [field]="createForm.branch"
          id="workspace-new-branch"
          label="New branch name (defaults to workspace ID)"
          autocomplete="off"
        />

        <label class="flex flex-col gap-1 text-sm">
          <span class="font-medium">Goal / preamble (markdown, optional)</span>
          <textarea
            rows="4"
            class="rounded-md border bg-background p-2 text-sm"
            placeholder="Why this workspace exists and what 'done' means…"
            [value]="createPreamble()"
            (input)="createPreamble.set(preambleArea.value)"
            #preambleArea
          ></textarea>
        </label>

        <div class="flex items-center gap-2">
          <button z-button type="submit" [zLoading]="createMutation.isPending()">Create</button>
          <button z-button zType="secondary" type="button" (click)="closeDialog()">Cancel</button>
        </div>
        @if (createMutation.isError()) {
          <span class="text-sm text-destructive">Failed to create workspace</span>
        }
      </form>
    </ng-template>

    <!-- Integrate (merge) -->
    <ng-template #integrateTpl>
      <p class="text-sm text-muted-foreground">
        Merge <span class="font-medium">{{ ui().branch }}</span> into a target branch (defaults to
        the main branch).
      </p>
      <form (submit)="onIntegrate($event)" class="flex flex-col gap-3">
        <app-form-field-layout
          [field]="integrateForm.target"
          id="branch-target-branch"
          label="Target branch"
        >
          <z-select
            appFormFieldSlot="input"
            [formField]="integrateForm.target"
            zPlaceholder="Select branch…"
          >
            @for (b of integrateTargets(); track b) {
              <z-select-item [zValue]="b">{{ b }}</z-select-item>
            }
          </z-select>
        </app-form-field-layout>

        <label class="flex flex-col gap-1 text-sm">
          <span class="font-medium">Result (markdown, optional)</span>
          <textarea
            rows="3"
            class="rounded-md border bg-background p-2 text-sm"
            placeholder="What was accomplished…"
            [value]="integrateResult()"
            (input)="integrateResult.set(integrateResultArea.value)"
            #integrateResultArea
          ></textarea>
        </label>

        <div class="flex items-center gap-2">
          <button z-button type="submit" [zLoading]="mergeMutation.isPending()">Integrate</button>
          <button z-button zType="secondary" type="button" (click)="closeDialog()">Cancel</button>
        </div>
        @if (mergeMutation.isError()) {
          <span class="text-sm text-destructive">Failed to integrate workspace</span>
        }
      </form>
    </ng-template>

    <!-- Abandon (discard) -->
    <ng-template #abandonTpl>
      <p class="text-sm text-muted-foreground">
        Discard <span class="font-medium">{{ ui().selected?.workspaceId }}</span
        >? The workspace and its branch are removed, but it stays in the repository history.
      </p>
      <label class="mb-3 flex flex-col gap-1 text-sm">
        <span class="font-medium">Reason / result (markdown, optional)</span>
        <textarea
          rows="3"
          class="rounded-md border bg-background p-2 text-sm"
          placeholder="Why abandon this workspace…"
          [value]="abandonResult()"
          (input)="abandonResult.set(abandonResultArea.value)"
          #abandonResultArea
        ></textarea>
      </label>
      <div class="flex items-center gap-2">
        <button
          z-button
          zType="destructive"
          [zLoading]="discardMutation.isPending()"
          (click)="onAbandon()"
        >
          Abandon
        </button>
        <button z-button zType="secondary" type="button" (click)="closeDialog()">Cancel</button>
      </div>
      @if (discardMutation.isError()) {
        <span class="text-sm text-destructive">Failed to abandon workspace</span>
      }
    </ng-template>

    <!-- Delete branch -->
    <ng-template #deleteTpl>
      <p class="text-sm text-muted-foreground">
        Delete branch <span class="font-medium">{{ ui().branch }}</span
        >? This cannot be undone.
      </p>
      <div class="flex items-center gap-2">
        <button
          z-button
          zType="destructive"
          [zLoading]="deleteBranchMutation.isPending()"
          (click)="onDelete()"
        >
          Delete
        </button>
        <button z-button zType="secondary" type="button" (click)="closeDialog()">Cancel</button>
      </div>
      @if (deleteBranchMutation.isError()) {
        <span class="text-sm text-destructive">Failed to delete branch</span>
      }
    </ng-template>

    <!-- Resolve merge conflict (fork a workspace + have Claude merge the parent in and fix it) -->
    <ng-template #resolveTpl>
      <p class="text-sm text-muted-foreground">
        <span class="font-medium">{{ ui().selected?.workspaceId }}</span> has diverged from
        <span class="font-medium">{{ ui().selected?.parent }}</span> with conflicts. Resolving forks
        a new workspace off this branch and runs Claude to merge
        <span class="font-medium">{{ ui().selected?.parent }}</span> in and fix the conflicts.
      </p>

      @if (conflictFilesQuery.isPending()) {
        <div class="text-sm text-muted-foreground">Loading conflicting files…</div>
      } @else if (conflictFilesQuery.isError()) {
        <div class="text-sm text-destructive">Failed to load conflicting files</div>
      } @else {
        @let files = conflictFilesQuery.data() ?? [];
        @if (files.length) {
          <div class="flex flex-col gap-1">
            <span class="text-sm font-medium">Conflicting files</span>
            <ul class="font-mono text-xs text-muted-foreground">
              @for (f of files; track f) {
                <li class="truncate">{{ f }}</li>
              }
            </ul>
          </div>
        } @else {
          <div class="text-sm text-muted-foreground">No conflicting files detected.</div>
        }
      }

      <div class="flex items-center gap-2">
        <button z-button [zLoading]="resolveMutation.isPending()" (click)="onResolveConflict()">
          Resolve conflict
        </button>
        <button z-button zType="secondary" type="button" (click)="closeDialog()">Cancel</button>
      </div>
      @if (resolveMutation.isError()) {
        <span class="text-sm text-destructive">Failed to start conflict resolution</span>
      }
    </ng-template>

    <!-- Run… (pick a preconfigured action to run in the workspace) -->
    <ng-template #runTpl>
      <p class="text-sm text-muted-foreground">
        Pick an action to run in <span class="font-medium">{{ ui().branch }}</span
        >. Manage actions under
        <a class="underline" routerLink="/action-configurations">Action Configurations</a>.
      </p>
      @if (actionConfigsQuery.isPending()) {
        <div class="text-sm text-muted-foreground">Loading actions…</div>
      } @else if (actionConfigsQuery.isError()) {
        <div class="text-sm text-destructive">Failed to load actions</div>
      } @else {
        @let actions = interactiveActions();
        @if (actions.length === 0) {
          <div class="text-sm text-muted-foreground">
            No interactive actions yet — create one (and tick “Interactive”) under Action
            Configurations.
          </div>
        } @else {
          <div class="flex flex-col gap-2">
            @for (action of actions; track action.id) {
              <button
                z-button
                zType="secondary"
                class="w-full justify-start"
                (click)="runAction(action.id!)"
              >
                <span class="flex flex-col items-start">
                  <span class="font-medium">{{ action.name }}</span>
                  @if (action.description) {
                    <span class="text-xs text-muted-foreground">{{ action.description }}</span>
                  }
                </span>
              </button>
            }
          </div>
        }
      }
    </ng-template>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BranchListComponent {
  readonly repoId = input.required<string>();

  private readonly workspaceService = inject(WorkspaceControllerService);
  private readonly repositoryService = inject(RepositoryControllerService);
  private readonly actionConfigService = inject(ActionConfigurationControllerService);
  private readonly commandService = inject(CommandControllerService);
  private readonly agentService = inject(AgentControllerService);
  private readonly queryClient = inject(QueryClient);
  private readonly router = inject(Router);
  private readonly dialog = inject(ZardDialogService);

  // The dialog bodies live as templates so we can open them via the official ZardDialogService
  // (overlay/portal) while keeping the forms, mutations and error state in this smart component.
  private readonly createTpl = viewChild.required<TemplateRef<unknown>>('createTpl');
  private readonly integrateTpl = viewChild.required<TemplateRef<unknown>>('integrateTpl');
  private readonly abandonTpl = viewChild.required<TemplateRef<unknown>>('abandonTpl');
  private readonly deleteTpl = viewChild.required<TemplateRef<unknown>>('deleteTpl');
  private readonly resolveTpl = viewChild.required<TemplateRef<unknown>>('resolveTpl');
  private readonly runTpl = viewChild.required<TemplateRef<unknown>>('runTpl');

  /** The currently-open dialog, so success/cancel handlers can close it. */
  private activeDialogRef?: ZardDialogRef<unknown>;

  // Context for whichever dialog is open, read by its template (parent to fork, branch to act on,
  // workspace to discard). Not a dialog-open flag — the overlay owns visibility now.
  readonly ui = signalState<{
    selected: WorkspaceDto | null;
    parent: string | null;
    branch: string | null;
  }>({
    selected: null,
    parent: null,
    branch: null,
  });

  readonly integrateModel = signal<{ target: string }>({ target: '' });
  readonly integrateForm = form(this.integrateModel, (schemaPath) => {
    required(schemaPath.target, { message: 'Select a target branch' });
  });

  readonly createModel = signal<CreateWorkspaceForm>({ id: '', branch: '' });
  readonly createForm = form(this.createModel, (schemaPath) => {
    required(schemaPath.id, { message: 'Workspace ID is required' });
  });

  readonly branchesQuery = injectQuery(() => ({
    queryKey: ['branches', this.repoId()],
    queryFn: () =>
      lastValueFrom(this.repositoryService.apiRepositoriesRepoIdBranchesGet(this.repoId())).then(
        (r) => r.branches ?? [],
      ),
  }));

  readonly workspacesQuery = injectQuery(() => ({
    queryKey: ['workspaces', this.repoId()],
    queryFn: () =>
      lastValueFrom(this.workspaceService.apiRepositoriesRepoIdWorkspacesGet(this.repoId())).then(
        (r) => r.entries?.map((e) => e.workspace!).filter((w): w is WorkspaceDto => !!w) ?? [],
      ),
  }));

  // The actions offered by the Run… dialog. Same key/shape as the action-configurations list so the
  // two share one cache entry.
  readonly actionConfigsQuery = injectQuery(() => ({
    queryKey: ['action-configurations'],
    queryFn: () =>
      lastValueFrom(this.actionConfigService.apiActionConfigurationsGet()).then(
        (r) =>
          r.entries
            ?.map((e) => e.actionConfiguration!)
            .filter((a): a is ActionConfigurationDto => !!a) ?? [],
      ),
  }));

  // The Run… terminal is interactive, so only interactive actions (a shell, Claude Code) are
  // offered. One-off commands (e.g. mvn test) are excluded.
  readonly interactiveActions = computed(() =>
    (this.actionConfigsQuery.data() ?? []).filter((a) => a.interactive),
  );

  // The conflicting files for the workspace in the open resolve dialog (the merge-tree preview).
  readonly conflictFilesQuery = injectQuery(() => ({
    queryKey: ['workspace-conflicts', this.repoId(), this.ui.selected()?.workspaceId],
    enabled: !!this.ui.selected()?.workspaceId,
    queryFn: () =>
      lastValueFrom(
        this.workspaceService.apiRepositoriesRepoIdWorkspacesWorkspaceIdConflictsGet(
          this.repoId(),
          this.ui.selected()!.workspaceId!,
        ),
      ).then((r) => r.files ?? []),
  }));

  /** The branch whose popover is open, driving the lazy incoming/outgoing commit fetch. */
  readonly peekedBranch = signal<string | null>(null);

  /** The workspace backing the open branch, if any (plain branches have none). */
  readonly peekedWorkspaceId = computed(() => {
    const branch = this.peekedBranch();
    if (!branch) return null;
    return (this.workspacesQuery.data() ?? []).find((w) => w.branch === branch)?.workspaceId ?? null;
  });

  // Commits the parent has that the branch lacks (what a fast-forward/merge pulls in). Only
  // workspace-backed branches can pull, so this is fetched only when the open branch has a workspace.
  readonly incomingQuery = injectQuery(() => ({
    queryKey: ['incoming-commits', this.repoId(), this.peekedWorkspaceId()],
    enabled: !!this.peekedWorkspaceId(),
    queryFn: () =>
      lastValueFrom(
        this.workspaceService.apiRepositoriesRepoIdWorkspacesWorkspaceIdIncomingCommitsGet(
          this.repoId(),
          this.peekedWorkspaceId()!,
        ),
      ),
  }));

  // The branch's own commits over its parent (the `+` count) — the existing commit-log endpoint,
  // which resolves the parent (workspace parent or main) server-side, so it works for any branch.
  readonly outgoingQuery = injectQuery(() => ({
    queryKey: ['outgoing-commits', this.repoId(), this.peekedBranch()],
    enabled: !!this.peekedBranch(),
    queryFn: () =>
      lastValueFrom(
        this.repositoryService.apiRepositoriesRepoIdCommitsGet(this.repoId(), this.peekedBranch()!),
      ),
  }));

  /** The fetched incoming/outgoing commits tagged with the branch they belong to. */
  readonly commitsPreview = computed<CommitsPreview | null>(() => {
    const branch = this.peekedBranch();
    if (!branch) return null;
    const incoming = this.incomingQuery.data();
    const outgoing = this.outgoingQuery.data();
    // Wait for the query that drives the visible tabs: incoming for workspace branches (Behind tab),
    // outgoing for plain branches (Forward only).
    const ready = this.peekedWorkspaceId() ? incoming !== undefined : outgoing !== undefined;
    if (!ready) return null;
    return { branch, incoming: incoming?.commits ?? [], outgoing: outgoing?.commits ?? [] };
  });

  /** Per-branch ahead/behind vs parent (from the branches endpoint), for branches with no workspace. */
  readonly branchSummaries = computed<
    Record<string, { parent: string | null; ahead: number | null; behind: number | null }>
  >(() => {
    const rec: Record<
      string,
      { parent: string | null; ahead: number | null; behind: number | null }
    > = {};
    for (const b of this.branchesQuery.data() ?? []) {
      if (b.name)
        rec[b.name] = {
          parent: b.parent ?? null,
          ahead: b.ahead ?? null,
          behind: b.behind ?? null,
        };
    }
    return rec;
  });

  readonly repositoryQuery = injectQuery(() => ({
    queryKey: ['repository', this.repoId()],
    queryFn: () =>
      lastValueFrom(this.repositoryService.apiRepositoriesRepoIdGet(this.repoId())).then(
        (r) => r.repository,
      ),
  }));

  readonly branches = computed(() =>
    (this.branchesQuery.data() ?? []).map((b) => b.name).filter((n): n is string => !!n),
  );

  /** Branch names the backend reports as safe to clean up (drives the per-row Cleanup action). */
  readonly cleanupableBranches = computed(
    () =>
      new Set(
        (this.branchesQuery.data() ?? [])
          .filter((b) => b.canCleanup)
          .map((b) => b.name)
          .filter((n): n is string => !!n),
      ),
  );

  /** The repository's configured main branch — the default integration target. */
  readonly mainBranch = computed(() => this.repositoryQuery.data()?.mainBranch ?? '');

  /** Branch name → its workspace (when one exists), used to resolve a branch's parent. */
  readonly workspaceByBranch = computed(() => {
    const map = new Map<string, WorkspaceDto>();
    for (const wt of this.workspacesQuery.data() ?? []) {
      if (wt.branch) map.set(wt.branch, wt);
    }
    return map;
  });

  /** A branch can't be integrated into itself, so the source is removed from the target list. */
  readonly integrateTargets = computed(() => this.branches().filter((b) => b !== this.ui.branch()));

  /**
   * Builds the nested branch tree for `z-tree`. A branch's parent is its workspace's fork point when
   * workspace-backed, otherwise the repository's main branch (from the branches endpoint) — so plain
   * branches nest under main too. Branches with no resolvable parent (e.g. master) are roots. Each
   * node carries its workspace (or null) as `data`.
   */
  readonly treeNodes = computed<BranchTreeNode[]>(() => {
    const byBranch = new Map<string, WorkspaceDto>();
    for (const wt of this.workspacesQuery.data() ?? []) {
      if (wt.branch) byBranch.set(wt.branch, wt);
    }
    const summaries = this.branchSummaries();
    const branches = this.branches();
    const branchNames = new Set(branches);

    const nodes = new Map<string, BranchTreeNode>(
      branches.map((branch) => [
        branch,
        { key: branch, label: branch, data: byBranch.get(branch) ?? null, children: [] },
      ]),
    );

    const roots: BranchTreeNode[] = [];
    for (const branch of branches) {
      const node = nodes.get(branch)!;
      const parent = byBranch.get(branch)?.parent ?? summaries[branch]?.parent ?? null;
      const parentNode =
        parent && parent !== branch && branchNames.has(parent) ? nodes.get(parent) : undefined;
      if (parentNode) {
        parentNode.children!.push(node);
      } else {
        roots.push(node);
      }
    }
    return roots;
  });

  // Markdown the user types in the dialogs: the workspace's goal (preamble) at creation and its
  // outcome (result) at integrate/abandon. Plain signals — not part of the validated forms.
  readonly createPreamble = signal('');
  readonly integrateResult = signal('');
  readonly abandonResult = signal('');

  readonly createMutation = injectMutation(() => ({
    mutationFn: (data: {
      id: string;
      parent: string;
      branch: string;
      preamble: string;
      adoptExisting?: boolean;
    }) =>
      lastValueFrom(
        this.workspaceService.apiRepositoriesRepoIdWorkspacesPost(this.repoId(), {
          id: data.id,
          parent: data.parent || undefined,
          branch: data.branch || undefined,
          preamble: data.preamble || undefined,
          adoptExisting: data.adoptExisting || undefined,
        }),
      ),
    onSuccess: () => this.onMutationSuccess(),
  }));

  readonly mergeMutation = injectMutation(() => ({
    mutationFn: ({ source, target, result }: { source: string; target: string; result: string }) =>
      lastValueFrom(
        this.repositoryService.apiRepositoriesRepoIdBranchesMergePost(this.repoId(), {
          source,
          target: target || undefined,
          result: result || undefined,
        }),
      ),
    onSuccess: () => this.onMutationSuccess(),
  }));

  readonly discardMutation = injectMutation(() => ({
    mutationFn: ({ workspaceId, result }: { workspaceId: string; result: string }) =>
      lastValueFrom(
        this.workspaceService.apiRepositoriesRepoIdWorkspacesWorkspaceIdDiscardPost(
          this.repoId(),
          workspaceId,
          { result: result || undefined },
        ),
      ),
    onSuccess: () => this.onMutationSuccess(),
  }));

  readonly deleteBranchMutation = injectMutation(() => ({
    mutationFn: (branch: string) =>
      lastValueFrom(
        this.repositoryService.apiRepositoriesRepoIdBranchesDelete(this.repoId(), branch),
      ),
    onSuccess: () => this.onMutationSuccess(),
  }));

  readonly fastForwardMutation = injectMutation(() => ({
    mutationFn: (workspaceId: string) =>
      lastValueFrom(
        this.workspaceService.apiRepositoriesRepoIdWorkspacesWorkspaceIdFastForwardPost(
          this.repoId(),
          workspaceId,
        ),
      ),
    onSuccess: () => invalidateRepository(this.queryClient, this.repoId()),
  }));

  readonly updateMutation = injectMutation(() => ({
    mutationFn: (workspaceId: string) =>
      lastValueFrom(
        this.workspaceService.apiRepositoriesRepoIdWorkspacesWorkspaceIdUpdateFromParentPost(
          this.repoId(),
          workspaceId,
        ),
      ),
    onSuccess: () => invalidateRepository(this.queryClient, this.repoId()),
  }));

  // Start/recreate a workspace's container on demand (it is a recreatable cache of the branch). The
  // error is surfaced (below) rather than swallowed, so a failed provision — e.g. the branch is gone
  // or the git-host is unreachable — tells the user why.
  readonly ensureContainerMutation = injectMutation(() => ({
    mutationFn: (workspaceId: string) =>
      lastValueFrom(
        this.workspaceService.apiRepositoriesRepoIdWorkspacesWorkspaceIdEnsureContainerPost(
          this.repoId(),
          workspaceId,
        ),
      ),
    onSuccess: () => invalidateRepository(this.queryClient, this.repoId()),
  }));

  readonly stopContainerMutation = injectMutation(() => ({
    mutationFn: (workspaceId: string) =>
      lastValueFrom(
        this.workspaceService.apiRepositoriesRepoIdWorkspacesWorkspaceIdStopContainerPost(
          this.repoId(),
          workspaceId,
        ),
      ),
    onSuccess: () => invalidateRepository(this.queryClient, this.repoId()),
  }));

  readonly resolveMutation = injectMutation(() => ({
    mutationFn: (workspaceId: string) =>
      lastValueFrom(
        this.workspaceService.apiRepositoriesRepoIdWorkspacesWorkspaceIdResolveConflictPost(
          this.repoId(),
          workspaceId,
        ),
      ),
    onSuccess: (res) => {
      invalidateRepository(this.queryClient, this.repoId());
      this.closeDialog();
      // The backend already spawned the autonomous Claude command on the resolution workspace; open
      // its terminal so the human watches it work.
      if (res.commandId) {
        this.router.navigate(['/commands', res.commandId]);
      }
    },
  }));

  readonly cleanupMutation = injectMutation(() => ({
    mutationFn: (branch: string) =>
      lastValueFrom(
        this.repositoryService.apiRepositoriesRepoIdBranchesCleanupPost(this.repoId(), { branch }),
      ),
    onSuccess: () => invalidateRepository(this.queryClient, this.repoId()),
  }));

  // Launch an action as a registry command, then open its terminal. The process is owned by the
  // backend and survives leaving the route, so the terminal page just re-attaches to it.
  readonly launchMutation = injectMutation(() => ({
    mutationFn: (vars: { workspaceId: string; actionId: string }) =>
      lastValueFrom(
        this.commandService.apiCommandsPost({
          repoId: this.repoId(),
          workspaceId: vars.workspaceId,
          actionId: vars.actionId,
        }),
      ),
    onSuccess: (res) => {
      const commandId = res.command?.id;
      if (commandId) {
        this.router.navigate(['/commands', commandId]);
      }
    },
  }));

  // Launch a Claude agent (repository MCP, narrowed to this repo) in a workspace, then open its
  // terminal. Not backed by an action — the backend renders the launch and registers the command.
  readonly agentMutation = injectMutation(() => ({
    mutationFn: (vars: { workspaceId: string; scope: AgentMcpScope }) =>
      lastValueFrom(
        this.agentService.apiRepositoriesRepoIdWorkspacesWorkspaceIdAgentsPost(
          this.repoId(),
          vars.workspaceId,
          { scope: vars.scope },
        ),
      ),
    onSuccess: (res) => {
      const commandId = res.command?.id;
      if (commandId) {
        this.router.navigate(['/commands', commandId]);
      }
    },
  }));

  /** Resolve the workspace backing a branch (run/launch act on the workspace, not the branch name). */
  private workspaceIdForBranch(branch: string): string | null {
    return (this.workspacesQuery.data() ?? []).find((w) => w.branch === branch)?.workspaceId ?? null;
  }

  /** Launch an action in a workspace and navigate to its command terminal. */
  private launchCommand(workspaceId: string, actionId: string) {
    this.launchMutation.mutate({ workspaceId, actionId });
  }

  viewCommits(branch: string) {
    this.router.navigate(['/repositories', this.repoId(), 'branch', branch, 'commits']);
  }

  /** Open the workspace's detail page (file browser + chat dialog). */
  openWorkspace(workspace: WorkspaceDto) {
    if (!workspace.workspaceId) return;
    this.router.navigate(['/repositories', this.repoId(), 'workspaces', workspace.workspaceId]);
  }

  /** Open the Run… dialog for a branch; the action list comes from actionConfigsQuery. */
  openRun(branch: string) {
    patchState(this.ui, { branch });
    this.openDialog('Run in workspace', this.runTpl());
  }

  /** Run the chosen action in the branch's workspace by launching a command and opening its terminal. */
  runAction(actionId: string) {
    const branch = this.ui.branch();
    if (!branch) return;
    const workspaceId = this.workspaceIdForBranch(branch);
    if (!workspaceId) return;
    this.closeDialog();
    this.launchCommand(workspaceId, actionId);
  }

  /** Launch a repository-MCP Claude agent in this subtree's workspace (narrowed to this repository). */
  configureWithClaude(branch: string) {
    const workspaceId = this.workspaceIdForBranch(branch);
    if (!workspaceId) return;
    this.agentMutation.mutate({ workspaceId, scope: AgentMcpScope.Repository });
  }

  /** Open the resolve-conflict dialog (file preview + the action button) for a conflicting workspace. */
  openResolveConflict(workspace: WorkspaceDto) {
    patchState(this.ui, {
      selected: workspace,
      branch: workspace.branch ?? null,
      parent: workspace.parent ?? null,
    });
    this.openDialog('Resolve merge conflict', this.resolveTpl());
  }

  /** Fork a resolution workspace and launch Claude on it (navigation happens on success). */
  onResolveConflict() {
    const workspaceId = this.ui.selected()?.workspaceId;
    if (workspaceId) {
      this.resolveMutation.mutate(workspaceId);
    }
  }

  openCreate(parent: string) {
    this.createModel.set({ id: '', branch: '' });
    this.createPreamble.set('');
    patchState(this.ui, { selected: null, parent });
    this.openDialog('New workspace from ' + parent, this.createTpl());
  }

  /**
   * Adopt a branch that has no workspace: create one over the existing branch (no dialog), with the
   * id derived from the branch name and the parent set to the repository's configured main branch.
   */
  onCreateWorkspace(branch: string) {
    this.createMutation.mutate({
      id: this.deriveWorkspaceId(branch),
      parent: this.mainBranch(),
      branch,
      preamble: '',
      adoptExisting: true,
    });
  }

  /**
   * Turns a branch name into a valid workspace id (the server slug rule: [A-Za-z0-9_-], ≤64 chars,
   * not dash-leading), de-colliding against existing active workspace ids by suffixing -2, -3, …
   */
  private deriveWorkspaceId(branch: string): string {
    let slug = branch.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 64);
    if (!slug || slug.startsWith('-')) slug = 'workspace';
    const taken = new Set((this.workspacesQuery.data() ?? []).map((w) => w.workspaceId));
    if (!taken.has(slug)) return slug;
    for (let i = 2; ; i++) {
      const candidate = `${slug.slice(0, 62)}-${i}`;
      if (!taken.has(candidate)) return candidate;
    }
  }

  openIntegrate(branch: string) {
    // Default the target to the workspace's parent when this branch is workspace-backed, otherwise
    // to the repository's configured main branch.
    const workspace = this.workspaceByBranch().get(branch) ?? null;
    this.integrateModel.set({ target: workspace?.parent ?? this.mainBranch() });
    this.integrateResult.set('');
    patchState(this.ui, { selected: workspace, branch });
    this.openDialog('Integrate Change', this.integrateTpl());
  }

  openAbandon(workspace: WorkspaceDto) {
    this.abandonResult.set('');
    patchState(this.ui, { selected: workspace });
    this.openDialog('Abandon workspace?', this.abandonTpl());
  }

  openDelete(branch: string) {
    patchState(this.ui, { branch });
    this.openDialog('Delete branch?', this.deleteTpl());
  }

  /** Open a dialog body via the official service; hides the built-in footer (templates own buttons). */
  private openDialog(title: string, content: TemplateRef<unknown>) {
    this.activeDialogRef = this.dialog.create({
      zTitle: title,
      zContent: content,
      zHideFooter: true,
    });
  }

  closeDialog() {
    this.activeDialogRef?.close();
    this.activeDialogRef = undefined;
    patchState(this.ui, { selected: null, parent: null, branch: null });
  }

  async onCreate(event: Event) {
    event.preventDefault();
    const parent = this.ui.parent();
    if (!parent) return;
    await submit(this.createForm, {
      action: async () =>
        this.createMutation.mutate({
          ...this.createModel(),
          parent,
          preamble: this.createPreamble(),
        }),
    });
  }

  async onIntegrate(event: Event) {
    event.preventDefault();
    const source = this.ui.branch();
    if (!source) return;
    await submit(this.integrateForm, {
      action: async () =>
        this.mergeMutation.mutate({
          source,
          target: this.integrateModel().target,
          result: this.integrateResult(),
        }),
    });
  }

  onAbandon() {
    const workspaceId = this.ui.selected()?.workspaceId;
    if (workspaceId) {
      this.discardMutation.mutate({ workspaceId, result: this.abandonResult() });
    }
  }

  onDelete() {
    const branch = this.ui.branch();
    if (branch) {
      this.deleteBranchMutation.mutate(branch);
    }
  }

  onFastForward(workspace: WorkspaceDto) {
    if (workspace.workspaceId) {
      this.fastForwardMutation.mutate(workspace.workspaceId);
    }
  }

  onEnsureContainer(workspace: WorkspaceDto) {
    if (workspace.workspaceId) {
      this.ensureContainerMutation.mutate(workspace.workspaceId);
    }
  }

  /** The backend error message from a failed mutation ({@code {message}} body), for display. */
  errorMessage(error: unknown): string {
    const httpError = error as { error?: unknown; message?: string } | null;
    const body = httpError?.error;
    if (typeof body === 'string' && body.trim()) return body;
    if (body && typeof body === 'object') {
      const message = (body as { message?: unknown }).message;
      if (typeof message === 'string' && message.trim()) return message;
    }
    return httpError?.message ?? 'unknown error';
  }

  onStopContainer(workspace: WorkspaceDto) {
    if (workspace.workspaceId) {
      this.stopContainerMutation.mutate(workspace.workspaceId);
    }
  }

  /** Merge the parent into a diverged-but-clean workspace (no fast-forward possible). */
  onUpdate(workspace: WorkspaceDto) {
    if (workspace.workspaceId) {
      this.updateMutation.mutate(workspace.workspaceId);
    }
  }

  /** A branch's popover opened: fetch that branch's incoming/outgoing commits lazily. */
  onPeek(branch: string) {
    this.peekedBranch.set(branch);
  }

  /** No confirmation: the backend re-checks safety and refuses if any data would be lost. */
  onCleanup(branch: string) {
    this.cleanupMutation.mutate(branch);
  }

  private onMutationSuccess() {
    invalidateRepository(this.queryClient, this.repoId());
    this.closeDialog();
  }
}
