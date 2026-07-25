import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { FeatureControllerService } from '@/api/api/featureController.service';
import { FeatureTaskListComponent } from './feature-task-list.component';

describe('FeatureTaskListComponent', () => {
  const featureApi = {
    apiFeaturesFeatureIdTasksGet: vi.fn().mockReturnValue(of({ entries: [] })),
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
      imports: [FeatureTaskListComponent],
      providers: [
        provideRouter([]),
        provideTanStackQuery(queryClient),
        { provide: FeatureControllerService, useValue: featureApi },
      ],
    }).compileComponents();
  });

  function createComponent() {
    const fixture = TestBed.createComponent(FeatureTaskListComponent);
    fixture.componentRef.setInput('projectId', 'p-1');
    fixture.componentRef.setInput('epicId', 'e-1');
    fixture.componentRef.setInput('featureId', 'f-1');
    fixture.detectChanges();
    return fixture;
  }

  it('renders a card per task', () => {
    queryClient.setQueryData(
      ['feature-tasks', 'f-1'],
      [
        { id: 't-1', featureId: 'f-1', repositoryId: 'r-1', title: 'Schema change' },
        { id: 't-2', featureId: 'f-1', repositoryId: 'r-2', title: 'Consumer update' },
      ],
    );
    const fixture = createComponent();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelectorAll('app-task-card')).toHaveLength(2);
    expect(element.textContent).toContain('Schema change');
    expect(element.textContent).toContain('Consumer update');
  });

  it('shows the empty state without tasks', () => {
    queryClient.setQueryData(['feature-tasks', 'f-1'], []);
    const fixture = createComponent();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('app-empty-state')).not.toBeNull();
    expect(element.textContent).toContain('No tasks');
  });

  it('fetches the feature tasks from the API', async () => {
    featureApi.apiFeaturesFeatureIdTasksGet.mockReturnValue(
      of({ entries: [{ task: { id: 't-1', featureId: 'f-1', title: 'From API' } }] }),
    );
    const fixture = createComponent();

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect((fixture.nativeElement as HTMLElement).textContent).toContain('From API');
    });
    expect(featureApi.apiFeaturesFeatureIdTasksGet).toHaveBeenCalledWith('f-1');
  });
});
