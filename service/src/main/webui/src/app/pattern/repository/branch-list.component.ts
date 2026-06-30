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
import { CommandControllerService } from '@/api/api/commandController.service';
import { RepositoryControllerService } from '@/api/api/repositoryController.service';
import { WorktreeControllerService } from '@/api/api/worktreeController.service';
import { ActionConfigurationDto } from '@/api/model/actionConfigurationDto';
import { ActionVariant } from '@/api/model/actionVariant';
import { WorktreeDto } from '@/api/model/worktreeDto';
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

interface CreateWorktreeForm {
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

      @if (branchesQuery.isPending() || worktreesQuery.isPending()) {
        <div class="text-sm text-muted-foreground">Loading branches…</div>
      } @else if (branchesQuery.isError() || worktreesQuery.isError()) {
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
            [claudeConfigurable]="!!claudeRepositoryActionId()"
            (viewCommits)="viewCommits($event)"
            (run)="openRun($event)"
            (configureWithClaude)="configureWithClaude($event)"
            (resolveConflict)="openResolveConflict($event)"
            (branchOff)="openCreate($event)"
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
        }
      }
    </div>

    <!-- Branch off (create) -->
    <ng-template #createTpl>
      <p class="text-sm text-muted-foreground">
        Fork a new worktree from <span class="font-medium">{{ ui().parent }}</span
        >. The worktree gets its own branch so it never shares commits with another worktree.
      </p>
      <form (submit)="onCreate($event)" class="flex flex-col gap-3">
        <app-form-field-layout
          [field]="createForm.id"
          id="worktree-id"
          label="Worktree ID"
          autocomplete="off"
        />

        <app-form-field-layout
          [field]="createForm.branch"
          id="worktree-new-branch"
          label="New branch name (defaults to worktree ID)"
          autocomplete="off"
        />

        <label class="flex flex-col gap-1 text-sm">
          <span class="font-medium">Goal / preamble (markdown, optional)</span>
          <textarea
            rows="4"
            class="rounded-md border bg-background p-2 text-sm"
            placeholder="Why this worktree exists and what 'done' means…"
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
          <span class="text-sm text-destructive">Failed to create worktree</span>
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
          <span class="text-sm text-destructive">Failed to integrate worktree</span>
        }
      </form>
    </ng-template>

    <!-- Abandon (discard) -->
    <ng-template #abandonTpl>
      <p class="text-sm text-muted-foreground">
        Discard <span class="font-medium">{{ ui().selected?.worktreeId }}</span
        >? The worktree and its branch are removed, but it stays in the repository history.
      </p>
      <label class="mb-3 flex flex-col gap-1 text-sm">
        <span class="font-medium">Reason / result (markdown, optional)</span>
        <textarea
          rows="3"
          class="rounded-md border bg-background p-2 text-sm"
          placeholder="Why abandon this worktree…"
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
        <span class="text-sm text-destructive">Failed to abandon worktree</span>
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

    <!-- Resolve merge conflict (fork a worktree + have Claude merge the parent in and fix it) -->
    <ng-template #resolveTpl>
      <p class="text-sm text-muted-foreground">
        <span class="font-medium">{{ ui().selected?.worktreeId }}</span> has diverged from
        <span class="font-medium">{{ ui().selected?.parent }}</span> with conflicts. Resolving forks
        a new worktree off this branch and runs Claude to merge
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

    <!-- Run… (pick a preconfigured action to run in the worktree) -->
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

  private readonly worktreeService = inject(WorktreeControllerService);
  private readonly repositoryService = inject(RepositoryControllerService);
  private readonly actionConfigService = inject(ActionConfigurationControllerService);
  private readonly commandService = inject(CommandControllerService);
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
  // worktree to discard). Not a dialog-open flag — the overlay owns visibility now.
  readonly ui = signalState<{
    selected: WorktreeDto | null;
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

  readonly createModel = signal<CreateWorktreeForm>({ id: '', branch: '' });
  readonly createForm = form(this.createModel, (schemaPath) => {
    required(schemaPath.id, { message: 'Worktree ID is required' });
  });

  readonly branchesQuery = injectQuery(() => ({
    queryKey: ['branches', this.repoId()],
    queryFn: () =>
      lastValueFrom(this.repositoryService.apiRepositoriesRepoIdBranchesGet(this.repoId())).then(
        (r) => r.branches ?? [],
      ),
  }));

  readonly worktreesQuery = injectQuery(() => ({
    queryKey: ['worktrees', this.repoId()],
    queryFn: () =>
      lastValueFrom(this.worktreeService.apiRepositoriesRepoIdWorktreesGet(this.repoId())).then(
        (r) => r.entries?.map((e) => e.worktree!).filter((w): w is WorktreeDto => !!w) ?? [],
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

  /** The seeded "Claude Code (repository MCP)" action, found by its typed variant (not its name). */
  readonly claudeRepositoryActionId = computed(
    () =>
      (this.actionConfigsQuery.data() ?? []).find(
        (a) => a.variant === ActionVariant.ClaudeRepositoryMcp,
      )?.id ?? null,
  );

  // The conflicting files for the worktree in the open resolve dialog (the merge-tree preview).
  readonly conflictFilesQuery = injectQuery(() => ({
    queryKey: ['worktree-conflicts', this.repoId(), this.ui.selected()?.worktreeId],
    enabled: !!this.ui.selected()?.worktreeId,
    queryFn: () =>
      lastValueFrom(
        this.worktreeService.apiRepositoriesRepoIdWorktreesWorktreeIdConflictsGet(
          this.repoId(),
          this.ui.selected()!.worktreeId!,
        ),
      ).then((r) => r.files ?? []),
  }));

  /** The branch whose popover is open, driving the lazy incoming/outgoing commit fetch. */
  readonly peekedBranch = signal<string | null>(null);

  /** The worktree backing the open branch, if any (plain branches have none). */
  readonly peekedWorktreeId = computed(() => {
    const branch = this.peekedBranch();
    if (!branch) return null;
    return (this.worktreesQuery.data() ?? []).find((w) => w.branch === branch)?.worktreeId ?? null;
  });

  // Commits the parent has that the branch lacks (what a fast-forward/merge pulls in). Only
  // worktree-backed branches can pull, so this is fetched only when the open branch has a worktree.
  readonly incomingQuery = injectQuery(() => ({
    queryKey: ['incoming-commits', this.repoId(), this.peekedWorktreeId()],
    enabled: !!this.peekedWorktreeId(),
    queryFn: () =>
      lastValueFrom(
        this.worktreeService.apiRepositoriesRepoIdWorktreesWorktreeIdIncomingCommitsGet(
          this.repoId(),
          this.peekedWorktreeId()!,
        ),
      ),
  }));

  // The branch's own commits over its parent (the `+` count) — the existing commit-log endpoint,
  // which resolves the parent (worktree parent or main) server-side, so it works for any branch.
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
    // Wait for the query that drives the visible tabs: incoming for worktree branches (Behind tab),
    // outgoing for plain branches (Forward only).
    const ready = this.peekedWorktreeId() ? incoming !== undefined : outgoing !== undefined;
    if (!ready) return null;
    return { branch, incoming: incoming?.commits ?? [], outgoing: outgoing?.commits ?? [] };
  });

  /** Per-branch ahead/behind vs parent (from the branches endpoint), for branches with no worktree. */
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

  /** Branch name → its worktree (when one exists), used to resolve a branch's parent. */
  readonly worktreeByBranch = computed(() => {
    const map = new Map<string, WorktreeDto>();
    for (const wt of this.worktreesQuery.data() ?? []) {
      if (wt.branch) map.set(wt.branch, wt);
    }
    return map;
  });

  /** A branch can't be integrated into itself, so the source is removed from the target list. */
  readonly integrateTargets = computed(() => this.branches().filter((b) => b !== this.ui.branch()));

  /**
   * Builds the nested branch tree for `z-tree`. A branch's parent is its worktree's fork point when
   * worktree-backed, otherwise the repository's main branch (from the branches endpoint) — so plain
   * branches nest under main too. Branches with no resolvable parent (e.g. master) are roots. Each
   * node carries its worktree (or null) as `data`.
   */
  readonly treeNodes = computed<BranchTreeNode[]>(() => {
    const byBranch = new Map<string, WorktreeDto>();
    for (const wt of this.worktreesQuery.data() ?? []) {
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

  // Markdown the user types in the dialogs: the worktree's goal (preamble) at creation and its
  // outcome (result) at integrate/abandon. Plain signals — not part of the validated forms.
  readonly createPreamble = signal('');
  readonly integrateResult = signal('');
  readonly abandonResult = signal('');

  readonly createMutation = injectMutation(() => ({
    mutationFn: (data: { id: string; parent: string; branch: string; preamble: string }) =>
      lastValueFrom(
        this.worktreeService.apiRepositoriesRepoIdWorktreesPost(this.repoId(), {
          id: data.id,
          parent: data.parent || undefined,
          branch: data.branch || undefined,
          preamble: data.preamble || undefined,
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
    mutationFn: ({ worktreeId, result }: { worktreeId: string; result: string }) =>
      lastValueFrom(
        this.worktreeService.apiRepositoriesRepoIdWorktreesWorktreeIdDiscardPost(
          this.repoId(),
          worktreeId,
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
    mutationFn: (worktreeId: string) =>
      lastValueFrom(
        this.worktreeService.apiRepositoriesRepoIdWorktreesWorktreeIdFastForwardPost(
          this.repoId(),
          worktreeId,
        ),
      ),
    onSuccess: () => invalidateRepository(this.queryClient, this.repoId()),
  }));

  readonly updateMutation = injectMutation(() => ({
    mutationFn: (worktreeId: string) =>
      lastValueFrom(
        this.worktreeService.apiRepositoriesRepoIdWorktreesWorktreeIdUpdateFromParentPost(
          this.repoId(),
          worktreeId,
        ),
      ),
    onSuccess: () => invalidateRepository(this.queryClient, this.repoId()),
  }));

  readonly resolveMutation = injectMutation(() => ({
    mutationFn: (worktreeId: string) =>
      lastValueFrom(
        this.worktreeService.apiRepositoriesRepoIdWorktreesWorktreeIdResolveConflictPost(
          this.repoId(),
          worktreeId,
        ),
      ),
    onSuccess: (res) => {
      invalidateRepository(this.queryClient, this.repoId());
      this.closeDialog();
      // Launch Claude on the resolution worktree and open its terminal so the human watches it work.
      if (res.worktreeId && res.actionId) {
        this.launchCommand(res.worktreeId, res.actionId);
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
    mutationFn: (vars: { worktreeId: string; actionId: string }) =>
      lastValueFrom(
        this.commandService.apiCommandsPost({
          repoId: this.repoId(),
          worktreeId: vars.worktreeId,
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

  /** Resolve the worktree backing a branch (run/launch act on the worktree, not the branch name). */
  private worktreeIdForBranch(branch: string): string | null {
    return (this.worktreesQuery.data() ?? []).find((w) => w.branch === branch)?.worktreeId ?? null;
  }

  /** Launch an action in a worktree and navigate to its command terminal. */
  private launchCommand(worktreeId: string, actionId: string) {
    this.launchMutation.mutate({ worktreeId, actionId });
  }

  viewCommits(branch: string) {
    this.router.navigate(['/repositories', this.repoId(), 'branch', branch, 'commits']);
  }

  /** Open the Run… dialog for a branch; the action list comes from actionConfigsQuery. */
  openRun(branch: string) {
    patchState(this.ui, { branch });
    this.openDialog('Run in worktree', this.runTpl());
  }

  /** Run the chosen action in the branch's worktree by launching a command and opening its terminal. */
  runAction(actionId: string) {
    const branch = this.ui.branch();
    if (!branch) return;
    const worktreeId = this.worktreeIdForBranch(branch);
    if (!worktreeId) return;
    this.closeDialog();
    this.launchCommand(worktreeId, actionId);
  }

  /** Launch the repository-MCP Claude action in this subtree's worktree (project-scoped). */
  configureWithClaude(branch: string) {
    const actionId = this.claudeRepositoryActionId();
    const worktreeId = this.worktreeIdForBranch(branch);
    if (!actionId || !worktreeId) return;
    this.launchCommand(worktreeId, actionId);
  }

  /** Open the resolve-conflict dialog (file preview + the action button) for a conflicting worktree. */
  openResolveConflict(worktree: WorktreeDto) {
    patchState(this.ui, {
      selected: worktree,
      branch: worktree.branch ?? null,
      parent: worktree.parent ?? null,
    });
    this.openDialog('Resolve merge conflict', this.resolveTpl());
  }

  /** Fork a resolution worktree and launch Claude on it (navigation happens on success). */
  onResolveConflict() {
    const worktreeId = this.ui.selected()?.worktreeId;
    if (worktreeId) {
      this.resolveMutation.mutate(worktreeId);
    }
  }

  openCreate(parent: string) {
    this.createModel.set({ id: '', branch: '' });
    this.createPreamble.set('');
    patchState(this.ui, { selected: null, parent });
    this.openDialog('New worktree from ' + parent, this.createTpl());
  }

  openIntegrate(branch: string) {
    // Default the target to the worktree's parent when this branch is worktree-backed, otherwise
    // to the repository's configured main branch.
    const worktree = this.worktreeByBranch().get(branch) ?? null;
    this.integrateModel.set({ target: worktree?.parent ?? this.mainBranch() });
    this.integrateResult.set('');
    patchState(this.ui, { selected: worktree, branch });
    this.openDialog('Integrate Change', this.integrateTpl());
  }

  openAbandon(worktree: WorktreeDto) {
    this.abandonResult.set('');
    patchState(this.ui, { selected: worktree });
    this.openDialog('Abandon worktree?', this.abandonTpl());
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
    const worktreeId = this.ui.selected()?.worktreeId;
    if (worktreeId) {
      this.discardMutation.mutate({ worktreeId, result: this.abandonResult() });
    }
  }

  onDelete() {
    const branch = this.ui.branch();
    if (branch) {
      this.deleteBranchMutation.mutate(branch);
    }
  }

  onFastForward(worktree: WorktreeDto) {
    if (worktree.worktreeId) {
      this.fastForwardMutation.mutate(worktree.worktreeId);
    }
  }

  /** Merge the parent into a diverged-but-clean worktree (no fast-forward possible). */
  onUpdate(worktree: WorktreeDto) {
    if (worktree.worktreeId) {
      this.updateMutation.mutate(worktree.worktreeId);
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
