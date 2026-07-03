import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
} from '@angular/core';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { RepositoryControllerService } from '@/api/api/repositoryController.service';
import { CommitFileChangeDto } from '@/api/model/commitFileChangeDto';
import { ZardResizableImports } from '@/shared/components/resizable/resizable.imports';
import { buildFileTree } from '@/shared/utils/build-file-tree';
import { compactFileTree } from '@/shared/utils/compact-file-tree';
import { EmptyStateComponent } from '@/ui/components/empty-state/empty-state.component';
import { CommitFileTreeComponent } from '@/ui/components/repository/commit-file-tree.component';
import { FileDiffViewComponent } from '@/ui/components/repository/file-diff-view.component';

/**
 * Smart 2-column commit review: the left tree lists the files the commit changed (relative to
 * its diff base — the `parent` input, or the commit's own first parent when omitted); selecting
 * a file lazily loads and renders its unified diff on the right. The selection defaults to the
 * first changed file and survives a re-fetch as long as that path still exists.
 */
@Component({
  selector: 'app-commit-diff',
  imports: [
    ...ZardResizableImports,
    EmptyStateComponent,
    CommitFileTreeComponent,
    FileDiffViewComponent,
  ],
  template: `
    @if (changesQuery.isPending()) {
      <div class="text-sm text-muted-foreground">Loading changes…</div>
    } @else if (changesQuery.isError()) {
      <div class="text-sm text-destructive">Failed to load commit changes</div>
    } @else if (files().length === 0) {
      <app-empty-state>
        <span title>No changes</span>
        <span description>This commit does not change any files against its base</span>
      </app-empty-state>
    } @else {
      <z-resizable class="h-[72vh]">
        <z-resizable-panel zDefaultSize="25" zMin="200px" zMax="70">
          <div class="h-full overflow-auto rounded-md border border-border p-2">
            <app-commit-file-tree [nodes]="treeNodes()" (fileClick)="onFileClick($event)" />
          </div>
        </z-resizable-panel>

        <z-resizable-handle zWithHandle class="mx-1" />

        <z-resizable-panel zDefaultSize="75">
          <div class="h-full overflow-auto rounded-md border border-border">
            @if (selectedPath()) {
              @if (fileDiffQuery.isPending()) {
                <div class="text-sm text-muted-foreground">Loading diff…</div>
              } @else if (fileDiffQuery.isError()) {
                <div class="text-sm text-destructive">Failed to load file diff</div>
              } @else {
                <app-file-diff-view
                  [diff]="fileDiffQuery.data()?.diff ?? ''"
                  [path]="selectedPath() ?? ''"
                />
              }
            } @else {
              <div class="text-sm text-muted-foreground">Select a file to view its diff</div>
            }
          </div>
        </z-resizable-panel>
      </z-resizable>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommitDiffComponent {
  readonly repoId = input.required<string>();
  readonly branchName = input.required<string>();
  readonly commitHash = input.required<string>();
  readonly parent = input<string | undefined>(undefined);

  private readonly repositoryService = inject(RepositoryControllerService);

  readonly changesQuery = injectQuery(() => ({
    queryKey: ['commit-changes', this.repoId(), this.commitHash(), this.parent() ?? null],
    queryFn: () =>
      lastValueFrom(
        this.repositoryService.apiRepositoriesRepoIdCommitsCommitHashChangesGet(
          this.commitHash(),
          this.repoId(),
          this.parent() || undefined,
        ),
      ),
  }));

  readonly files = computed<CommitFileChangeDto[]>(() => this.changesQuery.data()?.files ?? []);
  // Changed files are sparse, so single-child dir chains are long — compact them. The tree
  // renders fully expanded (zExpandAll), so no expansion state needs syncing here.
  readonly treeNodes = computed(() => compactFileTree(buildFileTree(this.files())));

  /**
   * The file shown on the right. Re-derived from the change set: keeps the current pick when it
   * still exists after a re-fetch, otherwise defaults to the first changed file.
   */
  readonly selectedPath = linkedSignal<CommitFileChangeDto[], string | null>({
    source: () => this.files(),
    computation: (files, previous) => {
      const prev = previous?.value;
      if (prev && files.some((f) => f.path === prev)) return prev;
      return files[0]?.path ?? null;
    },
  });

  readonly fileDiffQuery = injectQuery(() => {
    const path = this.selectedPath();
    return {
      queryKey: ['commit-diff', this.repoId(), this.commitHash(), this.parent() ?? null, path],
      enabled: !!path,
      queryFn: () =>
        lastValueFrom(
          this.repositoryService.apiRepositoriesRepoIdCommitsCommitHashDiffGet(
            this.commitHash(),
            this.repoId(),
            path!,
            this.parent() || undefined,
          ),
        ),
    };
  });

  onFileClick(file: CommitFileChangeDto) {
    if (file.path) {
      this.selectedPath.set(file.path);
    }
  }
}
