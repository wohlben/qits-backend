import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { NEVER, of } from 'rxjs';
import { vi } from 'vitest';

import type { TreeNode } from '@/shared/components/tree/tree.types';
import type { HasPath } from '@/shared/utils/build-file-tree';

/** Recursively find a tree node by key (lazy children may be nested arbitrarily deep). */
function findNode(nodes: TreeNode<HasPath>[], key: string): TreeNode<HasPath> | undefined {
  for (const node of nodes) {
    if (node.key === key) return node;
    const found = node.children && findNode(node.children, key);
    if (found) return found;
  }
  return undefined;
}

import { WorkspaceControllerService } from '@/api/api/workspaceController.service';
import { ZardTreeComponent } from '@/shared/components/tree/tree.component';
import { EDarkModes, ZardDarkMode } from '@/shared/services/dark-mode';
import { PromptContextStore } from '@/shared/state/prompt-context.store';
import { WorkspaceFileBrowserComponent } from './workspace-file-browser.component';

const PATHS = ['README.md', 'domain/src/App.java', 'domain/src/AppTest.java', 'service/main.ts'];

describe('WorkspaceFileBrowserComponent', () => {
  const workspaceService = {
    apiRepositoriesRepoIdWorkspacesWorkspaceIdFilesGet: vi.fn().mockReturnValue(of({ paths: PATHS })),
    apiRepositoriesRepoIdWorkspacesWorkspaceIdFilesContentGet: vi
      .fn()
      .mockReturnValue(of({ path: 'README.md', content: '# Title\n', binary: false })),
  };
  const darkMode = { themeMode: () => EDarkModes.LIGHT };
  let queryClient: QueryClient;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Seeded data is the source of truth in these tests — never let it go stale and refetch from
    // the blanket mocks (which would clobber per-test file lists / ignore-file contents).
    queryClient = new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity, retry: false, refetchOnMount: false } },
    });
    // Seed the file list so `filteredPaths`/`tree` are deterministic without awaiting a fetch.
    queryClient.setQueryData(['workspace-files', 'repo-1', 'wt-1'], { paths: PATHS, lazyDirs: [] });

    await TestBed.configureTestingModule({
      imports: [WorkspaceFileBrowserComponent],
      providers: [
        provideTanStackQuery(queryClient),
        { provide: WorkspaceControllerService, useValue: workspaceService },
        { provide: ZardDarkMode, useValue: darkMode },
      ],
    }).compileComponents();
  });

  function createComponent() {
    const fixture = TestBed.createComponent(WorkspaceFileBrowserComponent);
    fixture.componentRef.setInput('repoId', 'repo-1');
    fixture.componentRef.setInput('workspaceId', 'wt-1');
    fixture.detectChanges();
    return fixture;
  }

  it('collects a selected range as a reference and de-dupes identical ones', () => {
    const cmp = createComponent().componentInstance;
    cmp.selectedPath.set('README.md');

    cmp.addReference({ startLine: 2, endLine: 5 });
    cmp.addReference({ startLine: 2, endLine: 5 }); // duplicate — ignored
    cmp.addReference({ startLine: 8, endLine: 8 });

    expect(cmp.references()).toEqual([
      { path: 'README.md', startLine: 2, endLine: 5 },
      { path: 'README.md', startLine: 8, endLine: 8 },
    ]);
  });

  it('exposes only the current file’s references as viewer highlights', () => {
    const cmp = createComponent().componentInstance;

    cmp.selectedPath.set('README.md');
    cmp.addReference({ startLine: 1, endLine: 1 });
    cmp.selectedPath.set('src/app/main.ts');
    cmp.addReference({ startLine: 10, endLine: 12 });

    // highlights reflect the now-open file only
    expect(cmp.currentHighlights()).toEqual([{ startLine: 10, endLine: 12 }]);
  });

  it('removes a reference', () => {
    const cmp = createComponent().componentInstance;
    cmp.selectedPath.set('README.md');
    cmp.addReference({ startLine: 3, endLine: 4 });

    const [ref] = cmp.references();
    cmp.removeReference(ref);

    expect(cmp.references()).toEqual([]);
  });

  it('stages references in the shared PromptContextStore, not component-local state', () => {
    const cmp = createComponent().componentInstance;
    const store = TestBed.inject(PromptContextStore);
    cmp.selectedPath.set('README.md');

    cmp.addReference({ startLine: 2, endLine: 5 });
    expect(store.references()).toEqual([{ path: 'README.md', startLine: 2, endLine: 5 }]);

    // Removing from the store side (e.g. a Chat-tab row) empties the chips too — same slice.
    store.removeReference({ path: 'README.md', startLine: 2, endLine: 5 });
    expect(cmp.references()).toEqual([]);
  });

  it('exposes a programmatic filter API (add / update / remove / clear)', () => {
    const cmp = createComponent().componentInstance;

    const id = cmp.addFilter({ kind: 'includes', query: 'domain' });
    expect(cmp.filters()).toEqual([
      { id, kind: 'includes', mode: 'whitelist', query: 'domain', enabled: true },
    ]);
    expect(cmp.hasActiveFilters()).toBe(true);

    cmp.updateFilter(id, { query: 'service', enabled: false });
    expect(cmp.filters()[0]).toMatchObject({ query: 'service', enabled: false });
    expect(cmp.hasActiveFilters()).toBe(false); // disabled → not active

    cmp.removeFilter(id);
    expect(cmp.filters()).toEqual([]);
  });

  it('narrows visible paths by the ordered rule list, migrating the legacy `excludes` kind', () => {
    const cmp = createComponent().componentInstance;

    // a lone whitelist restricts to matches (leads with a manual whitelist → default hidden)
    cmp.setFilters([{ id: 'a', kind: 'includes', query: 'domain', enabled: true }]);
    expect(cmp.filteredPaths()).toEqual(['domain/src/App.java', 'domain/src/AppTest.java']);

    // legacy `excludes` migrates to an `includes` blacklist; whitelist-then-blacklist subtracts
    cmp.setFilters([
      { id: 'a', kind: 'includes', query: 'domain', enabled: true },
      { id: 'b', kind: 'excludes', query: 'Test', enabled: true },
    ]);
    expect(cmp.filters()[1]).toMatchObject({ kind: 'includes', mode: 'blacklist' });
    expect(cmp.filteredPaths()).toEqual(['domain/src/App.java']);
  });

  it('reorders rules and toggles mode (last-match-wins depends on both)', () => {
    const cmp = createComponent().componentInstance;

    // lead with a blacklist so the default stays visible, then whitelist one file back in
    const bl = cmp.addFilter({ kind: 'includes', query: 'domain', mode: 'blacklist' });
    const wl = cmp.addFilter({ kind: 'exact', query: 'domain/src/App.java', mode: 'whitelist' });
    // blacklist hides both domain files, the trailing whitelist resurrects App.java; others stay
    expect(cmp.filteredPaths()).toEqual(['README.md', 'domain/src/App.java', 'service/main.ts']);

    // move the whitelist above the blacklist → the list now leads with a whitelist (stance flips to
    // "show only"), and the trailing blacklist gets the last word on App.java → nothing survives
    cmp.moveFilterUp(wl);
    expect(cmp.filters().map((f) => f.id)).toEqual([wl, bl]);
    expect(cmp.filteredPaths()).toEqual([]);

    // flip the (now-trailing) rule to whitelist too → a whitelist-led list restricts to domain
    cmp.setMode(bl, 'whitelist');
    expect(cmp.filteredPaths()).toEqual(['domain/src/App.java', 'domain/src/AppTest.java']);
  });

  it('applies the top name query as a final filename pass; the dialog list ignores it', () => {
    const cmp = createComponent().componentInstance;
    cmp.setFilters([{ id: 'a', kind: 'includes', query: 'domain', enabled: true }]);
    cmp.nameQuery.set('apptest');

    // final filename pass keeps only AppTest.java
    expect(cmp.filteredPaths()).toEqual(['domain/src/AppTest.java']);
    // the dialog's "visible files" preview reflects only the dialog filters
    expect(cmp.dialogVisiblePaths()).toEqual(['domain/src/App.java', 'domain/src/AppTest.java']);
  });

  describe('dynamic ignorelist filters', () => {
    const DYN_PATHS = [
      '.gitignore',
      'src/.gitignore',
      'src/app.ts',
      'src/app.spec.ts',
      'dist/bundle.js',
      'keep.log',
      'debug.log',
    ];

    function seedContent(path: string, content: string) {
      queryClient.setQueryData(['workspace-file', 'repo-1', 'wt-1', path], { path, content, binary: false });
    }

    beforeEach(() => {
      queryClient.setQueryData(['workspace-files', 'repo-1', 'wt-1'], { paths: DYN_PATHS, lazyDirs: [] });
    });

    it('offers ignore-file basenames de-duplicated, and only when present', () => {
      const cmp = createComponent().componentInstance;
      // two `.gitignore` files (root + src) collapse to a single picker entry
      expect(cmp.ignorelistBasenames()).toEqual(['.gitignore']);
      expect(cmp.availableIgnorelistParams()).toEqual(['.gitignore']);

      // a workspace with no ignore files offers nothing
      queryClient.setQueryData(['workspace-files', 'repo-1', 'wt-1'], {
        paths: ['a.ts', 'b.ts'],
        lazyDirs: [],
      });
      const bare = createComponent().componentInstance;
      expect(bare.ignorelistBasenames()).toEqual([]);
    });

    it('generates locality-scoped rules from ignore-file contents and regenerates on change', async () => {
      seedContent('.gitignore', '*.log\n!keep.log\n');
      seedContent('src/.gitignore', 'app.spec.ts\n');
      const fixture = createComponent();
      const cmp = fixture.componentInstance;

      cmp.addDynamicFilter('ignorelist', '.gitignore');
      fixture.detectChanges();

      // root: hide *.log but re-include keep.log; src/.gitignore hides only src/**/app.spec.ts
      expect(cmp.filteredPaths()).toEqual([
        '.gitignore',
        'src/.gitignore',
        'src/app.ts',
        'dist/bundle.js',
        'keep.log',
      ]);

      // editing the mocked content re-derives the rules: app.spec.ts comes back. The cache update
      // reaches the query observer on a microtask, so poll rather than assert synchronously.
      seedContent('src/.gitignore', '');
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(cmp.filteredPaths()).toContain('src/app.spec.ts');
      });
    });

    it('lets a manual whitelist resurrect a file a dynamic filter hid (dynamic rules apply first)', () => {
      seedContent('.gitignore', '*.log\n');
      const fixture = createComponent();
      const cmp = fixture.componentInstance;

      cmp.addDynamicFilter('ignorelist', '.gitignore');
      fixture.detectChanges();
      expect(cmp.filteredPaths()).not.toContain('debug.log');

      cmp.addFilter({ kind: 'exact', query: 'debug.log', mode: 'whitelist' });
      // the manual whitelist (applied after the generated rules) brings debug.log back…
      expect(cmp.filteredPaths()).toContain('debug.log');
      // …without hiding the rest, and keep.log stays hidden (still caught by *.log)
      expect(cmp.filteredPaths()).toContain('src/app.ts');
      expect(cmp.filteredPaths()).not.toContain('keep.log');
    });

    it('de-dupes a dynamic filter and disabling it restores every path', () => {
      seedContent('.gitignore', '*.log\n');
      const fixture = createComponent();
      const cmp = fixture.componentInstance;

      cmp.addDynamicFilter('ignorelist', '.gitignore');
      cmp.addDynamicFilter('ignorelist', '.gitignore'); // idempotent
      expect(cmp.dynamicFilters().length).toBe(1);
      fixture.detectChanges();
      expect(cmp.filteredPaths()).not.toContain('debug.log');

      cmp.toggleDynamicFilter(cmp.dynamicFilters()[0].id);
      fixture.detectChanges();
      expect(cmp.filteredPaths()).toEqual(DYN_PATHS);
    });
  });

  describe('lazy directory exploration', () => {
    it('renders an unopened lazy directory as a stub with a child-count label', () => {
      queryClient.setQueryData(['workspace-files', 'repo-1', 'wt-1'], {
        paths: ['README.md'],
        lazyDirs: [{ path: 'node_modules', childCount: 312, href: '/x' }],
      });
      const cmp = createComponent().componentInstance;

      const stub = cmp.tree().find((n) => n.key === 'node_modules');
      expect(stub?.lazy).toBe(true);
      expect(stub?.label).toBe('node_modules (312)');
      expect(stub?.leaf).toBeFalsy();
      expect(stub?.children?.length).toBe(1); // a placeholder child so the chevron shows
    });

    it('fetches and splices a lazy directory’s children when it is expanded', () => {
      queryClient.setQueryData(['workspace-files', 'repo-1', 'wt-1'], {
        paths: ['README.md'],
        lazyDirs: [{ path: 'node_modules', childCount: 2, href: '/x' }],
      });
      queryClient.setQueryData(['workspace-files', 'repo-1', 'wt-1', 'node_modules'], {
        dir: 'node_modules',
        paths: ['node_modules/index.js', 'node_modules/util.js'],
        lazyDirs: [],
      });
      const fixture = createComponent();
      const cmp = fixture.componentInstance;
      const treeService = fixture.debugElement.query(By.directive(ZardTreeComponent))
        .componentInstance.treeService;

      // expanding (chevron or row) updates expandedKeys → the effect opens+loads the dir
      treeService.expand('node_modules');
      fixture.detectChanges();
      fixture.detectChanges();

      expect(cmp.openedLazyPaths()).toContain('node_modules');
      const nm = cmp.tree().find((n) => n.key === 'node_modules');
      expect(nm?.lazy).toBeFalsy(); // now a real directory
      expect(nm?.children?.map((c) => c.label)).toEqual(['index.js', 'util.js']);
    });

    it('shows a Loading… placeholder while an opened lazy directory is still fetching', () => {
      queryClient.setQueryData(['workspace-files', 'repo-1', 'wt-1'], {
        paths: ['README.md'],
        lazyDirs: [{ path: 'node_modules', childCount: 5, href: '/x' }],
      });
      // the per-directory fetch never resolves → the dir stays in a loading state
      workspaceService.apiRepositoriesRepoIdWorkspacesWorkspaceIdFilesGet.mockImplementation(
        (_repo: string, _wt: string, path?: string) =>
          path === 'node_modules' ? NEVER : of({ paths: ['README.md'], lazyDirs: [] }),
      );
      const fixture = createComponent();
      const cmp = fixture.componentInstance;

      cmp.openedLazyPaths.set(['node_modules']);
      fixture.detectChanges();

      const stub = cmp.tree().find((n) => n.key === 'node_modules');
      expect(stub?.lazy).toBe(true); // still a stub — its listing hasn't arrived
      expect(stub?.children?.[0].label).toBe('Loading…');
    });

    it('keeps a nested ignored subdirectory lazy after its parent is opened', () => {
      queryClient.setQueryData(['workspace-files', 'repo-1', 'wt-1'], {
        paths: ['README.md'],
        lazyDirs: [{ path: 'node_modules', childCount: 1, href: '/x' }],
      });
      queryClient.setQueryData(['workspace-files', 'repo-1', 'wt-1', 'node_modules'], {
        dir: 'node_modules',
        paths: [],
        lazyDirs: [{ path: 'node_modules/pkg', childCount: 3, href: '/y' }],
      });
      const fixture = createComponent();
      const cmp = fixture.componentInstance;

      cmp.openedLazyPaths.set(['node_modules']);
      fixture.detectChanges();

      // node_modules resolved to a real dir; its child pkg is still a lazy stub
      const pkg = findNode(cmp.tree(), 'node_modules/pkg');
      expect(pkg?.lazy).toBe(true);
      expect(pkg?.label).toBe('pkg (3)');
    });

    it('never auto-opens lazy dirs while filtering, and hints they were not searched', () => {
      queryClient.setQueryData(['workspace-files', 'repo-1', 'wt-1'], {
        paths: ['README.md', 'src/app.ts'],
        lazyDirs: [{ path: 'node_modules', childCount: 9, href: '/x' }],
      });
      const fixture = createComponent();
      const cmp = fixture.componentInstance;

      cmp.nameQuery.set('app'); // triggers expand-all, which must skip the lazy stub
      fixture.detectChanges();
      fixture.detectChanges();

      expect(cmp.openedLazyPaths()).toEqual([]); // no fetch was triggered
      expect(cmp.tree().find((n) => n.key === 'node_modules')?.lazy).toBe(true);
      expect(cmp.unsearchedLazyCount()).toBe(1);
    });
  });

  it('compacts single-child directory chains in the rendered tree', () => {
    const cmp = createComponent().componentInstance;

    // `domain` → `src` is a pure chain; `service` → `main.ts` compacts into a leaf.
    expect(cmp.tree().map((n) => n.label)).toEqual([
      'domain / src',
      'service / main.ts',
      'README.md',
    ]);
    const serviceLeaf = cmp.tree()[1];
    expect(serviceLeaf.leaf).toBe(true);
    expect(serviceLeaf.key).toBe('service/main.ts');
  });

  it('re-derives compaction from filters: hiding a sibling forms a chain, revealing it splits the chain back', () => {
    const cmp = createComponent().componentInstance;

    cmp.setFilters([{ id: 'a', kind: 'excludes', query: 'Test', enabled: true }]);
    // App.java is now domain/src's only descendant — the whole path compacts into one leaf row
    const compacted = cmp.tree().find((n) => n.key === 'domain/src/App.java');
    expect(compacted?.label).toBe('domain / src / App.java');
    expect(compacted?.leaf).toBe(true);

    cmp.clearFilters();
    // the hidden sibling is visible again → the chain resolves back in the same derivation pass
    const resolved = cmp.tree().find((n) => n.key === 'domain/src');
    expect(resolved?.label).toBe('domain / src');
    expect(resolved?.children?.map((c) => c.label)).toEqual(['App.java', 'AppTest.java']);
  });

  it('keeps the user "inside the chain" when a filter change splits a compacted node', () => {
    queryClient.setQueryData(['workspace-files', 'repo-1', 'wt-1'], {
      paths: ['src/main/java/A.java', 'src/main/java/B.java', 'src/main/resources/app.properties'],
      lazyDirs: [],
    });
    const fixture = createComponent();
    const cmp = fixture.componentInstance;
    const treeService = fixture.debugElement.query(By.directive(ZardTreeComponent))
      .componentInstance.treeService;

    cmp.setFilters([{ id: 'x', kind: 'excludes', query: 'resources', enabled: true }]);
    fixture.detectChanges();
    fixture.detectChanges(); // let the expand-all and expansion-sync effects settle

    expect(cmp.tree().map((n) => n.label)).toEqual(['src / main / java']);
    // filtering auto-expands the compacted node (zExpandAll)…
    expect(treeService.isExpanded('src/main/java')).toBe(true);
    // …and the sync effect mirrors that onto the absorbed ancestor dirs
    expect(treeService.isExpanded('src')).toBe(true);
    expect(treeService.isExpanded('src/main')).toBe(true);

    cmp.clearFilters();
    fixture.detectChanges();

    // the chain split at src/main; both it and the java branch are still open
    expect(cmp.tree()[0].label).toBe('src / main');
    expect(cmp.tree()[0].children?.map((c) => c.label)).toEqual([
      'java',
      'resources / app.properties',
    ]);
    expect(treeService.isExpanded('src/main')).toBe(true);
    expect(treeService.isExpanded('src/main/java')).toBe(true);
  });

  it('keeps a filtered-to-one-file path visible after the filter clears (leaf chains count as open)', () => {
    const fixture = createComponent();
    const cmp = fixture.componentInstance;
    const treeService = fixture.debugElement.query(By.directive(ZardTreeComponent))
      .componentInstance.treeService;

    cmp.nameQuery.set('apptest');
    fixture.detectChanges();
    fixture.detectChanges(); // let the expansion-sync effect settle

    // the sole match compacts into a leaf row; its absorbed dirs are marked open
    expect(cmp.tree().map((n) => n.label)).toEqual(['domain / src / AppTest.java']);
    expect(treeService.isExpanded('domain')).toBe(true);
    expect(treeService.isExpanded('domain/src')).toBe(true);

    cmp.nameQuery.set('');
    fixture.detectChanges();

    // chain resolved back into a dir chain whose key is already expanded → the file stays visible
    const resolved = cmp.tree().find((n) => n.key === 'domain/src');
    expect(resolved?.children?.map((c) => c.label)).toEqual(['App.java', 'AppTest.java']);
    expect(treeService.isExpanded('domain/src')).toBe(true);
  });

  it('defaults markdown to the rendered view and everything else to source', () => {
    const cmp = createComponent().componentInstance;

    cmp.selectedPath.set('README.md');
    expect(cmp.viewerMode()).toBe('rendered');

    cmp.selectedPath.set('service/main.ts');
    expect(cmp.viewerMode()).toBe('source');
  });

  it('remembers the chosen mode per file type for the session', () => {
    const cmp = createComponent().componentInstance;

    cmp.selectedPath.set('README.md');
    cmp.setViewerMode('source');
    expect(cmp.viewerMode()).toBe('source');

    // another markdown file inherits the choice (per type, not per file)
    cmp.selectedPath.set('docs/notes.md');
    expect(cmp.viewerMode()).toBe('source');

    // a file without a renderer is unaffected, and setting a mode there is a no-op
    cmp.selectedPath.set('service/main.ts');
    cmp.setViewerMode('rendered');
    expect(cmp.viewerMode()).toBe('source');
    cmp.selectedPath.set('docs/notes.md');
    expect(cmp.viewerMode()).toBe('source');
  });

  it('opens a resolved relative link: selects the file and expands its ancestors in the tree', () => {
    const fixture = createComponent();
    const cmp = fixture.componentInstance;
    const treeService = fixture.debugElement.query(By.directive(ZardTreeComponent))
      .componentInstance.treeService;

    cmp.selectedPath.set('README.md');
    cmp.openLinkedPath('domain/src/App.java');
    fixture.detectChanges();

    expect(cmp.selectedPath()).toBe('domain/src/App.java');
    expect(treeService.selectedKeys()).toEqual(new Set(['domain/src/App.java']));
    expect(treeService.isExpanded('domain')).toBe(true);
    expect(treeService.isExpanded('domain/src')).toBe(true);
  });

  it('ignores links to paths that are not files in the workspace', () => {
    const cmp = createComponent().componentInstance;

    cmp.selectedPath.set('README.md');
    cmp.openLinkedPath('missing.md');
    cmp.openLinkedPath('domain/src'); // a directory, not a file

    expect(cmp.selectedPath()).toBe('README.md');
  });

  it('openClosestMatch with an exact path seeds the filter and selects/reveals the file', () => {
    const fixture = createComponent();
    const cmp = fixture.componentInstance;
    const treeService = fixture.debugElement.query(By.directive(ZardTreeComponent))
      .componentInstance.treeService;

    cmp.openClosestMatch('domain/src/App.java');
    fixture.detectChanges();

    expect(cmp.nameQuery()).toBe('domain/src/App.java');
    expect(cmp.selectedPath()).toBe('domain/src/App.java');
    expect(treeService.selectedKeys()).toEqual(new Set(['domain/src/App.java']));
    expect(treeService.isExpanded('domain')).toBe(true);
    expect(treeService.isExpanded('domain/src')).toBe(true);
  });

  it('openClosestMatch with a stale path selects the closest match instead of nothing', () => {
    const fixture = createComponent();
    const cmp = fixture.componentInstance;

    // The directory moved since the pick: both App files fuzzy-match, the suffix decides.
    cmp.openClosestMatch('domain/App.java');
    fixture.detectChanges();

    expect(cmp.selectedPath()).toBe('domain/src/App.java');
    expect(cmp.nameQuery()).toBe('domain/App.java'); // the seed stays — it explains the narrowed tree
  });

  it('openClosestMatch without a plausible match leaves the filter seeded and selects nothing', () => {
    const fixture = createComponent();
    const cmp = fixture.componentInstance;

    cmp.openClosestMatch('nonexistent/zzz.xyz');
    fixture.detectChanges();

    expect(cmp.selectedPath()).toBeNull();
    expect(cmp.nameQuery()).toBe('nonexistent/zzz.xyz');
    expect(cmp.filteredPaths()).toEqual([]);
  });

  it('defers closest-match resolution until the file list has loaded (deep-link race)', async () => {
    // No seeded cache for this workspace → the component goes through a real (mocked) fetch.
    workspaceService.apiRepositoriesRepoIdWorkspacesWorkspaceIdFilesGet.mockReturnValueOnce(
      of({ paths: PATHS, lazyDirs: [] }),
    );
    const fixture = TestBed.createComponent(WorkspaceFileBrowserComponent);
    fixture.componentRef.setInput('repoId', 'repo-2');
    fixture.componentRef.setInput('workspaceId', 'wt-2');
    const cmp = fixture.componentInstance;

    cmp.openClosestMatch('domain/src/App.java'); // armed before any data exists
    fixture.detectChanges();
    expect(cmp.selectedPath()).toBeNull();

    await vi.waitFor(() => expect(cmp.filesQuery.isSuccess()).toBe(true)); // let the fetch settle
    await fixture.whenStable(); // run the re-scheduled pending-target effect

    expect(cmp.selectedPath()).toBe('domain/src/App.java');
  });

  it('toggles a folder on row click instead of selecting it', () => {
    const fixture = createComponent();
    const cmp = fixture.componentInstance;
    const treeService = fixture.debugElement.query(By.directive(ZardTreeComponent))
      .componentInstance.treeService;
    const folder = cmp.tree().find((n) => n.key === 'domain/src')!;

    cmp.selectedPath.set('README.md');
    treeService.notifyNodeClick(folder); // what a row click sends through the tree
    fixture.detectChanges();
    fixture.detectChanges(); // click effect → zNodeClick handler → expansion sync

    expect(treeService.isExpanded('domain/src')).toBe(true);
    // the open file keeps both the selection state and the highlight
    expect(cmp.selectedPath()).toBe('README.md');
    expect(treeService.selectedKeys()).toEqual(new Set(['README.md']));

    treeService.notifyNodeClick(folder);
    fixture.detectChanges();
    fixture.detectChanges();

    expect(treeService.isExpanded('domain/src')).toBe(false);
  });

  describe('framework filters', () => {
    const FW_PATHS = [
      'pom.xml',
      'service/src/main/webui/angular.json',
      'service/src/main/webui/package.json',
      'service/src/main/webui/src/app/x.ts',
      'service/src/main/webui/src/app/x.spec.ts',
      'src/main/java/com/App.java',
      'src/test/java/com/AppTest.java',
      'docs/plan.md',
      'README.md',
    ];
    const paramFor = (cmp: WorkspaceFileBrowserComponent, id: string) =>
      cmp.frameworkOptions().find((o) => o.descriptorId === id)!.param;

    beforeEach(() => {
      queryClient.setQueryData(['workspace-files', 'repo-1', 'wt-1'], { paths: FW_PATHS, lazyDirs: [] });
    });

    it('offers a per-root filter for java/angular and one aggregate Docs filter', () => {
      const cmp = createComponent().componentInstance;
      const options = cmp.frameworkOptions();
      expect(options.map((o) => o.label).sort()).toEqual([
        'Docs',
        'Java / Maven (root)',
        'TypeScript / Angular (service/src/main/webui)',
      ]);
      expect(options.find((o) => o.descriptorId === 'docs')?.roots).toEqual(['docs']);
    });

    it('upgrades the Java label to Quarkus when the pom content mentions quarkus', async () => {
      queryClient.setQueryData(['workspace-file', 'repo-1', 'wt-1', 'pom.xml'], {
        path: 'pom.xml',
        content: '<dependency>io.quarkus</dependency>',
        binary: false,
      });
      const fixture = createComponent();
      const cmp = fixture.componentInstance;
      const label = () => cmp.frameworkOptions().find((o) => o.descriptorId === 'java-quarkus')?.label;

      // the pom is peeked as soon as a java project is detected (the always-visible footer needs it)
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(label()).toBe('Java / Quarkus (root)');
      });
    });

    it('enabling the Java filter shows only java/pom and hides the webui TS + docs', () => {
      const fixture = createComponent();
      const cmp = fixture.componentInstance;
      cmp.addDynamicFilter('framework', paramFor(cmp, 'java-quarkus'));
      fixture.detectChanges();
      expect(cmp.filteredPaths()).toEqual([
        'pom.xml',
        'src/main/java/com/App.java',
        'src/test/java/com/AppTest.java',
      ]);
    });

    it('enabling java + angular together shows both stacks (union), still hiding docs/README', () => {
      const fixture = createComponent();
      const cmp = fixture.componentInstance;
      cmp.addDynamicFilter('framework', paramFor(cmp, 'java-quarkus'));
      cmp.addDynamicFilter('framework', paramFor(cmp, 'ts-angular'));
      fixture.detectChanges();
      expect([...cmp.filteredPaths()].sort()).toEqual([
        'pom.xml',
        'service/src/main/webui/angular.json',
        'service/src/main/webui/package.json',
        'service/src/main/webui/src/app/x.spec.ts',
        'service/src/main/webui/src/app/x.ts',
        'src/main/java/com/App.java',
        'src/test/java/com/AppTest.java',
      ]);
    });

    it('the Docs filter whitelists the union of every docs dir and hides everything else', () => {
      queryClient.setQueryData(['workspace-files', 'repo-1', 'wt-1'], {
        paths: ['docs/a.md', 'service/docs/b.md', 'src/main.ts', 'README.md'],
        lazyDirs: [],
      });
      const fixture = createComponent();
      const cmp = fixture.componentInstance;
      cmp.addDynamicFilter('framework', 'docs');
      fixture.detectChanges();
      expect(cmp.filteredPaths()).toEqual(['docs/a.md', 'service/docs/b.md']);
    });
  });

  describe('framework root icons', () => {
    const seedPom = (path: string, content: string) =>
      queryClient.setQueryData(['workspace-file', 'repo-1', 'wt-1', path], { path, content, binary: false });

    it('maps a quarkus root to the quarkus mark and an angular root to the shield; skips repo root', async () => {
      queryClient.setQueryData(['workspace-files', 'repo-1', 'wt-1'], {
        paths: [
          'pom.xml',
          'domain/pom.xml',
          'domain/src/main/java/com/D.java',
          'service/src/main/webui/angular.json',
        ],
        lazyDirs: [],
      });
      seedPom('domain/pom.xml', 'io.quarkus'); // up-front so the peek is deterministic (no mock race)
      const fixture = createComponent();
      const cmp = fixture.componentInstance;

      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(cmp.frameworkRootIcons().get('domain')).toBe('/quarkus.svg');
      });
      expect(cmp.frameworkRootIcons().get('service/src/main/webui')).toBe('/angular.svg');
      // the repo-root java project has no folder row → no icon
      expect(cmp.frameworkRootIcons().has('')).toBe(false);
    });

    it('shows the Java cup for a plain (non-quarkus) maven root', async () => {
      queryClient.setQueryData(['workspace-files', 'repo-1', 'wt-1'], {
        paths: ['domain/pom.xml', 'domain/src/main/java/com/D.java'],
        lazyDirs: [],
      });
      seedPom('domain/pom.xml', '<project>plain maven</project>');
      const fixture = createComponent();
      const cmp = fixture.componentInstance;

      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(cmp.frameworkRootIcons().get('domain')).toBe('/java.svg');
      });
    });
  });

  describe('framework quick-access footer', () => {
    const QA_PATHS = [
      'pom.xml',
      'domain/pom.xml',
      'domain/src/main/java/com/D.java',
      'service/src/main/webui/angular.json',
      'service/src/main/webui/src/app/x.ts',
      'src/main/java/com/App.java',
      'docs/plan.md',
      'README.md',
    ];

    beforeEach(() => {
      queryClient.setQueryData(['workspace-files', 'repo-1', 'wt-1'], { paths: QA_PATHS, lazyDirs: [] });
    });

    it('offers one aggregate toggle per framework kind (not per root)', () => {
      const cmp = createComponent().componentInstance;
      // two poms (root + domain) collapse into a single Java toggle
      expect(cmp.frameworkQuickAccess().map((f) => f.label)).toEqual(['Maven', 'Angular', 'Docs']);
    });

    it('shows the short Quarkus label once any pom mentions quarkus', async () => {
      queryClient.setQueryData(['workspace-file', 'repo-1', 'wt-1', 'domain/pom.xml'], {
        path: 'domain/pom.xml',
        content: 'io.quarkus',
        binary: false,
      });
      const fixture = createComponent();
      const cmp = fixture.componentInstance;
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(cmp.frameworkQuickAccess().find((f) => f.id === 'java-quarkus')?.label).toBe('Quarkus');
      });
    });

    it('toggling a kind restricts to it (all roots), untoggling restores everything', () => {
      const cmp = createComponent().componentInstance;
      cmp.toggleFrameworkKind('java-quarkus');
      // aggregate over BOTH java roots ('' and 'domain'): all java + poms, nothing else
      expect(cmp.filteredPaths()).toEqual([
        'pom.xml',
        'domain/pom.xml',
        'domain/src/main/java/com/D.java',
        'src/main/java/com/App.java',
      ]);
      cmp.toggleFrameworkKind('java-quarkus');
      expect(cmp.filteredPaths()).toEqual(QA_PATHS);
    });

    it('narrows the tree without triggering expand-all (unlike a name query or manual rule)', () => {
      const cmp = createComponent().componentInstance;
      cmp.toggleFrameworkKind('java-quarkus');
      // a quick-access toggle filters but must NOT auto-expand every directory…
      expect(cmp['expandTreeForFilter']()).toBe(false);
      // …while a name query or manual rule still does
      cmp.nameQuery.set('App');
      expect(cmp['expandTreeForFilter']()).toBe(true);
      cmp.nameQuery.set('');
      cmp.addFilter({ kind: 'includes', query: 'domain', mode: 'whitelist' });
      expect(cmp['expandTreeForFilter']()).toBe(true);
    });

    it('opens the tree to a framework-aware depth on toggle (java → src/main), not fully', () => {
      // `resources` makes `src/main` a real branch node (not absorbed into a chain); two packages
      // under `com` make it a branch too, so it can stay collapsed below the src/main landing.
      queryClient.setQueryData(['workspace-files', 'repo-1', 'wt-1'], {
        paths: [
          'domain/pom.xml',
          'domain/src/main/java/com/a/A.java',
          'domain/src/main/java/com/b/B.java',
          'domain/src/main/resources/app.properties',
        ],
        lazyDirs: [],
      });
      const fixture = createComponent();
      const cmp = fixture.componentInstance;
      const treeService = fixture.debugElement.query(By.directive(ZardTreeComponent))
        .componentInstance.treeService;

      cmp.toggleFrameworkKind('java-quarkus');
      fixture.detectChanges();
      fixture.detectChanges();

      const expanded = treeService.expandedKeys();
      // opened down to the detected root's src/main…
      expect(expanded.has('domain')).toBe(true);
      expect(expanded.has('domain/src/main')).toBe(true);
      // …but not the deep source packages (framework-aware, not expand-all)
      expect(expanded.has('domain/src/main/java/com')).toBe(false);
    });

    it('several toggled kinds compose as a union (docs + angular)', () => {
      const cmp = createComponent().componentInstance;
      cmp.toggleFrameworkKind('docs');
      cmp.toggleFrameworkKind('ts-angular');
      expect([...cmp.filteredPaths()].sort()).toEqual([
        'docs/plan.md',
        'service/src/main/webui/angular.json',
        'service/src/main/webui/src/app/x.ts',
      ]);
    });
  });

  describe('test↔code tabs', () => {
    const TAB_PATHS = [
      'pom.xml',
      'src/main/java/com/App.java',
      'src/test/java/com/AppTest.java',
      'w/angular.json',
      'w/src/foo.ts',
      'w/src/foo.spec.ts',
      'README.md',
    ];

    beforeEach(() => {
      queryClient.setQueryData(['workspace-files', 'repo-1', 'wt-1'], { paths: TAB_PATHS, lazyDirs: [] });
    });

    it('links a java source to its test symmetrically (code tab first either way)', () => {
      const cmp = createComponent().componentInstance;
      cmp.selectedPath.set('src/main/java/com/App.java');
      expect(cmp.linkedGroup()).toEqual([
        { role: 'code', path: 'src/main/java/com/App.java' },
        { role: 'test', path: 'src/test/java/com/AppTest.java' },
      ]);
      cmp.selectedPath.set('src/test/java/com/AppTest.java');
      expect(cmp.linkedGroup()).toEqual([
        { role: 'code', path: 'src/main/java/com/App.java' },
        { role: 'test', path: 'src/test/java/com/AppTest.java' },
      ]);
    });

    it('hides a linked test from the tree (reachable via its source tab), keeps orphans + name search', () => {
      queryClient.setQueryData(['workspace-files', 'repo-1', 'wt-1'], {
        paths: [...TAB_PATHS, 'src/test/java/com/OrphanTest.java'],
        lazyDirs: [],
      });
      const cmp = createComponent().componentInstance;

      const tree = cmp.treeVisiblePaths();
      // sources stay, their linked tests are hidden…
      expect(tree).toContain('src/main/java/com/App.java');
      expect(tree).not.toContain('src/test/java/com/AppTest.java');
      expect(tree).not.toContain('w/src/foo.spec.ts');
      // …an orphan test (no source) stays visible…
      expect(tree).toContain('src/test/java/com/OrphanTest.java');

      // the hidden test is still reachable as a tab from its source
      cmp.selectedPath.set('src/main/java/com/App.java');
      expect(cmp.linkedGroup().map((f) => f.path)).toContain('src/test/java/com/AppTest.java');

      // …and still findable by name search
      cmp.nameQuery.set('AppTest');
      expect(cmp.treeVisiblePaths()).toContain('src/test/java/com/AppTest.java');
    });

    it('links angular foo.ts ↔ foo.spec.ts, and shows no group for a file without a counterpart', () => {
      const cmp = createComponent().componentInstance;
      cmp.selectedPath.set('w/src/foo.ts');
      expect(cmp.linkedGroup().map((f) => f.path)).toEqual(['w/src/foo.ts', 'w/src/foo.spec.ts']);
      cmp.selectedPath.set('README.md');
      expect(cmp.linkedGroup()).toEqual([]);
    });

    it('keeps each file’s reference chips across a tab switch (references are path-keyed)', () => {
      const cmp = createComponent().componentInstance;
      cmp.selectedPath.set('src/main/java/com/App.java');
      cmp.addReference({ startLine: 1, endLine: 3 });
      expect(cmp.currentHighlights()).toEqual([{ startLine: 1, endLine: 3 }]);

      // switch to the Test tab — the code file's highlight is gone (per-path)…
      cmp.selectedPath.set('src/test/java/com/AppTest.java');
      expect(cmp.currentHighlights()).toEqual([]);
      // …and returns when we switch back
      cmp.selectedPath.set('src/main/java/com/App.java');
      expect(cmp.currentHighlights()).toEqual([{ startLine: 1, endLine: 3 }]);
    });
  });
});
