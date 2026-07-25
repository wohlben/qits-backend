import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { ProjectEpicsControllerService } from '@/api/api/projectEpicsController.service';
import { ProjectEpicListComponent } from './project-epic-list.component';

describe('ProjectEpicListComponent', () => {
  const epicsApi = {
    apiProjectsProjectIdEpicsGet: vi.fn().mockReturnValue(of({ entries: [] })),
  };
  let queryClient: QueryClient;

  beforeEach(async () => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { staleTime: Infinity, retry: false, refetchOnMount: false },
      },
    });

    await TestBed.configureTestingModule({
      imports: [ProjectEpicListComponent],
      providers: [
        provideRouter([]),
        provideTanStackQuery(queryClient),
        { provide: ProjectEpicsControllerService, useValue: epicsApi },
      ],
    }).compileComponents();
  });

  function createComponent() {
    const fixture = TestBed.createComponent(ProjectEpicListComponent);
    fixture.componentRef.setInput('projectId', 'p-1');
    fixture.detectChanges();
    return fixture;
  }

  it('renders a card per epic', () => {
    queryClient.setQueryData(
      ['project-epics', 'p-1'],
      [
        { id: 'e-1', projectId: 'p-1', title: 'Observability' },
        { id: 'e-2', projectId: 'p-1', title: 'Workspaces', description: 'Container epics' },
      ],
    );
    const fixture = createComponent();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelectorAll('app-epic-card')).toHaveLength(2);
    expect(element.textContent).toContain('Observability');
    expect(element.textContent).toContain('Container epics');
  });

  it('shows the empty state (and the New Epic action) without epics', () => {
    queryClient.setQueryData(['project-epics', 'p-1'], []);
    const fixture = createComponent();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('app-empty-state')).not.toBeNull();
    expect(element.textContent).toContain('No epics');
    expect(element.textContent).toContain('New Epic');
  });

  it('fetches the project epics from the API and unwraps the entries', async () => {
    epicsApi.apiProjectsProjectIdEpicsGet.mockReturnValue(
      of({ entries: [{ epic: { id: 'e-1', title: 'From API' } }, {}] }),
    );
    const fixture = createComponent();

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect((fixture.nativeElement as HTMLElement).textContent).toContain('From API');
    });
    expect(epicsApi.apiProjectsProjectIdEpicsGet).toHaveBeenCalledWith('p-1');
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('app-epic-card')).toHaveLength(1);
  });
});
