import { TestBed } from '@angular/core/testing';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { AgentPluginControllerService } from '@/api/api/agentPluginController.service';
import { WorkspaceControllerService } from '@/api/api/workspaceController.service';
import { WorkspacePluginsComponent } from './workspace-plugins.component';

/** Mutation callbacks land on the next macrotask; flush before asserting. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('WorkspacePluginsComponent', () => {
  const installSpy = vi.fn().mockReturnValue(of({ installed: [] }));
  const pluginService = {
    apiRepositoriesRepoIdWorkspacesWorkspaceIdAgentPluginsGet: vi
      .fn()
      .mockReturnValue(of({ installed: [] })),
    apiRepositoriesRepoIdWorkspacesWorkspaceIdAgentPluginsPluginIdInstallPost: installSpy,
  };
  const workspaceService = {
    apiRepositoriesRepoIdWorkspacesWorkspaceIdFilesGet: vi
      .fn()
      .mockReturnValue(of({ paths: [], lazyDirs: [] })),
  };
  let queryClient: QueryClient;

  beforeEach(async () => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { staleTime: Infinity, retry: false, refetchOnMount: false, refetchInterval: false },
      },
    });

    await TestBed.configureTestingModule({
      imports: [WorkspacePluginsComponent],
      providers: [
        provideTanStackQuery(queryClient),
        { provide: AgentPluginControllerService, useValue: pluginService },
        { provide: WorkspaceControllerService, useValue: workspaceService },
      ],
    }).compileComponents();
  });

  /** Preset the (already-transformed) query caches so the component renders synchronously. */
  function seed(installed: Map<string, boolean>, paths: string[] = []) {
    queryClient.setQueryData(['workspace-plugins', 'repo-1', 'wt-1'], installed);
    queryClient.setQueryData(['workspace-files', 'repo-1', 'wt-1'], { paths, lazyDirs: [] });
  }

  function createComponent() {
    const fixture = TestBed.createComponent(WorkspacePluginsComponent);
    fixture.componentRef.setInput('repoId', 'repo-1');
    fixture.componentRef.setInput('workspaceId', 'wt-1');
    fixture.detectChanges();
    return fixture;
  }

  it('shows every curated plugin with an Install button when the store is empty', () => {
    seed(new Map());
    const el = createComponent().nativeElement as HTMLElement;

    expect(el.textContent).toContain('Java LSP (jdtls)');
    expect(el.textContent).toContain('TypeScript LSP');
    // One Install button per registry entry (nothing installed yet).
    expect(el.querySelectorAll('button').length).toBe(2);
    expect(el.textContent).toContain('Not installed');
  });

  it('marks an installed plugin green and drops its Install button', () => {
    seed(new Map([['jdtls-lsp@claude-plugins-official', true]]));
    const el = createComponent().nativeElement as HTMLElement;

    expect(el.textContent).toContain('Installed');
    // TypeScript LSP is still available → exactly one Install button remains.
    expect(el.querySelectorAll('button').length).toBe(1);
  });

  it('shows an installed-but-disabled plugin as Disabled with no Install button', () => {
    seed(
      new Map([
        ['jdtls-lsp@claude-plugins-official', false],
        ['typescript-lsp@claude-plugins-official', true],
      ]),
    );
    const el = createComponent().nativeElement as HTMLElement;

    expect(el.textContent).toContain('Disabled');
    // Both installed (one disabled) → no Install buttons.
    expect(el.querySelectorAll('button').length).toBe(0);
  });

  it('floats a framework-recommended plugin to the top and badges it', () => {
    // A pom.xml at the root → java-quarkus detected → jdtls-lsp recommended.
    seed(new Map(), ['pom.xml', 'src/main/java/App.java']);
    const el = createComponent().nativeElement as HTMLElement;

    expect(el.textContent).toContain('Recommended');
    const rows = Array.from(el.querySelectorAll('li')).map((li) => li.textContent ?? '');
    expect(rows[0]).toContain('Java LSP (jdtls)');
    expect(rows[0]).toContain('Recommended');
  });

  it('installs the bare plugin id when the Install button is clicked', async () => {
    seed(new Map());
    const el = createComponent().nativeElement as HTMLElement;

    const jdtlsRow = Array.from(el.querySelectorAll('li')).find((li) =>
      li.textContent?.includes('Java LSP (jdtls)'),
    );
    jdtlsRow!.querySelector('button')!.click();
    await flush();

    expect(installSpy).toHaveBeenCalledWith('jdtls-lsp', 'repo-1', 'wt-1');
  });
});
