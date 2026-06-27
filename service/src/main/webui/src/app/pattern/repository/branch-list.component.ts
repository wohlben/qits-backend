import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FormField, form, required, submit } from '@angular/forms/signals';
import { injectMutation, injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';
import { patchState, signalState } from '@ngrx/signals';

import { RepositoryControllerService } from '@/api/api/repositoryController.service';
import { WorktreeControllerService } from '@/api/api/worktreeController.service';
import { WorktreeDto } from '@/api/model/worktreeDto';
import { ZardButtonComponent } from '@/shared/components/button';
import { ZardDialogComponent } from '@/shared/components/dialog';
import { ZardSelectImports } from '@/shared/components/select/select.imports';
import { EmptyStateComponent } from '@/ui/components/empty-state/empty-state.component';
import { BranchTreeComponent, BranchTreeNode } from '@/ui/components/repository/branch-tree.component';
import { FormFieldLayoutComponent } from '@/ui/layout/form-field-layout/form-field-layout.component';
import { FormFieldSlotDirective } from '@/ui/layout/form-field-layout/form-field-slot.directive';
import { invalidateRepository } from './invalidate-repository';

type OpenDialog = 'none' | 'create' | 'integrate' | 'abandon' | 'delete';
interface CreateWorktreeForm {
  id: string;
  branch: string;
}

@Component({
  selector: 'app-branch-list',
  imports: [
    ZardButtonComponent,
    ZardDialogComponent,
    ZardSelectImports,
    EmptyStateComponent,
    BranchTreeComponent,
    FormFieldLayoutComponent,
    FormFieldSlotDirective,
    FormField,
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
            (viewCommits)="viewCommits($event)"
            (viewTerminal)="viewTerminal($event)"
            (branchOff)="openCreate($event)"
            (integrate)="openIntegrate($event)"
            (abandon)="openAbandon($event)"
            (delete)="openDelete($event)"
            (fastForward)="onFastForward($event)"
          />
          @if (fastForwardMutation.isError()) {
            <div class="text-sm text-destructive">Failed to fast-forward branch</div>
          }
        }
      }
    </div>

    <!-- Branch off (create) -->
    <z-dialog
      [open]="ui().open === 'create'"
      (openChange)="closeDialog()"
      [zTitle]="'New worktree from ' + (ui().parent ?? '')"
    >
      <p class="text-sm text-muted-foreground">
        Fork a new worktree from <span class="font-medium">{{ ui().parent }}</span>. The worktree
        gets its own branch so it never shares commits with another worktree.
      </p>
      <form (submit)="onCreate($event)" class="flex flex-col gap-3">
        <app-form-field-layout [field]="createForm.id" id="worktree-id" label="Worktree ID" autocomplete="off" />

        <app-form-field-layout
          [field]="createForm.branch"
          id="worktree-new-branch"
          label="New branch name (defaults to worktree ID)"
          autocomplete="off"
        />

        <div class="flex items-center gap-2">
          <button z-button type="submit" [zLoading]="createMutation.isPending()">Create</button>
          <button z-button zType="secondary" type="button" (click)="closeDialog()">Cancel</button>
        </div>
        @if (createMutation.isError()) {
          <span class="text-sm text-destructive">Failed to create worktree</span>
        }
      </form>
    </z-dialog>

    <!-- Integrate (merge) -->
    <z-dialog [open]="ui().open === 'integrate'" (openChange)="closeDialog()" zTitle="Integrate Change">
      <p class="text-sm text-muted-foreground">
        Merge <span class="font-medium">{{ ui().branch }}</span> into a target branch (defaults to
        the main branch).
      </p>
      <form (submit)="onIntegrate($event)" class="flex flex-col gap-3">
        <app-form-field-layout [field]="integrateForm.target" id="branch-target-branch" label="Target branch">
          <z-select appFormFieldSlot="input" [formField]="integrateForm.target" zPlaceholder="Select branch…">
            @for (b of integrateTargets(); track b) {
              <z-select-item [zValue]="b">{{ b }}</z-select-item>
            }
          </z-select>
        </app-form-field-layout>

        <div class="flex items-center gap-2">
          <button z-button type="submit" [zLoading]="mergeMutation.isPending()">Integrate</button>
          <button z-button zType="secondary" type="button" (click)="closeDialog()">Cancel</button>
        </div>
        @if (mergeMutation.isError()) {
          <span class="text-sm text-destructive">Failed to integrate worktree</span>
        }
      </form>
    </z-dialog>

    <!-- Abandon (discard) -->
    <z-dialog [open]="ui().open === 'abandon'" (openChange)="closeDialog()" zTitle="Abandon worktree?">
      <p class="text-sm text-muted-foreground">
        Discard <span class="font-medium">{{ ui().selected?.worktreeId }}</span>? This cannot be undone.
      </p>
      <div class="flex items-center gap-2">
        <button z-button zType="destructive" [zLoading]="discardMutation.isPending()" (click)="onAbandon()">
          Abandon
        </button>
        <button z-button zType="secondary" type="button" (click)="closeDialog()">Cancel</button>
      </div>
      @if (discardMutation.isError()) {
        <span class="text-sm text-destructive">Failed to abandon worktree</span>
      }
    </z-dialog>

    <!-- Delete branch -->
    <z-dialog [open]="ui().open === 'delete'" (openChange)="closeDialog()" zTitle="Delete branch?">
      <p class="text-sm text-muted-foreground">
        Delete branch <span class="font-medium">{{ ui().branch }}</span>? This cannot be undone.
      </p>
      <div class="flex items-center gap-2">
        <button z-button zType="destructive" [zLoading]="deleteBranchMutation.isPending()" (click)="onDelete()">
          Delete
        </button>
        <button z-button zType="secondary" type="button" (click)="closeDialog()">Cancel</button>
      </div>
      @if (deleteBranchMutation.isError()) {
        <span class="text-sm text-destructive">Failed to delete branch</span>
      }
    </z-dialog>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BranchListComponent {
  readonly repoId = input.required<string>();

  private readonly worktreeService = inject(WorktreeControllerService);
  private readonly repositoryService = inject(RepositoryControllerService);
  private readonly queryClient = inject(QueryClient);
  private readonly router = inject(Router);

  readonly ui = signalState<{
    open: OpenDialog;
    selected: WorktreeDto | null;
    parent: string | null;
    branch: string | null;
  }>({
    open: 'none',
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

  readonly repositoryQuery = injectQuery(() => ({
    queryKey: ['repository', this.repoId()],
    queryFn: () =>
      lastValueFrom(this.repositoryService.apiRepositoriesRepoIdGet(this.repoId())).then(
        (r) => r.repository,
      ),
  }));

  readonly branches = computed(() => this.branchesQuery.data() ?? []);

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
  readonly integrateTargets = computed(() =>
    this.branches().filter((b) => b !== this.ui.branch()),
  );

  /**
   * Builds the nested worktree tree for `z-tree`. A worktree's `parent` is the
   * branch it forked from, so a worktree whose branch is itself another
   * worktree's parent nests underneath it. Branches with no resolvable parent
   * (e.g. master) are roots. Each node carries its worktree (or null) as `data`.
   */
  readonly treeNodes = computed<BranchTreeNode[]>(() => {
    const byBranch = new Map<string, WorktreeDto>();
    for (const wt of this.worktreesQuery.data() ?? []) {
      if (wt.branch) byBranch.set(wt.branch, wt);
    }
    const branches = this.branches();
    const branchNames = new Set(branches);

    const nodes = new Map<string, BranchTreeNode>(
      branches.map((branch) => [branch, { key: branch, label: branch, data: byBranch.get(branch) ?? null, children: [] }]),
    );

    const roots: BranchTreeNode[] = [];
    for (const branch of branches) {
      const node = nodes.get(branch)!;
      const parent = node.data?.parent;
      const parentNode = parent && parent !== branch && branchNames.has(parent) ? nodes.get(parent) : undefined;
      if (parentNode) {
        parentNode.children!.push(node);
      } else {
        roots.push(node);
      }
    }
    return roots;
  });

  readonly createMutation = injectMutation(() => ({
    mutationFn: (data: { id: string; parent: string; branch: string }) =>
      lastValueFrom(
        this.worktreeService.apiRepositoriesRepoIdWorktreesPost(this.repoId(), {
          id: data.id,
          parent: data.parent || undefined,
          branch: data.branch || undefined,
        }),
      ),
    onSuccess: () => this.onMutationSuccess(),
  }));

  readonly mergeMutation = injectMutation(() => ({
    mutationFn: ({ source, target }: { source: string; target: string }) =>
      lastValueFrom(
        this.repositoryService.apiRepositoriesRepoIdBranchesMergePost(this.repoId(), {
          source,
          target: target || undefined,
        }),
      ),
    onSuccess: () => this.onMutationSuccess(),
  }));

  readonly discardMutation = injectMutation(() => ({
    mutationFn: (worktreeId: string) =>
      lastValueFrom(
        this.worktreeService.apiRepositoriesRepoIdWorktreesWorktreeIdDiscardPost(this.repoId(), worktreeId, {}),
      ),
    onSuccess: () => this.onMutationSuccess(),
  }));

  readonly deleteBranchMutation = injectMutation(() => ({
    mutationFn: (branch: string) =>
      lastValueFrom(this.repositoryService.apiRepositoriesRepoIdBranchesDelete(this.repoId(), branch)),
    onSuccess: () => this.onMutationSuccess(),
  }));

  readonly fastForwardMutation = injectMutation(() => ({
    mutationFn: (worktreeId: string) =>
      lastValueFrom(
        this.worktreeService.apiRepositoriesRepoIdWorktreesWorktreeIdFastForwardPost(this.repoId(), worktreeId),
      ),
    onSuccess: () => invalidateRepository(this.queryClient, this.repoId()),
  }));

  viewCommits(branch: string) {
    this.router.navigate(['/repositories', this.repoId(), 'branch', branch, 'commits']);
  }

  viewTerminal(branch: string) {
    this.router.navigate(['/repositories', this.repoId(), 'branch', branch, 'terminal']);
  }

  openCreate(parent: string) {
    this.createModel.set({ id: '', branch: '' });
    patchState(this.ui, { open: 'create', selected: null, parent });
  }

  openIntegrate(branch: string) {
    // Default the target to the worktree's parent when this branch is worktree-backed, otherwise
    // to the repository's configured main branch.
    const worktree = this.worktreeByBranch().get(branch) ?? null;
    this.integrateModel.set({ target: worktree?.parent ?? this.mainBranch() });
    patchState(this.ui, { open: 'integrate', selected: worktree, branch });
  }

  openAbandon(worktree: WorktreeDto) {
    patchState(this.ui, { open: 'abandon', selected: worktree });
  }

  openDelete(branch: string) {
    patchState(this.ui, { open: 'delete', branch });
  }

  closeDialog() {
    patchState(this.ui, { open: 'none', selected: null, parent: null, branch: null });
  }

  async onCreate(event: Event) {
    event.preventDefault();
    const parent = this.ui.parent();
    if (!parent) return;
    await submit(this.createForm, {
      action: async () => this.createMutation.mutate({ ...this.createModel(), parent }),
    });
  }

  async onIntegrate(event: Event) {
    event.preventDefault();
    const source = this.ui.branch();
    if (!source) return;
    await submit(this.integrateForm, {
      action: async () => this.mergeMutation.mutate({ source, target: this.integrateModel().target }),
    });
  }

  onAbandon() {
    const worktreeId = this.ui.selected()?.worktreeId;
    if (worktreeId) {
      this.discardMutation.mutate(worktreeId);
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

  private onMutationSuccess() {
    invalidateRepository(this.queryClient, this.repoId());
    this.closeDialog();
  }
}
