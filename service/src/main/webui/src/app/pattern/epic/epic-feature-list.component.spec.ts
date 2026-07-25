import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { EpicControllerService } from '@/api/api/epicController.service';
import { EpicFeatureListComponent } from './epic-feature-list.component';

describe('EpicFeatureListComponent', () => {
  const epicApi = {
    apiEpicsEpicIdFeaturesGet: vi.fn().mockReturnValue(of({ entries: [] })),
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
      imports: [EpicFeatureListComponent],
      providers: [
        provideRouter([]),
        provideTanStackQuery(queryClient),
        { provide: EpicControllerService, useValue: epicApi },
      ],
    }).compileComponents();
  });

  function createComponent() {
    const fixture = TestBed.createComponent(EpicFeatureListComponent);
    fixture.componentRef.setInput('projectId', 'p-1');
    fixture.componentRef.setInput('epicId', 'e-1');
    fixture.detectChanges();
    return fixture;
  }

  it('renders a card per feature, with the implemented badge', () => {
    queryClient.setQueryData(
      ['epic-features', 'e-1'],
      [
        { id: 'f-1', epicId: 'e-1', title: 'Domain model', implementedOn: '2026-07-25T10:00:00Z' },
        { id: 'f-2', epicId: 'e-1', title: 'Detail UI' },
      ],
    );
    const fixture = createComponent();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelectorAll('app-feature-card')).toHaveLength(2);
    expect(element.textContent).toContain('Domain model');
    expect(element.textContent).toContain('Implemented');
  });

  it('shows the empty state without features', () => {
    queryClient.setQueryData(['epic-features', 'e-1'], []);
    const fixture = createComponent();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('app-empty-state')).not.toBeNull();
    expect(element.textContent).toContain('No features');
  });

  it('fetches the epic features from the API', async () => {
    epicApi.apiEpicsEpicIdFeaturesGet.mockReturnValue(
      of({ entries: [{ feature: { id: 'f-1', epicId: 'e-1', title: 'From API' } }] }),
    );
    const fixture = createComponent();

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect((fixture.nativeElement as HTMLElement).textContent).toContain('From API');
    });
    expect(epicApi.apiEpicsEpicIdFeaturesGet).toHaveBeenCalledWith('e-1');
  });
});
