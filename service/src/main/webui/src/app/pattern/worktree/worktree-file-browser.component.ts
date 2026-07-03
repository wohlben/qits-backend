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
  lucideChevronDown,
  lucideChevronRight,
  lucideChevronUp,
  lucideCode,
  lucideEye,
  lucideEyeOff,
  lucideFile,
  lucideFileStack,
  lucideFlaskConical,
  lucideFolder,
  lucideLayers,
  lucideListFilter,
  lucidePlus,
  lucideX,
} from '@ng-icons/lucide';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { injectQueries } from '@tanstack/angular-query-experimental/inject-queries-experimental';
import { lastValueFrom } from 'rxjs';

import { WorktreeControllerService } from '@/api/api/worktreeController.service';
import type { LazyDirDto } from '@/api/model/lazyDirDto';
import type { WorktreeFileContentDto } from '@/api/model/worktreeFileContentDto';
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
  basename,
  filterFilePaths,
  fuzzyMatch,
  type PathFilter,
  type PathFilterKind,
  type PathFilterMode,
} from '@/shared/utils/filter-file-paths';
import {
  detectFrameworks,
  FRAMEWORK_DESCRIPTORS,
  frameworkToRules,
  linkedTestsOf,
  resolveLinkedGroup,
  type DetectedProject,
  type FrameworkDescriptor,
  type LinkedFile,
} from '@/shared/utils/detect-frameworks';
import { ignorelistToRules } from '@/shared/utils/ignorelist-rules';
import type { LineRange } from '@/ui/components/code-viewer/code-viewer.component';
import {
  FileViewerComponent,
  type FileViewMode,
} from '@/ui/components/file-viewer/file-viewer.component';
import { findRenderer } from '@/ui/components/file-viewer/renderers';

/** A collected reference to a range of a file, staged to later become part of a Claude prompt. */
export interface CodeReference {
  path: string;
  startLine: number;
  endLine: number;
}

/**
 * A dynamic filter *selection* — a generator, not a rule. Its generated rules are derived from the
 * worktree's content/structure and recomputed whenever that changes, so they live in their own list
 * and are never hand-edited. Two kinds:
 * - `ignorelist`: `param` is an ignore-file basename (`.gitignore`); rules come from that file's
 *   content.
 * - `framework`: `param` keys a detected project — `descriptorId` for a whole-descriptor filter
 *   (docs, spanning every `docs/` dir) or `descriptorId::root` for a per-root one (java/angular);
 *   rules are the framework's file globs, scoped by root.
 */
export interface DynamicFilter {
  id: string;
  type: 'ignorelist' | 'framework';
  param: string;
  enabled: boolean;
}

/** Separator in a per-root framework filter's `param` (`descriptorId::root`). */
const FRAMEWORK_PARAM_SEP = '::';

/** A framework label's short name — the segment after the last ` / ` (`Java / Quarkus` → `Quarkus`). */
function lastLabelSegment(label: string): string {
  const i = label.lastIndexOf(' / ');
  return i === -1 ? label : label.slice(i + 3);
}

/** An offer-able framework filter — one per detected java/angular root, one aggregate for docs. */
interface FrameworkOption {
  /** Stable key stored in the {@link DynamicFilter} selection. */
  param: string;
  descriptorId: string;
  /** The project root(s) this filter's whitelist spans. */
  roots: string[];
  /** Human label, e.g. `Java / Quarkus (root)`, `TypeScript / Angular (service/…/webui)`, `Docs`. */
  label: string;
}

/** An older or loosely-typed filter accepted by {@link migratePathFilter} / {@link setFilters}. */
export type LegacyPathFilter = Omit<PathFilter, 'kind' | 'mode'> & {
  kind: string;
  mode?: PathFilterMode;
};

/**
 * Brings a filter up to the current model: the old `excludes` kind becomes an `includes`
 * blacklist, and any filter missing a `mode` defaults to `whitelist`. Applied at the programmatic
 * `setFilters` boundary so older callers keep working.
 */
export function migratePathFilter(filter: LegacyPathFilter): PathFilter {
  if (filter.kind === 'excludes') {
    return { ...filter, kind: 'includes', mode: 'blacklist' };
  }
  return { ...filter, kind: filter.kind as PathFilterKind, mode: filter.mode ?? 'whitelist' };
}

/** How many paths to render in the dialog's "visible files" preview before truncating. */
const VISIBLE_PREVIEW_LIMIT = 500;

/** One level of a worktree's file tree: eager files plus lazily-resolvable directory stubs. */
interface LazyLevel {
  paths: string[];
  lazyDirs: LazyDirDto[];
}

/**
 * A synthetic leaf appended under an unopened lazy directory so {@link buildFileTree} materialises
 * the directory node and the tree renders an expansion chevron for it. It is replaced by the real
 * listing once the directory is opened and its fetch resolves.
 */
const LAZY_SENTINEL = '__lazy_stub__';

/** How {@link compactFileTree} joins a compacted chain's segments — must match its `separator`. */
const CHAIN_SEPARATOR = ' / ';

/**
 * Turns the sentinel-bearing directory nodes into lazy stubs in place: marks them {@code lazy},
 * appends the immediate-child count to the label (`node_modules (312)`), and swaps the sentinel
 * leaf for a single placeholder child (shown as `Loading…` only while the dir is open and its fetch
 * is in flight). Recurses into non-stub directories.
 */
function markLazyStubs(
  nodes: TreeNode<HasPath>[],
  stubs: ReadonlySet<string>,
  counts: ReadonlyMap<string, number>,
  opened: ReadonlySet<string>,
): void {
  for (const node of nodes) {
    if (stubs.has(node.key)) {
      node.lazy = true;
      node.label = `${node.label} (${counts.get(node.key) ?? 0})`;
      node.children = [
        { key: `${node.key}/${LAZY_SENTINEL}`, label: opened.has(node.key) ? 'Loading…' : '', leaf: true },
      ];
    } else if (node.children?.length) {
      markLazyStubs(node.children, stubs, counts, opened);
    }
  }
}

/**
 * Smart component: browses a worktree's files. A folder tree on the left (built from the git file
 * list) drives a read-only code viewer on the right. Selecting a line range in the viewer collects a
 * {@link CodeReference} into a local cache, shown as removable chips and painted back into the viewer
 * as a persistent highlight.
 *
 * The tree can be narrowed two ways: a top **filter input** (fuzzy over the filename) and an
 * **advanced filter dialog** holding an ordered rule list evaluated gitignore-style
 * (last-match-wins; each rule is whitelist/blacklist). On top of manual rules sit **dynamic
 * filters** — ignorelists (`.gitignore`, `.dockerignore`, …) whose rules are generated from the
 * ignore files' contents and recomputed whenever those change. The manual filter list is a public,
 * programmatically-settable API (see {@link setFilters}/{@link addFilter}/etc.).
 */
@Component({
  selector: 'app-worktree-file-browser',
  imports: [
    ...ZardTreeImports,
    ...ZardSelectImports,
    ...ZardResizableImports,
    FileViewerComponent,
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
      lucideChevronUp,
      lucideChevronDown,
      lucideChevronRight,
      lucideFileStack,
      lucideLayers,
      lucideCode,
      lucideFlaskConical,
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
                [zExpandAll]="expandTreeForFilter()"
                zSelectable
                (zNodeClick)="onNodeClick($event)"
              >
                <!-- Same icon+label as the default node, but de-emphasised parts render dimmed
                     (without changing layout or click behaviour): a whole lazy directory stub, and
                     the ancestor prefix of a compacted "a / b / c" breadcrumb so the final segment
                     stands out. -->
                <ng-template #nodeTemplate let-node>
                  @if (node.icon) {
                    <ng-icon
                      [name]="node.icon"
                      class="size-4! shrink-0"
                      [style.opacity]="node.lazy ? dimOpacity : null"
                    />
                  }
                  @if (node.lazy) {
                    <span class="truncate" [style.opacity]="dimOpacity">{{ node.label }}</span>
                  } @else {
                    <span class="truncate"
                      ><span [style.opacity]="dimOpacity" [style.fontSize]="breadcrumbPrefixSize">{{
                        breadcrumbPrefix(node.label)
                      }}</span
                      >{{ breadcrumbLeaf(node.label) }}</span
                    >
                  }
                </ng-template>
              </z-tree>
            }
          </div>
          @if (unsearchedLazyCount() > 0) {
            <div class="border-t px-2 py-1 text-xs text-muted-foreground">
              {{ unsearchedLazyCount() }} collapsed director{{
                unsearchedLazyCount() === 1 ? 'y' : 'ies'
              }}
              not searched — open to include.
            </div>
          }
          @if (frameworkQuickAccess().length > 0) {
            <div class="flex flex-wrap items-center gap-1 border-t p-2">
              <ng-icon name="lucideLayers" class="size-4! shrink-0 text-muted-foreground" />
              @for (fw of frameworkQuickAccess(); track fw.id) {
                <button
                  z-button
                  [zType]="fw.active ? 'secondary' : 'outline'"
                  zSize="sm"
                  [attr.aria-pressed]="fw.active"
                  (click)="toggleFrameworkKind(fw.id)"
                >
                  {{ fw.label }}
                </button>
              }
            </div>
          }
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

          @if (linkedGroup().length > 1) {
            <div class="flex shrink-0 items-center">
              <div class="inline-flex items-center gap-0.5 rounded-md border p-0.5">
                @for (file of linkedGroup(); track file.path) {
                  <button
                    z-button
                    [zType]="file.path === selectedPath() ? 'secondary' : 'ghost'"
                    zSize="sm"
                    [attr.aria-pressed]="file.path === selectedPath()"
                    [attr.title]="file.path"
                    (click)="selectedPath.set(file.path)"
                  >
                    <ng-icon
                      [name]="file.role === 'test' ? 'lucideFlaskConical' : 'lucideCode'"
                      class="mr-1 size-4!"
                    />
                    {{ tabLabel(file) }}
                  </button>
                }
              </div>
            </div>
          }

          <div class="min-h-0 flex-1">
            @if (selectedPath(); as path) {
              @if (fileQuery.isPending()) {
                <div class="text-sm text-muted-foreground">Loading {{ path }}…</div>
              } @else if (fileQuery.isError()) {
                <div class="text-sm text-destructive">Failed to load {{ path }}</div>
              } @else if (fileQuery.data(); as file) {
                <app-file-viewer
                  [path]="path"
                  [content]="file.content ?? null"
                  [binary]="file.binary ?? false"
                  [isDark]="isDark()"
                  [highlights]="currentHighlights()"
                  [mode]="viewerMode()"
                  (modeChange)="setViewerMode($event)"
                  (selectRange)="addReference($event)"
                  (openPath)="openLinkedPath($event)"
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
          Rules are evaluated top-to-bottom, <strong>last match wins</strong> (like
          <code>.gitignore</code>): the last rule matching a file decides whether it's shown or
          hidden. Dynamic filters apply first, then your rules — so a whitelist rule can always
          resurrect a file a dynamic filter hid. The box above the tree then narrows by filename.
        </p>

        @if (
          dynamicFilters().length > 0 ||
          ignorelistBasenames().length > 0 ||
          frameworkOptions().length > 0
        ) {
          <div class="flex flex-col gap-2 border-b pb-3">
            <div class="text-xs font-medium text-muted-foreground">Dynamic filters</div>
            @for (dyn of dynamicFilters(); track dyn.id) {
              <div class="flex flex-col gap-1">
                <div class="flex items-center gap-1.5">
                  <button
                    z-button
                    zType="ghost"
                    zSize="icon"
                    [attr.aria-label]="isDynamicExpanded(dyn.id) ? 'Collapse rules' : 'Show rules'"
                    (click)="toggleDynamicExpanded(dyn.id)"
                  >
                    <ng-icon
                      [name]="isDynamicExpanded(dyn.id) ? 'lucideChevronDown' : 'lucideChevronRight'"
                      class="size-4!"
                    />
                  </button>
                  <button
                    z-button
                    zType="ghost"
                    zSize="icon"
                    [class]="dyn.enabled ? '' : 'opacity-40'"
                    [attr.aria-label]="dyn.enabled ? 'Disable dynamic filter' : 'Enable dynamic filter'"
                    (click)="toggleDynamicFilter(dyn.id)"
                  >
                    <ng-icon [name]="dyn.enabled ? 'lucideEye' : 'lucideEyeOff'" class="size-4!" />
                  </button>
                  <span class="flex-1 truncate font-mono text-xs">
                    {{ dynamicLabel(dyn) }}
                    <span class="text-muted-foreground"> ({{ dynamicRules(dyn).length }} rules) </span>
                  </span>
                  <button
                    z-button
                    zType="ghost"
                    zSize="icon"
                    aria-label="Remove dynamic filter"
                    (click)="removeDynamicFilter(dyn.id)"
                  >
                    <ng-icon name="lucideX" class="size-4!" />
                  </button>
                </div>
                @if (isDynamicExpanded(dyn.id)) {
                  <div
                    class="ml-8 flex max-h-40 flex-col gap-0.5 overflow-auto rounded-md border bg-muted/20 p-2 font-mono text-xs"
                  >
                    @for (rule of dynamicRules(dyn); track rule.id) {
                      <div class="flex items-center gap-2">
                        <span
                          class="rounded px-1 text-[10px] uppercase"
                          [class]="
                            rule.mode === 'whitelist'
                              ? 'bg-primary/15 text-primary'
                              : 'bg-destructive/15 text-destructive'
                          "
                        >
                          {{ rule.mode === 'whitelist' ? 'show' : 'hide' }}
                        </span>
                        <span class="truncate">{{ rule.query }}</span>
                      </div>
                    } @empty {
                      <div class="text-muted-foreground">No rules (loading or empty).</div>
                    }
                  </div>
                }
              </div>
            }

            <div>
              <button
                z-button
                zType="outline"
                zSize="sm"
                [disabled]="
                  availableFrameworkOptions().length === 0 && availableIgnorelistParams().length === 0
                "
                (click)="showDynamicPicker.set(!showDynamicPicker())"
              >
                <ng-icon name="lucideFileStack" class="mr-1 size-4!" />
                Add dynamic filter
              </button>
              @if (showDynamicPicker()) {
                <div class="mt-1 flex flex-col gap-1 rounded-md border p-1">
                  @for (option of availableFrameworkOptions(); track option.param) {
                    <button
                      type="button"
                      class="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-muted"
                      (click)="addDynamicFilter('framework', option.param); showDynamicPicker.set(false)"
                    >
                      <ng-icon name="lucideLayers" class="size-4! shrink-0 text-muted-foreground" />
                      {{ option.label }}
                    </button>
                  }
                  @for (param of availableIgnorelistParams(); track param) {
                    <button
                      type="button"
                      class="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-left font-mono text-xs hover:bg-muted"
                      (click)="addDynamicFilter('ignorelist', param); showDynamicPicker.set(false)"
                    >
                      <ng-icon name="lucideFileStack" class="size-4! shrink-0 text-muted-foreground" />
                      {{ param }}
                    </button>
                  }
                  @if (
                    availableFrameworkOptions().length === 0 && availableIgnorelistParams().length === 0
                  ) {
                    <div class="px-2 py-1 text-xs text-muted-foreground">
                      No dynamic filters available.
                    </div>
                  }
                </div>
              }
            </div>
          </div>
        }

        @for (row of filters(); track row.id) {
          <div class="flex items-center gap-1.5">
            <z-select class="w-28" [zValue]="row.kind" (zSelectionChange)="setKind(row.id, $event)">
              <z-select-item zValue="exact">Exact</z-select-item>
              <z-select-item zValue="fuzzy">Fuzzy</z-select-item>
              <z-select-item zValue="includes">Includes</z-select-item>
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
              zType="outline"
              zSize="sm"
              class="w-16"
              [attr.aria-label]="
                row.mode === 'whitelist' ? 'Whitelist (matches shown)' : 'Blacklist (matches hidden)'
              "
              (click)="setMode(row.id, row.mode === 'whitelist' ? 'blacklist' : 'whitelist')"
            >
              {{ row.mode === 'whitelist' ? 'Show' : 'Hide' }}
            </button>
            <button
              z-button
              zType="ghost"
              zSize="icon"
              aria-label="Move filter up"
              (click)="moveFilterUp(row.id)"
            >
              <ng-icon name="lucideChevronUp" class="size-4!" />
            </button>
            <button
              z-button
              zType="ghost"
              zSize="icon"
              aria-label="Move filter down"
              (click)="moveFilterDown(row.id)"
            >
              <ng-icon name="lucideChevronDown" class="size-4!" />
            </button>
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

  /**
   * Opacity for de-emphasised label parts: a lazy (not-yet-loaded) directory stub, and the
   * ancestor prefix of a compacted `a / b / c` breadcrumb (so the final segment stands out). One
   * knob — tune to taste.
   */
  protected readonly dimOpacity = 0.75;

  /** The separator {@link compactFileTree} joins a compacted chain's segments with. */
  protected readonly chainSeparator = CHAIN_SEPARATOR;

  /** Font size of a breadcrumb's dimmed ancestor prefix (base tree text is 0.875rem / text-sm). */
  protected readonly breadcrumbPrefixSize = '0.7rem';

  private readonly filtersTpl = viewChild<TemplateRef<unknown>>('filtersTpl');
  private readonly treeCmp = viewChild(ZardTreeComponent);
  private filtersDialogRef?: ZardDialogRef<unknown>;
  private filterSeq = 0;
  private dynamicSeq = 0;

  /** Which dynamic-filter rows are expanded to show their generated rules read-only. */
  private readonly expandedDynamic = signal<ReadonlySet<string>>(new Set());
  /** Whether the "add dynamic filter" picker is open in the dialog. */
  protected readonly showDynamicPicker = signal(false);

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

    // Fetch a lazy directory's contents the moment it is expanded — whether by chevron or row
    // click, both of which update `expandedKeys` (the tree only emits zNodeExpand for the keyboard).
    // Adding to `openedLazyPaths` is idempotent, so an already-opened dir re-uses its cache.
    effect(() => {
      const tree = this.treeCmp();
      if (!tree) return;
      const expanded = tree.treeService.expandedKeys();
      const lazy = this.allLazyDirs();
      const opened = new Set(this.openedLazyPaths());
      const toOpen: string[] = [];
      for (const key of expanded) {
        if (lazy.has(key) && !opened.has(key)) toOpen.push(key);
      }
      if (toOpen.length) {
        this.openedLazyPaths.update((paths) => [...paths, ...toOpen]);
      }
    });

    // When a quick-access framework kind is toggled ON, open the tree to a framework-aware depth
    // (java → each root's `src/main`, angular → `src`, docs → the docs dir) rather than leaving it
    // fully collapsed — but without the expand-everything of a search. Only *newly* activated kinds
    // expand, so a later manual collapse sticks; toggling a kind off never re-expands.
    let prevActiveKinds: ReadonlySet<string> = new Set();
    effect(() => {
      const active = this.activeFrameworkKinds();
      const projects = this.detectedProjects();
      const tree = this.treeCmp();
      const newly = [...active].filter((id) => !prevActiveKinds.has(id));
      prevActiveKinds = active;
      if (!tree || newly.length === 0) return;

      const keys = new Set<string>();
      for (const { root, descriptor } of projects) {
        if (!newly.includes(descriptor.id)) continue;
        const target = descriptor.autoExpandDir?.(root);
        if (!target) continue;
        // Open every ancestor directory down to (and including) the target.
        const parts = target.split('/');
        for (let i = 1; i <= parts.length; i++) keys.add(parts.slice(0, i).join('/'));
      }
      keys.delete('');
      if (keys.size === 0) return;
      tree.treeService.expandedKeys.update((set) => {
        const next = new Set(set);
        for (const key of keys) next.add(key);
        return next;
      });
    });
  }

  readonly filesQuery = injectQuery(() => ({
    queryKey: ['worktree-files', this.repoId(), this.worktreeId()],
    queryFn: (): Promise<LazyLevel> =>
      lastValueFrom(
        this.worktreeService.apiRepositoriesRepoIdWorktreesWorktreeIdFilesGet(
          this.repoId(),
          this.worktreeId(),
        ),
      ).then((r) => ({ paths: r.paths ?? [], lazyDirs: r.lazyDirs ?? [] })),
  }));

  /** Lazy directories the user has expanded — each triggers a one-level fetch, cached per path. */
  readonly openedLazyPaths = signal<string[]>([]);

  /**
   * One-level listings of every opened lazy directory, fetched reactively (dynamic count). Keyed
   * {@code ['worktree-files', repoId, worktreeId, dir]} — a distinct cache entry per directory, so
   * re-expanding a previously-opened dir is instant.
   */
  private readonly lazyListingsQuery = injectQueries(() => ({
    queries: this.openedLazyPaths().map((dir) => ({
      queryKey: ['worktree-files', this.repoId(), this.worktreeId(), dir],
      queryFn: (): Promise<LazyLevel & { dir: string }> =>
        lastValueFrom(
          this.worktreeService.apiRepositoriesRepoIdWorktreesWorktreeIdFilesGet(
            this.repoId(),
            this.worktreeId(),
            dir,
          ),
        ).then((r) => ({ dir, paths: r.paths ?? [], lazyDirs: r.lazyDirs ?? [] })),
    })),
  }));

  /** Opened lazy dirs whose listing has arrived, keyed by directory path. */
  private readonly loadedLazyListings = computed(() => {
    const map = new Map<string, LazyLevel>();
    for (const result of this.lazyListingsQuery()) {
      const data = result?.data();
      if (data) map.set(data.dir, { paths: data.paths, lazyDirs: data.lazyDirs });
    }
    return map;
  });

  /** Every known lazy directory (root + nested from loaded listings) → its immediate-child count. */
  private readonly allLazyDirs = computed(() => {
    const counts = new Map<string, number>();
    const add = (dirs: LazyDirDto[]) => {
      for (const dir of dirs) if (dir.path) counts.set(dir.path, dir.childCount ?? 0);
    };
    add(this.filesQuery.data()?.lazyDirs ?? []);
    for (const level of this.loadedLazyListings().values()) add(level.lazyDirs);
    return counts;
  });

  /** Every eager file path currently loaded — the root plus every opened lazy directory's files. */
  readonly allEagerPaths = computed(() => {
    const paths = new Set<string>(this.filesQuery.data()?.paths ?? []);
    for (const level of this.loadedLazyListings().values()) {
      for (const p of level.paths) paths.add(p);
    }
    return [...paths];
  });

  /** Every framework/language project detected in the loaded path list — a pure, content-free pass. */
  readonly detectedProjects = computed<DetectedProject[]>(() =>
    detectFrameworks(this.allEagerPaths()),
  );

  /** Manual advanced-filter criteria — public and settable in code (this is the programmatic API). */
  readonly filters = signal<PathFilter[]>([]);
  /** Selected dynamic filters (ignorelists). Their rules are generated, not stored here. */
  readonly dynamicFilters = signal<DynamicFilter[]>([]);
  /**
   * Framework *kinds* toggled in the quick-access footer (descriptor ids). Each is an aggregate
   * filter over every detected root of that kind — one "Quarkus" toggle covers all Maven modules.
   */
  readonly activeFrameworkKinds = signal<ReadonlySet<string>>(new Set());
  /** The top input's fuzzy-by-filename query. */
  readonly nameQuery = signal('');

  /** Distinct ignore-file basenames (`.gitignore`, `.dockerignore`, …) present in the worktree. */
  readonly ignorelistBasenames = computed(() => {
    const names = new Set<string>();
    for (const path of this.allEagerPaths()) {
      const name = basename(path);
      if (fuzzyMatch('.*ignore', name)) names.add(name);
    }
    return [...names].sort();
  });

  /** Ignore-file basenames not yet selected — the "add dynamic filter" picker offers these. */
  readonly availableIgnorelistParams = computed(() => {
    const selected = new Set(this.dynamicFilters().map((d) => d.param));
    return this.ignorelistBasenames().filter((name) => !selected.has(name));
  });

  /**
   * Every path whose basename is a selected+enabled dynamic-filter param — the ignore files whose
   * contents we must read. Sorted shallow→deep (then lexically) so generated rules apply in git's
   * precedence order and so the fetched contents align positionally with {@link ignoreContents}.
   */
  private readonly ignorePathsToFetch = computed(() => {
    const params = new Set(this.dynamicFilters().filter((d) => d.enabled).map((d) => d.param));
    if (params.size === 0) return [];
    return this.allEagerPaths()
      .filter((path) => params.has(basename(path)))
      .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
  });

  /**
   * Reactive, dynamic-count fetch of every ignore file's content. The query key is byte-identical
   * to {@link fileQuery}'s, so an ignore file opened in the viewer and used as a filter is one
   * request. Results align by index with {@link ignorePathsToFetch}.
   */
  private readonly ignoreContents = injectQueries(() => ({
    queries: this.ignorePathsToFetch().map((path) => ({
      queryKey: ['worktree-file', this.repoId(), this.worktreeId(), path],
      queryFn: (): Promise<WorktreeFileContentDto> =>
        lastValueFrom(
          this.worktreeService.apiRepositoriesRepoIdWorktreesWorktreeIdFilesContentGet(
            this.repoId(),
            this.worktreeId(),
            path,
          ),
        ),
    })),
  }));

  /** Ignore-file content translated into locality-scoped generated rules (recomputed on change). */
  readonly generatedDynamicRules = computed<PathFilter[]>(() => {
    const paths = this.ignorePathsToFetch();
    const results = this.ignoreContents();
    const rules: PathFilter[] = [];
    for (let i = 0; i < paths.length; i++) {
      const content = results[i]?.data()?.content;
      if (content == null) continue; // still loading, binary, or empty — skip
      const path = paths[i];
      const slash = path.lastIndexOf('/');
      const dir = slash === -1 ? '' : path.slice(0, slash);
      rules.push(...ignorelistToRules(dir, content));
    }
    return rules;
  });

  /** Generated rules grouped by their source ignore-file basename — the dialog's read-only view. */
  readonly dynamicRuleGroups = computed(() => {
    const paths = this.ignorePathsToFetch();
    const results = this.ignoreContents();
    const groups = new Map<string, PathFilter[]>();
    for (let i = 0; i < paths.length; i++) {
      const content = results[i]?.data()?.content;
      if (content == null) continue;
      const path = paths[i];
      const slash = path.lastIndexOf('/');
      const dir = slash === -1 ? '' : path.slice(0, slash);
      const name = basename(path);
      const list = groups.get(name) ?? [];
      list.push(...ignorelistToRules(dir, content));
      groups.set(name, list);
    }
    return groups;
  });

  // --- Framework (dynamic) filters ---

  /**
   * Marker files (java `pom.xml`) to peek for a label refinement (Maven → Quarkus), deduped. The
   * always-visible quick-access footer labels its Java toggle from this, so it is fetched whenever a
   * java project is detected (cheap, cached per path via the shared file-content key).
   */
  private readonly frameworkMarkersToFetch = computed<string[]>(() => {
    const markers = new Set<string>();
    for (const { root, descriptor } of this.detectedProjects()) {
      const marker = descriptor.labelPeekMarker?.(root);
      if (marker) markers.add(marker);
    }
    return [...markers];
  });

  /**
   * Lazy fetch of each marker file's content, reusing {@link fileQuery}'s key so a `pom.xml` opened
   * in the viewer is one request. Purely cosmetic (upgrades a label) — never blocks detection.
   */
  private readonly frameworkMarkerContents = injectQueries(() => ({
    queries: this.frameworkMarkersToFetch().map((path) => ({
      queryKey: ['worktree-file', this.repoId(), this.worktreeId(), path],
      queryFn: (): Promise<WorktreeFileContentDto> =>
        lastValueFrom(
          this.worktreeService.apiRepositoriesRepoIdWorktreesWorktreeIdFilesContentGet(
            this.repoId(),
            this.worktreeId(),
            path,
          ),
        ),
    })),
  }));

  /** Marker path → its fetched content (present only once the lazy peek resolves). */
  private readonly frameworkMarkerContentByPath = computed(() => {
    const paths = this.frameworkMarkersToFetch();
    const results = this.frameworkMarkerContents();
    const map = new Map<string, string>();
    for (let i = 0; i < paths.length; i++) {
      const content = results[i]?.data()?.content;
      if (content != null) map.set(paths[i], content);
    }
    return map;
  });

  /** A descriptor's label, refined from its marker content when available (else the base label). */
  private refinedLabel(descriptor: FrameworkDescriptor, root: string): string {
    const marker = descriptor.labelPeekMarker?.(root);
    const content = marker ? this.frameworkMarkerContentByPath().get(marker) : undefined;
    return (content && descriptor.refineLabel?.(content)) || descriptor.label;
  }

  /**
   * The offer-able framework filters: one aggregate `Docs` filter spanning every detected `docs/`
   * dir, plus one per detected java/angular root (labelled with the root, and refined to Quarkus
   * when the lazy pom peek says so).
   */
  readonly frameworkOptions = computed<FrameworkOption[]>(() => {
    const projects = this.detectedProjects();
    const options: FrameworkOption[] = [];
    const docs = projects.filter((p) => p.descriptor.id === 'docs');
    if (docs.length > 0) {
      options.push({
        param: 'docs',
        descriptorId: 'docs',
        roots: docs.map((p) => p.root),
        label: docs[0].descriptor.label,
      });
    }
    for (const { root, descriptor } of projects) {
      if (descriptor.id === 'docs') continue;
      options.push({
        param: `${descriptor.id}${FRAMEWORK_PARAM_SEP}${root}`,
        descriptorId: descriptor.id,
        roots: [root],
        label: `${this.refinedLabel(descriptor, root)} (${root === '' ? 'root' : root})`,
      });
    }
    return options;
  });

  /** Framework filters not yet selected — the "add dynamic filter" picker offers these. */
  readonly availableFrameworkOptions = computed(() => {
    const selected = new Set(
      this.dynamicFilters().filter((d) => d.type === 'framework').map((d) => d.param),
    );
    return this.frameworkOptions().filter((o) => !selected.has(o.param));
  });

  private readonly descriptorsById = new Map(FRAMEWORK_DESCRIPTORS.map((d) => [d.id, d]));

  /** Selected framework filters → their generated (restrict-whitelist) rules, grouped by param. */
  readonly frameworkRuleGroups = computed(() => {
    const options = new Map(this.frameworkOptions().map((o) => [o.param, o]));
    const groups = new Map<string, PathFilter[]>();
    for (const dyn of this.dynamicFilters()) {
      if (dyn.type !== 'framework') continue;
      const option = options.get(dyn.param);
      const descriptor = option && this.descriptorsById.get(option.descriptorId);
      if (option && descriptor) groups.set(dyn.param, frameworkToRules(descriptor, option.roots));
    }
    return groups;
  });

  /** All enabled framework filters' rules, flattened (order within is irrelevant — all restrict). */
  readonly generatedFrameworkRules = computed<PathFilter[]>(() => {
    const groups = this.frameworkRuleGroups();
    const rules: PathFilter[] = [];
    for (const dyn of this.dynamicFilters()) {
      if (dyn.type === 'framework' && dyn.enabled) rules.push(...(groups.get(dyn.param) ?? []));
    }
    return rules;
  });

  /** The refined label for a whole kind: `Java / Quarkus` if *any* of its roots' poms say so. */
  private refinedKindLabel(descriptor: FrameworkDescriptor, roots: readonly string[]): string {
    for (const root of roots) {
      const marker = descriptor.labelPeekMarker?.(root);
      const content = marker ? this.frameworkMarkerContentByPath().get(marker) : undefined;
      const refined = content ? descriptor.refineLabel?.(content) : null;
      if (refined) return refined;
    }
    return descriptor.label;
  }

  /**
   * The quick-access framework toggles rendered as a footer under the tree — one per detected
   * framework *kind* (aggregate across all its roots), labelled by its short name (`Java / Quarkus`
   * → `Quarkus`). Toggling one restricts the tree to that kind's files; untoggling shows everything;
   * several toggled compose as a union.
   */
  readonly frameworkQuickAccess = computed(() => {
    const rootsByKind = new Map<string, { descriptor: FrameworkDescriptor; roots: string[] }>();
    for (const { root, descriptor } of this.detectedProjects()) {
      const entry = rootsByKind.get(descriptor.id) ?? { descriptor, roots: [] };
      entry.roots.push(root);
      rootsByKind.set(descriptor.id, entry);
    }
    const active = this.activeFrameworkKinds();
    return [...rootsByKind.values()].map(({ descriptor, roots }) => ({
      id: descriptor.id,
      label: lastLabelSegment(this.refinedKindLabel(descriptor, roots)),
      active: active.has(descriptor.id),
    }));
  });

  /** Restrict whitelist rules for every toggled quick-access kind (aggregate over all its roots). */
  readonly generatedQuickFrameworkRules = computed<PathFilter[]>(() => {
    const active = this.activeFrameworkKinds();
    if (active.size === 0) return [];
    const rootsByKind = new Map<string, string[]>();
    for (const { root, descriptor } of this.detectedProjects()) {
      if (!active.has(descriptor.id)) continue;
      const list = rootsByKind.get(descriptor.id);
      if (list) list.push(root);
      else rootsByKind.set(descriptor.id, [root]);
    }
    const rules: PathFilter[] = [];
    for (const [id, roots] of rootsByKind) {
      const descriptor = this.descriptorsById.get(id);
      if (descriptor) rules.push(...frameworkToRules(descriptor, roots));
    }
    return rules;
  });

  /**
   * Quick-access framework rules and dialog framework rules first (a restrict-whitelist must lead to
   * set the default-hidden stance), then ignorelist rules, then manual rules — so a manual whitelist
   * always wins last.
   */
  readonly effectiveFilters = computed(() => [
    ...this.generatedQuickFrameworkRules(),
    ...this.generatedFrameworkRules(),
    ...this.generatedDynamicRules(),
    ...this.filters(),
  ]);

  readonly hasActiveFilters = computed(() =>
    this.effectiveFilters().some((f) => f.enabled && f.query.trim() !== ''),
  );

  /** Paths after both the dialog filters and the top input. */
  readonly filteredPaths = computed(() =>
    filterFilePaths(this.allEagerPaths(), this.effectiveFilters(), this.nameQuery()),
  );

  /**
   * What the tree actually renders: {@link filteredPaths} minus test files reachable via a visible
   * source's Test tab (they'd be redundant in the tree). "Reachable" is computed with the exact same
   * {@link linkedTestsOf} primitive the viewer's tabs use — a test is hidden iff some visible source
   * would surface it as a tab. Skipped while name-searching, so a test can still be found by name.
   */
  readonly treeVisiblePaths = computed(() => {
    const visible = this.filteredPaths();
    if (this.nameQuery().trim() !== '') return visible;
    const projects = this.detectedProjects();
    const all = this.allEagerPaths();
    const visibleSet = new Set(visible);
    const hidden = new Set<string>();
    for (const source of visible) {
      for (const test of linkedTestsOf(source, projects, all)) {
        if (visibleSet.has(test)) hidden.add(test);
      }
    }
    return hidden.size === 0 ? visible : visible.filter((p) => !hidden.has(p));
  });

  /** Paths after only the dialog filters — the dialog's "visible files" preview. */
  readonly dialogVisiblePaths = computed(() =>
    applyPathFilters(this.allEagerPaths(), this.effectiveFilters()),
  );

  readonly dialogVisiblePreview = computed(() =>
    this.dialogVisiblePaths().slice(0, VISIBLE_PREVIEW_LIMIT),
  );

  /** True when any filter (including the quick-access footer) narrows the tree — drives the hint. */
  protected readonly isFiltering = computed(
    () => this.nameQuery().trim() !== '' || this.hasActiveFilters(),
  );

  /** Active filters other than the quick-access footer toggles. */
  private readonly hasNonQuickFilters = computed(() =>
    [...this.generatedFrameworkRules(), ...this.generatedDynamicRules(), ...this.filters()].some(
      (f) => f.enabled && f.query.trim() !== '',
    ),
  );

  /**
   * Whether to auto-expand the whole tree to reveal matches. A name query, manual rule, or dialog
   * dynamic filter is a *search* → expand so deep matches are visible. The quick-access footer
   * toggles are deliberately excluded: they narrow the tree for *browsing* and must leave it
   * collapsed (expanding every directory on a framework toggle is jarring).
   */
  protected readonly expandTreeForFilter = computed(
    () => this.nameQuery().trim() !== '' || this.hasNonQuickFilters(),
  );

  /**
   * Unopened lazy directories the active filter therefore can't see inside — surfaced as a hint so
   * "no match" never silently hides files the user simply hasn't loaded yet.
   */
  readonly unsearchedLazyCount = computed(() => {
    if (!this.isFiltering()) return 0;
    const loaded = this.loadedLazyListings();
    let count = 0;
    for (const dir of this.allLazyDirs().keys()) if (!loaded.has(dir)) count++;
    return count;
  });

  /**
   * The rendered forest: the filtered eager files built into a tree, with a lazy stub injected for
   * every unopened lazy directory (present as a collapsed, openable folder with a child count),
   * then single-child chains compacted (`src / main / java`). Lazy stubs are compaction boundaries,
   * so they never fold into a chain. Derived, so a filter change or a freshly-loaded lazy level
   * re-splices in the same pass.
   */
  private readonly compaction = computed(() => {
    const loaded = this.loadedLazyListings();
    const counts = this.allLazyDirs();
    const opened = new Set(this.openedLazyPaths());

    // Unopened (still-stub) lazy dirs get a sentinel leaf so build-file-tree materialises the dir
    // node; a loaded lazy dir is a normal directory (its eager files are already in filteredPaths).
    const items: HasPath[] = this.treeVisiblePaths().map((path) => ({ path }));
    const stubs: string[] = [];
    for (const dir of counts.keys()) {
      if (!loaded.has(dir)) {
        stubs.push(dir);
        items.push({ path: `${dir}/${LAZY_SENTINEL}` });
      }
    }

    const built = buildFileTree(items, { expanded: false, icons: true });
    markLazyStubs(built, new Set(stubs), counts, opened);

    const chains: CompactedChain[] = [];
    const nodes = compactFileTree(built, { chains, separator: CHAIN_SEPARATOR });
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

  /** Session-only memory of the rendered/source choice, keyed by smart-renderer id. */
  private readonly rendererModes = signal<ReadonlyMap<string, FileViewMode>>(new Map());

  /** The viewer mode for the open file: rendered by default when a smart renderer matches. */
  readonly viewerMode = computed<FileViewMode>(() => {
    const path = this.selectedPath();
    const renderer = path ? findRenderer(path) : undefined;
    return renderer ? (this.rendererModes().get(renderer.id) ?? 'rendered') : 'source';
  });

  setViewerMode(mode: FileViewMode): void {
    const path = this.selectedPath();
    const renderer = path ? findRenderer(path) : undefined;
    if (!renderer) {
      return;
    }
    this.rendererModes.update((modes) => new Map(modes).set(renderer.id, mode));
  }

  /** A rendered relative link resolved to a repo path: open it in the browser. */
  openLinkedPath(target: string): void {
    if (!this.allEagerPaths().includes(target)) {
      return; // dead link (missing file or a directory) — silent no-op
    }
    this.selectedPath.set(target);
    const treeService = this.treeCmp()?.treeService;
    if (!treeService) {
      return;
    }
    treeService.selectedKeys.set(new Set([target]));
    // Expand every ancestor prefix so the node is visible. Safe with chain compaction: the
    // mirroring effect in the constructor reconciles absorbed keys and only writes on a delta.
    const parts = target.split('/');
    for (let i = 1; i < parts.length; i++) {
      treeService.expand(parts.slice(0, i).join('/'));
    }
  }

  /**
   * The opened file's linked group — the file plus its detected test/code counterpart(s). ≥2 entries
   * drive the viewer's tab strip; each tab just re-points {@link selectedPath} (the content query,
   * reference chips, and view mode are all keyed per path, so they follow for free).
   */
  readonly linkedGroup = computed<LinkedFile[]>(() => {
    const path = this.selectedPath();
    return path ? resolveLinkedGroup(path, this.detectedProjects(), this.allEagerPaths()) : [];
  });

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
    // The placeholder under a loading lazy stub is not a real file — ignore clicks on it.
    if (node.key.endsWith(`/${LAZY_SENTINEL}`)) {
      return;
    }
    // Leaves are files; their key is the full path.
    if (node.leaf) {
      this.selectedPath.set(node.key);
      return;
    }
    // Clicking a folder row toggles it, like its chevron — and must not steal the selection
    // highlight from the open file (the tree already selected the folder before this fires).
    const treeService = this.treeCmp()?.treeService;
    if (!treeService) return;
    treeService.toggle(node.key);
    const selected = this.selectedPath();
    treeService.selectedKeys.set(new Set(selected ? [selected] : []));
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

  /** Replace the whole filter list (programmatic entry point). Older filter shapes are migrated. */
  setFilters(filters: LegacyPathFilter[]): void {
    this.filters.set(filters.map(migratePathFilter));
  }

  /** Append a filter, returning its generated id. Defaults to an enabled, empty "includes" whitelist. */
  addFilter(partial: Partial<Omit<PathFilter, 'id'>> = {}): string {
    const id = `f${++this.filterSeq}`;
    const filter: PathFilter = {
      id,
      kind: partial.kind ?? 'includes',
      mode: partial.mode ?? 'whitelist',
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

  /** Toggle a manual rule between whitelist (show matches) and blacklist (hide matches). */
  setMode(id: string, mode: PathFilterMode): void {
    this.updateFilter(id, { mode });
  }

  /** Move a manual rule one position earlier (a rule's position is its evaluation order). */
  moveFilterUp(id: string): void {
    this.filters.update((filters) => this.swapByIndex(filters, id, -1));
  }

  /** Move a manual rule one position later. */
  moveFilterDown(id: string): void {
    this.filters.update((filters) => this.swapByIndex(filters, id, +1));
  }

  private swapByIndex(filters: PathFilter[], id: string, delta: number): PathFilter[] {
    const i = filters.findIndex((f) => f.id === id);
    const j = i + delta;
    if (i === -1 || j < 0 || j >= filters.length) return filters;
    const next = [...filters];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  }

  // --- Dynamic (ignorelist) filters ---

  /** Select a dynamic filter of the given kind (idempotent — dedupes on type + param). */
  addDynamicFilter(type: DynamicFilter['type'], param: string): void {
    this.dynamicFilters.update((filters) =>
      filters.some((d) => d.type === type && d.param === param)
        ? filters
        : [...filters, { id: `d${++this.dynamicSeq}`, type, param, enabled: true }],
    );
  }

  /** The display label for a selected dynamic-filter row (framework label, or ignore-file name). */
  protected dynamicLabel(dyn: DynamicFilter): string {
    if (dyn.type === 'framework') {
      return this.frameworkOptions().find((o) => o.param === dyn.param)?.label ?? dyn.param;
    }
    return dyn.param;
  }

  /** The generated rules for a selected dynamic-filter row — the dialog's read-only view. */
  protected dynamicRules(dyn: DynamicFilter): PathFilter[] {
    const groups = dyn.type === 'framework' ? this.frameworkRuleGroups() : this.dynamicRuleGroups();
    return groups.get(dyn.param) ?? [];
  }

  /** Toggle a quick-access framework kind on/off (an aggregate filter over all its detected roots). */
  toggleFrameworkKind(id: string): void {
    this.activeFrameworkKinds.update((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** The label for a test↔code tab: its role, capitalised. */
  protected tabLabel(file: LinkedFile): string {
    return file.role === 'test' ? 'Test' : 'Code';
  }

  removeDynamicFilter(id: string): void {
    this.dynamicFilters.update((filters) => filters.filter((d) => d.id !== id));
  }

  toggleDynamicFilter(id: string): void {
    this.dynamicFilters.update((filters) =>
      filters.map((d) => (d.id === id ? { ...d, enabled: !d.enabled } : d)),
    );
  }

  protected toggleDynamicExpanded(id: string): void {
    this.expandedDynamic.update((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  protected isDynamicExpanded(id: string): boolean {
    return this.expandedDynamic().has(id);
  }

  /** Coerce a z-input model value (string | number | null | undefined) to a string. */
  protected str(value: unknown): string {
    return value == null ? '' : String(value);
  }

  /** The ancestor prefix of a compacted breadcrumb label (`a / b / ` for `a / b / c`), else ''. */
  protected breadcrumbPrefix(label: string): string {
    const i = label.lastIndexOf(this.chainSeparator);
    return i === -1 ? '' : label.slice(0, i + this.chainSeparator.length);
  }

  /** The final segment of a compacted breadcrumb label (`c` for `a / b / c`), else the whole label. */
  protected breadcrumbLeaf(label: string): string {
    const i = label.lastIndexOf(this.chainSeparator);
    return i === -1 ? label : label.slice(i + this.chainSeparator.length);
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
