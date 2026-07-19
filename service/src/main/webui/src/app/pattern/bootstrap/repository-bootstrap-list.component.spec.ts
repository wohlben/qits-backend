import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { BootstrapCommandControllerService } from '@/api/api/bootstrapCommandController.service';
import { Origin } from '@/api/model/origin';
import { RepositoryBootstrapListComponent } from './repository-bootstrap-list.component';

/** Mutation callbacks land on the next macrotask; flush before asserting. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('RepositoryBootstrapListComponent', () => {
  const bootstrapService = {
    apiRepositoriesRepositoryIdBootstrapCommandsGet: vi.fn().mockReturnValue(of({ entries: [] })),
    apiRepositoriesRepositoryIdBootstrapCommandsOrderPut: vi
      .fn()
      .mockReturnValue(of({ entries: [] })),
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
      imports: [RepositoryBootstrapListComponent],
      providers: [
        provideRouter([]),
        provideTanStackQuery(queryClient),
        { provide: BootstrapCommandControllerService, useValue: bootstrapService },
      ],
    }).compileComponents();
  });

  function createComponent() {
    const fixture = TestBed.createComponent(RepositoryBootstrapListComponent);
    fixture.componentRef.setInput('repoId', 'repo-1');
    fixture.detectChanges();
    return fixture;
  }

  it('renders the ordered chain; config-origin rows get the badge and no reorder buttons', () => {
    queryClient.setQueryData(
      ['repository-bootstrap-commands', 'repo-1'],
      [
        {
          id: 'cmd-1',
          name: 'install@qits-config',
          origin: Origin.Config,
          repositoryId: 'repo-1',
          orderIndex: 0,
        },
        { id: 'cmd-2', name: 'hand-made', origin: Origin.Ui, repositoryId: 'repo-1', orderIndex: 1 },
      ],
    );
    const fixture = createComponent();
    const element = fixture.nativeElement as HTMLElement;

    // The config-managed row: base name + badge, plain text (no edit link), no arrows.
    expect(element.textContent).toContain('.qits-config');
    expect(element.textContent).toContain('install');
    const cards = element.querySelectorAll('app-bootstrap-command-card');
    expect(cards).toHaveLength(2);
    expect(cards[0].querySelectorAll('button')).toHaveLength(0);
    expect(cards[0].querySelector('a')).toBeNull();
    // The UI row is an edit link with reorder arrows.
    expect(cards[1].querySelector('a')?.getAttribute('href')).toBe(
      '/repositories/repo-1/bootstrap/cmd-2/edit',
    );
    expect(cards[1].querySelectorAll('button')).toHaveLength(2);
  });

  it('moving a row down submits the full swapped id order atomically', async () => {
    queryClient.setQueryData(
      ['repository-bootstrap-commands', 'repo-1'],
      [
        { id: 'cmd-1', name: 'a', origin: Origin.Ui, repositoryId: 'repo-1', orderIndex: 0 },
        { id: 'cmd-2', name: 'b', origin: Origin.Ui, repositoryId: 'repo-1', orderIndex: 1 },
      ],
    );
    const fixture = createComponent();

    const firstCard = (fixture.nativeElement as HTMLElement).querySelectorAll(
      'app-bootstrap-command-card',
    )[0];
    const down = Array.from(firstCard.querySelectorAll('button')).find(
      (b) => b.getAttribute('aria-label') === 'Move a down',
    );
    down!.click();
    await flush();

    expect(
      bootstrapService.apiRepositoriesRepositoryIdBootstrapCommandsOrderPut,
    ).toHaveBeenCalledWith('repo-1', { ids: ['cmd-2', 'cmd-1'] });
  });

  it('shows the empty state when no commands exist', () => {
    queryClient.setQueryData(['repository-bootstrap-commands', 'repo-1'], []);
    const fixture = createComponent();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'No bootstrap commands yet',
    );
  });
});
