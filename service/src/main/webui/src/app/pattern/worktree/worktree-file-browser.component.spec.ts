import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { WorktreeControllerService } from '@/api/api/worktreeController.service';
import { ZardTreeComponent } from '@/shared/components/tree/tree.component';
import { EDarkModes, ZardDarkMode } from '@/shared/services/dark-mode';
import { WorktreeFileBrowserComponent } from './worktree-file-browser.component';

const PATHS = ['README.md', 'domain/src/App.java', 'domain/src/AppTest.java', 'service/main.ts'];

describe('WorktreeFileBrowserComponent', () => {
  const worktreeService = {
    apiRepositoriesRepoIdWorktreesWorktreeIdFilesGet: vi.fn().mockReturnValue(of({ paths: PATHS })),
    apiRepositoriesRepoIdWorktreesWorktreeIdFilesContentGet: vi
      .fn()
      .mockReturnValue(of({ path: 'README.md', content: '# Title\n', binary: false })),
  };
  const darkMode = { themeMode: () => EDarkModes.LIGHT };
  let queryClient: QueryClient;

  beforeEach(async () => {
    vi.clearAllMocks();
    queryClient = new QueryClient();
    // Seed the file list so `filteredPaths`/`tree` are deterministic without awaiting a fetch.
    queryClient.setQueryData(['worktree-files', 'repo-1', 'wt-1'], PATHS);

    await TestBed.configureTestingModule({
      imports: [WorktreeFileBrowserComponent],
      providers: [
        provideTanStackQuery(queryClient),
        { provide: WorktreeControllerService, useValue: worktreeService },
        { provide: ZardDarkMode, useValue: darkMode },
      ],
    }).compileComponents();
  });

  function createComponent() {
    const fixture = TestBed.createComponent(WorktreeFileBrowserComponent);
    fixture.componentRef.setInput('repoId', 'repo-1');
    fixture.componentRef.setInput('worktreeId', 'wt-1');
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

  it('exposes a programmatic filter API (add / update / remove / clear)', () => {
    const cmp = createComponent().componentInstance;

    const id = cmp.addFilter({ kind: 'includes', query: 'domain' });
    expect(cmp.filters()).toEqual([{ id, kind: 'includes', query: 'domain', enabled: true }]);
    expect(cmp.hasActiveFilters()).toBe(true);

    cmp.updateFilter(id, { query: 'service', enabled: false });
    expect(cmp.filters()[0]).toMatchObject({ query: 'service', enabled: false });
    expect(cmp.hasActiveFilters()).toBe(false); // disabled → not active

    cmp.removeFilter(id);
    expect(cmp.filters()).toEqual([]);
  });

  it('narrows the visible paths by the dialog filters (union minus excludes)', () => {
    const cmp = createComponent().componentInstance;

    cmp.setFilters([{ id: 'a', kind: 'includes', query: 'domain', enabled: true }]);
    expect(cmp.filteredPaths()).toEqual(['domain/src/App.java', 'domain/src/AppTest.java']);

    cmp.setFilters([
      { id: 'a', kind: 'includes', query: 'domain', enabled: true },
      { id: 'b', kind: 'excludes', query: 'Test', enabled: true },
    ]);
    expect(cmp.filteredPaths()).toEqual(['domain/src/App.java']);
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
    queryClient.setQueryData(
      ['worktree-files', 'repo-1', 'wt-1'],
      ['src/main/java/A.java', 'src/main/java/B.java', 'src/main/resources/app.properties'],
    );
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

  it('ignores links to paths that are not files in the worktree', () => {
    const cmp = createComponent().componentInstance;

    cmp.selectedPath.set('README.md');
    cmp.openLinkedPath('missing.md');
    cmp.openLinkedPath('domain/src'); // a directory, not a file

    expect(cmp.selectedPath()).toBe('README.md');
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
});
