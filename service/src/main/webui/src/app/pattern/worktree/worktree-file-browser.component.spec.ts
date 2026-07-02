import { TestBed } from '@angular/core/testing';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { WorktreeControllerService } from '@/api/api/worktreeController.service';
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
});
