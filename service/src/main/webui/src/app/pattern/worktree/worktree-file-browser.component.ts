import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideFile, lucideFolder, lucideX } from '@ng-icons/lucide';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { WorktreeControllerService } from '@/api/api/worktreeController.service';
import { ZardBadgeComponent } from '@/shared/components/badge';
import { ZardTreeImports } from '@/shared/components/tree/tree.imports';
import type { TreeNode } from '@/shared/components/tree/tree.types';
import { EDarkModes, ZardDarkMode } from '@/shared/services/dark-mode';
import { buildFileTree, type HasPath } from '@/shared/utils/build-file-tree';
import { CodeViewerComponent, type LineRange } from '@/ui/components/code-viewer/code-viewer.component';

/** A collected reference to a range of a file, staged to later become part of a Claude prompt. */
export interface CodeReference {
  path: string;
  startLine: number;
  endLine: number;
}

/**
 * Smart component: browses a worktree's files. A folder tree on the left (built from the git file
 * list) drives a read-only code viewer on the right. Selecting a line range in the viewer collects a
 * {@link CodeReference} into a local cache, shown as removable chips and painted back into the viewer
 * as a persistent highlight. This is the foundation for feeding selected code into a prompt later —
 * it does not submit anything yet.
 */
@Component({
  selector: 'app-worktree-file-browser',
  imports: [...ZardTreeImports, CodeViewerComponent, ZardBadgeComponent, NgIcon],
  providers: [provideIcons({ lucideFile, lucideFolder, lucideX })],
  template: `
    <div class="flex h-[calc(100vh-11rem)] min-h-0 gap-4">
      <aside class="w-72 shrink-0 overflow-auto rounded-md border p-2">
        @if (filesQuery.isPending()) {
          <div class="p-2 text-sm text-muted-foreground">Loading files…</div>
        } @else if (filesQuery.isError()) {
          <div class="p-2 text-sm text-destructive">Failed to load files</div>
        } @else if (tree().length === 0) {
          <div class="p-2 text-sm text-muted-foreground">No files</div>
        } @else {
          <z-tree [zData]="tree()" zSelectable (zNodeClick)="onNodeClick($event)" />
        }
      </aside>

      <section class="flex min-w-0 flex-1 flex-col gap-2">
        @if (references().length > 0) {
          <div class="flex flex-wrap items-center gap-1.5">
            @for (ref of references(); track trackRef(ref)) {
              <z-badge zType="secondary" class="gap-1 font-mono text-xs">
                {{ ref.path }}:{{ ref.startLine }}@if (ref.endLine !== ref.startLine) {
                  -{{ ref.endLine }}
                }
                <button
                  type="button"
                  class="ml-0.5 inline-flex cursor-pointer opacity-70 hover:opacity-100"
                  [attr.aria-label]="'Remove reference ' + trackRef(ref)"
                  (click)="removeReference(ref)"
                >
                  <ng-icon name="lucideX" class="size-3!" />
                </button>
              </z-badge>
            }
          </div>
        }

        <div class="min-h-0 flex-1">
          @if (selectedPath(); as path) {
            @if (fileQuery.isPending()) {
              <div class="text-sm text-muted-foreground">Loading {{ path }}…</div>
            } @else if (fileQuery.isError()) {
              <div class="text-sm text-destructive">Failed to load {{ path }}</div>
            } @else if (fileQuery.data(); as file) {
              <app-code-viewer
                [path]="path"
                [content]="file.content ?? null"
                [binary]="file.binary ?? false"
                [isDark]="isDark()"
                [highlights]="currentHighlights()"
                (selectRange)="addReference($event)"
              />
            }
          } @else {
            <div class="flex h-full items-center justify-center text-sm text-muted-foreground">
              Select a file to view its contents.
            </div>
          }
        </div>
      </section>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorktreeFileBrowserComponent {
  readonly repoId = input.required<string>();
  readonly worktreeId = input.required<string>();

  private readonly worktreeService = inject(WorktreeControllerService);
  private readonly darkMode = inject(ZardDarkMode);

  readonly filesQuery = injectQuery(() => ({
    queryKey: ['worktree-files', this.repoId(), this.worktreeId()],
    queryFn: () =>
      lastValueFrom(
        this.worktreeService.apiRepositoriesRepoIdWorktreesWorktreeIdFilesGet(
          this.repoId(),
          this.worktreeId(),
        ),
      ).then((r) => r.paths ?? []),
  }));

  readonly tree = computed<TreeNode<HasPath>[]>(() =>
    buildFileTree(
      (this.filesQuery.data() ?? []).map((path) => ({ path })),
      { expanded: false, icons: true },
    ),
  );

  readonly selectedPath = signal<string | null>(null);

  readonly fileQuery = injectQuery(() => ({
    queryKey: ['worktree-file', this.repoId(), this.worktreeId(), this.selectedPath()],
    enabled: this.selectedPath() !== null,
    queryFn: () =>
      lastValueFrom(
        this.worktreeService.apiRepositoriesRepoIdWorktreesWorktreeIdFilesContentGet(
          this.repoId(),
          this.worktreeId(),
          this.selectedPath()!,
        ),
      ),
  }));

  readonly references = signal<CodeReference[]>([]);

  /** Ranges collected for the currently open file, painted as highlights in the viewer. */
  readonly currentHighlights = computed<LineRange[]>(() => {
    const path = this.selectedPath();
    return this.references()
      .filter((r) => r.path === path)
      .map((r) => ({ startLine: r.startLine, endLine: r.endLine }));
  });

  protected readonly isDark = computed(() => this.darkMode.themeMode() === EDarkModes.DARK);

  protected onNodeClick(node: TreeNode<HasPath>): void {
    // Leaves are files; their key is the full path. Directories are ignored.
    if (node.leaf) {
      this.selectedPath.set(node.key);
    }
  }

  addReference(range: LineRange): void {
    const path = this.selectedPath();
    if (!path) {
      return;
    }
    const ref: CodeReference = { path, startLine: range.startLine, endLine: range.endLine };
    this.references.update((refs) =>
      refs.some(
        (r) => r.path === ref.path && r.startLine === ref.startLine && r.endLine === ref.endLine,
      )
        ? refs
        : [...refs, ref],
    );
  }

  removeReference(ref: CodeReference): void {
    this.references.update((refs) => refs.filter((r) => r !== ref));
  }

  protected trackRef(ref: CodeReference): string {
    return `${ref.path}:${ref.startLine}-${ref.endLine}`;
  }
}
