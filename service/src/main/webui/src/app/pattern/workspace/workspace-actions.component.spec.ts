import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { CommandControllerService } from '@/api/api/commandController.service';
import { RepositoryActionsControllerService } from '@/api/api/repositoryActionsController.service';
import { ActionConfigurationDto } from '@/api/model/actionConfigurationDto';
import { ActionScope } from '@/api/model/actionScope';
import { CommandDto } from '@/api/model/commandDto';
import { CommandKind } from '@/api/model/commandKind';
import { CommandStatus } from '@/api/model/commandStatus';
import { WorkspaceActionsComponent } from './workspace-actions.component';

/** Mutation callbacks land on the next macrotask; flush before asserting. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function action(overrides: Partial<ActionConfigurationDto>): ActionConfigurationDto {
  return {
    id: 'action-1',
    name: 'build-project',
    executeScript: './mvnw package',
    interactive: false,
    scope: ActionScope.Global,
    ...overrides,
  } as ActionConfigurationDto;
}

function command(overrides: Partial<CommandDto>): CommandDto {
  return {
    id: 'cmd-1',
    workspaceId: 'wt-1',
    actionName: 'build-project',
    status: CommandStatus.Exited,
    kind: CommandKind.Terminal,
    exitCode: 0,
    launchedAt: '2026-07-09T10:00:00Z',
    ...overrides,
  } as CommandDto;
}

describe('WorkspaceActionsComponent', () => {
  const actionsService = {
    apiRepositoriesRepositoryIdActionsGet: vi.fn().mockReturnValue(of({ entries: [] })),
  };
  const commandService = {
    apiCommandsGet: vi.fn().mockReturnValue(of({ entries: [] })),
    apiCommandsPost: vi.fn().mockReturnValue(of({ command: { id: 'cmd-new' } })),
    apiCommandsCommandIdTerminatePost: vi.fn().mockReturnValue(of({})),
    apiCommandsCommandIdLogGet: vi.fn().mockReturnValue(of({ lines: [] })),
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
      imports: [WorkspaceActionsComponent],
      providers: [
        provideRouter([]),
        provideTanStackQuery(queryClient),
        { provide: RepositoryActionsControllerService, useValue: actionsService },
        { provide: CommandControllerService, useValue: commandService },
      ],
    }).compileComponents();
  });

  function createComponent() {
    const fixture = TestBed.createComponent(WorkspaceActionsComponent);
    fixture.componentRef.setInput('repoId', 'repo-1');
    fixture.componentRef.setInput('workspaceId', 'wt-1');
    fixture.detectChanges();
    return fixture;
  }

  it('renders both scopes with their badges and an interactive badge', () => {
    queryClient.setQueryData(
      ['repository-actions', 'repo-1'],
      [
        action({}),
        action({
          id: 'action-2',
          name: 'stack-info',
          scope: ActionScope.Repository,
          repositoryId: 'repo-1',
          interactive: true,
        }),
      ],
    );
    const fixture = createComponent();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.textContent).toContain('build-project');
    expect(element.textContent).toContain('global');
    expect(element.textContent).toContain('stack-info');
    expect(element.textContent).toContain('repository');
    expect(element.textContent).toContain('interactive');
  });

  it('Run launches the action into this workspace', async () => {
    queryClient.setQueryData(['repository-actions', 'repo-1'], [action({})]);
    const fixture = createComponent();

    const runButton = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ).find((b) => b.textContent?.trim() === 'Run');
    runButton!.click();
    await flush();

    expect(commandService.apiCommandsPost).toHaveBeenCalledWith({
      repoId: 'repo-1',
      workspaceId: 'wt-1',
      actionId: 'action-1',
    });
    // Non-interactive: stays on the tab, no navigation.
    expect(TestBed.inject(Router).url).toBe('/');
  });

  it('an interactive launch navigates to the command terminal page', async () => {
    queryClient.setQueryData(
      ['repository-actions', 'repo-1'],
      [action({ interactive: true })],
    );
    const fixture = createComponent();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    const runButton = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ).find((b) => b.textContent?.trim() === 'Run');
    runButton!.click();
    await flush();

    expect(navigate).toHaveBeenCalledWith(['/commands', 'cmd-new']);
  });

  it('renders the workspace run history with status, kind badge and exit code', () => {
    queryClient.setQueryData(
      ['commands', 'repo-1', 'wt-1'],
      [
        command({}),
        command({
          id: 'cmd-2',
          actionName: undefined,
          kind: CommandKind.Chat,
          status: CommandStatus.Running,
          exitCode: undefined,
        }),
      ],
    );
    const fixture = createComponent();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.textContent).toContain('build-project');
    expect(element.textContent).toContain('exited');
    expect(element.textContent).toContain('exit 0');
    // The non-terminal run is badged with its origin.
    expect(element.textContent).toContain('chat session');
    expect(element.textContent).toContain('running');
  });

  it('terminates a running command from its history row', async () => {
    queryClient.setQueryData(
      ['commands', 'repo-1', 'wt-1'],
      [command({ status: CommandStatus.Running, exitCode: undefined })],
    );
    const fixture = createComponent();

    const terminateButton = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ).find((b) => b.textContent?.trim() === 'Terminate');
    terminateButton!.click();
    await flush();

    expect(commandService.apiCommandsCommandIdTerminatePost).toHaveBeenCalledWith('cmd-1');
  });

  it('expands a finished command log inline', () => {
    queryClient.setQueryData(['commands', 'repo-1', 'wt-1'], [command({})]);
    commandService.apiCommandsGet.mockReturnValue(of({ entries: [] }));
    const fixture = createComponent();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('app-command-log')).toBeNull();
    const logButton = Array.from(element.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Log',
    );
    logButton!.click();
    fixture.detectChanges();

    expect(element.querySelector('app-command-log')).not.toBeNull();
  });
});
