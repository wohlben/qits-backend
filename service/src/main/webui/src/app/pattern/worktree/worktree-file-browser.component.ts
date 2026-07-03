import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  TemplateRef,
  viewChild,
} from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideEye,
  lucideEyeOff,
  lucideFile,
  lucideFolder,
  lucideListFilter,
  lucidePlus,
  lucideX,
} from '@ng-icons/lucide';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { WorktreeControllerService } from '@/api/api/worktreeController.service';
import { ZardBadgeComponent } from '@/shared/components/badge';
import { ZardButtonComponent } from '@/shared/components/button';
import { ZardDialogRef, ZardDialogService } from '@/shared/components/dialog';
import { ZardInputDirective } from '@/shared/components/input';
import { ZardResizableImports } from '@/shared/components/resizable/resizable.imports';
import { ZardSelectImports } from '@/shared/components/select';
import { ZardTreeComponent } from '@/shared/components/tree/tree.component';
import { ZardTreeImports } from '@/shared/components/tree/tree.imports';
import type { TreeNode } from '@/shared/components/tree/tree.types';
import { EDarkModes, ZardDarkMode } from '@/shared/services/dark-mode';
import { buildFileTree, type HasPath } from '@/shared/utils/build-file-tree';
import { compactFileTree, type CompactedChain } from '@/shared/utils/compact-file-tree';
import {
  applyPathFilters,
  filterFilePaths,
  type PathFilter,
  type PathFilterKind,
} from '@/shared/utils/filter-file-paths';
import {
  CodeViewerComponent,
  type LineRange,
} from '@/ui/components/code-viewer/code-viewer.component';

/** A collected reference to a range of a file, staged to later become part of a Claude prompt. */
export interface CodeReference {
  path: string;
  startLine: number;
  endLine: number;
}

/** How many paths to render in the dialog's "visible files" preview before truncating. */
const VISIBLE_PREVIEW_LIMIT = 500;

/**
 * Smart component: browses a worktree's files. A folder tree on the left (built from the git file
 * list) drives a read-only code viewer on the right. Selecting a line range in the viewer collects a
 * {@link CodeReference} into a local cache, shown as removable chips and painted back into the viewer
 * as a persistent highlight.
 *
 * The tree can be narrowed two ways: a top **filter input** (fuzzy over the filename) and an
 * **advanced filter dialog** whose criteria (exact/fuzzy/includes/excludes) form a whitelist union
 * minus excludes. The dialog's filter list is a public, programmatically-settable API (see
 * {@link setFilters}/{@link addFilter}/etc.) — it's meant to be populated in code later; the dialog
 * just lets the user view and tweak it.
 */
@Component({
  selector: 'app-worktree-file-browser',
  imports: [
    ...ZardTreeImports,
    ...ZardSelectImports,
    ...ZardResizableImports,
    CodeViewerComponent,
    ZardBadgeComponent,
    ZardButtonComponent,
    ZardInputDirective,
    NgIcon,
  ],
  providers: [
    provideIcons({
      lucideFile,
      lucideFolder,
      lucideX,
      lucideListFilter,
      lucideEye,
      lucideEyeOff,
      lucidePlus,
    }),
  ],
  template: `
    <z-resizable class="h-[calc(100vh-11rem)] min-h-0">
      <z-resizable-panel zDefaultSize="20" zMin="200px" zMax="70">
        <aside class="flex h-full flex-col rounded-md border">
          <div class="flex items-center gap-2 border-b p-2">
            <button
              z-button
              zType="ghost"
              zSize="icon"
              aria-label="Advanced filters"
              [class]="hasActiveFilters() ? 'text-primary' : ''"
              (click)="openFilters()"
            >
              <ng-icon name="lucideListFilter" class="size-4!" />
            </button>
            <input
              z-input
              zSize="sm"
              class="flex-1"
              placeholder="Filter files… (fuzzy, or *.ts)"
              [value]="nameQuery()"
              (valueChange)="nameQuery.set(str($event))"
            />
          </div>

          <div class="min-h-0 flex-1 overflow-auto p-2">
            @if (filesQuery.isPending()) {
              <div class="p-2 text-sm text-muted-foreground">Loading files…</div>
            } @else if (filesQuery.isError()) {
              <div class="p-2 text-sm text-destructive">Failed to load files</div>
            } @else if (tree().length === 0) {
              <div class="p-2 text-sm text-muted-foreground">No files match.</div>
            } @else {
              <!-- w-max lets rows take their natural width so long (compacted) labels are
                 reachable via the container's horizontal scroll instead of being truncated -->
              <z-tree
                class="w-max min-w-full"
                [zData]="tree()"
                [zExpandAll]="isFiltering()"
                zSelectable
                (zNodeClick)="onNodeClick($event)"
              />
            }
          </div>
        </aside>
      </z-resizable-panel>

      <z-resizable-handle zWithHandle class="mx-1" />

      <z-resizable-panel zDefaultSize="80">
        <section class="flex h-full min-w-0 flex-col gap-2">
          @if (references().length > 0) {
            <div class="flex flex-wrap items-center gap-1.5">
              @for (ref of references(); track trackRef(ref)) {
                <z-badge zType="secondary" class="gap-1 font-mono text-xs">
                  {{ ref.path }}:{{ ref.startLine }}
                  @if (ref.endLine !== ref.startLine) {
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
      </z-resizable-panel>
    </z-resizable>

    <ng-template #filtersTpl>
      <div class="flex flex-col gap-3">
        <p class="text-sm text-muted-foreground">
          Shows the union of the include criteria below (or all files if there are none), minus any
          excludes. The filter box above the tree then narrows by filename.
        </p>

        @for (row of filters(); track row.id) {
          <div class="flex items-center gap-2">
            <z-select class="w-32" [zValue]="row.kind" (zSelectionChange)="setKind(row.id, $event)">
              <z-select-item zValue="exact">Exact</z-select-item>
              <z-select-item zValue="fuzzy">Fuzzy</z-select-item>
              <z-select-item zValue="includes">Includes</z-select-item>
              <z-select-item zValue="excludes">Excludes</z-select-item>
            </z-select>
            <input
              z-input
              zSize="sm"
              class="flex-1"
              placeholder="query…"
              [value]="row.query"
              (valueChange)="updateFilter(row.id, { query: str($event) })"
            />
            <button
              z-button
              zType="ghost"
              zSize="icon"
              [class]="row.enabled ? '' : 'opacity-40'"
              [attr.aria-label]="row.enabled ? 'Disable filter' : 'Enable filter'"
              (click)="updateFilter(row.id, { enabled: !row.enabled })"
            >
              <ng-icon [name]="row.enabled ? 'lucideEye' : 'lucideEyeOff'" class="size-4!" />
            </button>
            <button
              z-button
              zType="ghost"
              zSize="icon"
              aria-label="Remove filter"
              (click)="removeFilter(row.id)"
            >
              <ng-icon name="lucideX" class="size-4!" />
            </button>
          </div>
        }

        <div class="flex items-center justify-between">
          <button z-button zType="outline" zSize="sm" (click)="addFilter()">
            <ng-icon name="lucidePlus" class="mr-1 size-4!" />
            Add filter
          </button>
          @if (filters().length > 0) {
            <button z-button zType="ghost" zSize="sm" (click)="clearFilters()">Clear all</button>
          }
        </div>

        <div class="border-t pt-2">
          <div class="mb-1 text-xs font-medium text-muted-foreground">
            Visible files ({{ dialogVisiblePaths().length }})
          </div>
          <div class="max-h-56 overflow-auto rounded-md border bg-muted/20 p-2 font-mono text-xs">
            @for (p of dialogVisiblePreview(); track p) {
              <div class="truncate">{{ p }}</div>
            } @empty {
              <div class="text-muted-foreground">No files match.</div>
            }
          </div>
          @if (dialogVisiblePaths().length > visiblePreviewLimit) {
            <div class="mt-1 text-xs text-muted-foreground">
              Showing first {{ visiblePreviewLimit }} of {{ dialogVisiblePaths().length }}.
            </div>
          }
        </div>

        <div class="flex justify-end">
          <button z-button zType="secondary" zSize="sm" (click)="closeFilters()">Close</button>
        </div>
      </div>
    </ng-template>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorktreeFileBrowserComponent {
  readonly repoId = input.required<string>();
  readonly worktreeId = input.required<string>();

  private readonly worktreeService = inject(WorktreeControllerService);
  private readonly darkMode = inject(ZardDarkMode);
  private readonly dialog = inject(ZardDialogService);

  protected readonly visiblePreviewLimit = VISIBLE_PREVIEW_LIMIT;

  private readonly filtersTpl = viewChild<TemplateRef<unknown>>('filtersTpl');
  private readonly treeCmp = viewChild(ZardTreeComponent);
  private filtersDialogRef?: ZardDialogRef<unknown>;
  private filterSeq = 0;

  constructor() {
    // Mirror a compacted node's open/closed state onto the dirs absorbed into its label. When a
    // filter change later splits the chain, the newly separate ancestors are then already open —
    // the user was "inside" the chain, so re-opening there is the right UX. A leaf-ending chain
    // counts as open: its file is visible, which in an uncompacted tree implies every ancestor
    // is expanded. Only writes on an actual delta, so the effect settles after one pass.
    effect(() => {
      const tree = this.treeCmp();
      if (!tree) return;
      const { chains } = this.compaction();
      const expanded = tree.treeService.expandedKeys();
      const add: string[] = [];
      const remove: string[] = [];
      for (const { key: deepestKey, absorbedKeys, leaf } of chains) {
        const open = leaf || expanded.has(deepestKey);
        for (const key of absorbedKeys) {
          if (open !== expanded.has(key)) (open ? add : remove).push(key);
        }
      }
      if (add.length === 0 && remove.length === 0) return;
      tree.treeService.expandedKeys.update((keys) => {
        const next = new Set(keys);
        for (const key of add) next.add(key);
        for (const key of remove) next.delete(key);
        return next;
      });
    });
  }

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

  /** Advanced-filter criteria — public and settable in code (this is the programmatic API). */
  readonly filters = signal<PathFilter[]>([]);
  /** The top input's fuzzy-by-filename query. */
  readonly nameQuery = signal('');

  readonly hasActiveFilters = computed(() =>
    this.filters().some((f) => f.enabled && f.query.trim() !== ''),
  );

  /** Paths after both the dialog filters and the top input — what the tree renders. */
  readonly filteredPaths = computed(() =>
    filterFilePaths(this.filesQuery.data() ?? [], this.filters(), this.nameQuery()),
  );

  /** Paths after only the dialog filters — the dialog's "visible files" preview. */
  readonly dialogVisiblePaths = computed(() =>
    applyPathFilters(this.filesQuery.data() ?? [], this.filters()),
  );

  readonly dialogVisiblePreview = computed(() =>
    this.dialogVisiblePaths().slice(0, VISIBLE_PREVIEW_LIMIT),
  );

  /** True when any filter narrows the tree — drives the tree's expand-all so matches are visible. */
  protected readonly isFiltering = computed(
    () => this.nameQuery().trim() !== '' || this.hasActiveFilters(),
  );

  /**
   * The rendered forest with single-child chains compacted (`src / main / java`), plus the
   * chain map needed to keep expansion state coherent when a chain forms or resolves. Derived,
   * so a filter change that reveals a hidden sibling splits the chain in the same pass.
   */
  private readonly compaction = computed(() => {
    const chains: CompactedChain[] = [];
    const nodes = compactFileTree(
      buildFileTree(
        this.filteredPaths().map((path) => ({ path })),
        { expanded: false, icons: true },
      ),
      { chains },
    );
    return { nodes, chains };
  });

  readonly tree = computed<TreeNode<HasPath>[]>(() => this.compaction().nodes);

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

  // --- Advanced-filter dialog + programmatic API ---

  protected openFilters(): void {
    const content = this.filtersTpl();
    if (!content) {
      return;
    }
    this.filtersDialogRef = this.dialog.create({
      zTitle: 'Advanced filters',
      zContent: content,
      zHideFooter: true,
    });
  }

  protected closeFilters(): void {
    this.filtersDialogRef?.close();
    this.filtersDialogRef = undefined;
  }

  /** Replace the whole filter list (programmatic entry point). */
  setFilters(filters: PathFilter[]): void {
    this.filters.set(filters);
  }

  /** Append a filter, returning its generated id. Defaults to an enabled, empty "includes". */
  addFilter(partial: Partial<Omit<PathFilter, 'id'>> = {}): string {
    const id = `f${++this.filterSeq}`;
    const filter: PathFilter = {
      id,
      kind: partial.kind ?? 'includes',
      query: partial.query ?? '',
      enabled: partial.enabled ?? true,
    };
    this.filters.update((filters) => [...filters, filter]);
    return id;
  }

  updateFilter(id: string, patch: Partial<Omit<PathFilter, 'id'>>): void {
    this.filters.update((filters) => filters.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }

  removeFilter(id: string): void {
    this.filters.update((filters) => filters.filter((f) => f.id !== id));
  }

  clearFilters(): void {
    this.filters.set([]);
  }

  protected setKind(id: string, value: string | string[]): void {
    const kind = (Array.isArray(value) ? value[0] : value) as PathFilterKind;
    this.updateFilter(id, { kind });
  }

  /** Coerce a z-input model value (string | number | null | undefined) to a string. */
  protected str(value: unknown): string {
    return value == null ? '' : String(value);
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
