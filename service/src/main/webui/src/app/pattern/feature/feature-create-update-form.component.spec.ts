import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { EpicControllerService } from '@/api/api/epicController.service';
import { FeatureControllerService } from '@/api/api/featureController.service';
import { FeatureCreateUpdateFormComponent } from './feature-create-update-form.component';

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('FeatureCreateUpdateFormComponent', () => {
  const epicApi = {
    apiEpicsEpicIdFeaturesGet: vi.fn().mockReturnValue(of({ entries: [] })),
    apiEpicsEpicIdFeaturesPost: vi.fn().mockReturnValue(of({ feature: { id: 'f-new' } })),
  };
  const featureApi = {
    apiFeaturesIdPut: vi.fn().mockReturnValue(of({ feature: { id: 'f-1' } })),
  };
  let queryClient: QueryClient;

  beforeEach(async () => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { staleTime: Infinity, retry: false, refetchOnMount: false },
        mutations: { retry: false },
      },
    });

    await TestBed.configureTestingModule({
      imports: [FeatureCreateUpdateFormComponent],
      providers: [
        { provide: Router, useValue: { navigate: vi.fn() } },
        provideTanStackQuery(queryClient),
        { provide: EpicControllerService, useValue: epicApi },
        { provide: FeatureControllerService, useValue: featureApi },
      ],
    }).compileComponents();
  });

  function createComponent(feature?: object) {
    const fixture = TestBed.createComponent(FeatureCreateUpdateFormComponent);
    fixture.componentRef.setInput('projectId', 'p-1');
    fixture.componentRef.setInput('epicId', 'e-1');
    if (feature) {
      fixture.componentRef.setInput('feature', feature);
    }
    fixture.detectChanges();
    return fixture;
  }

  it('creates a feature, omitting the unset optional fields', async () => {
    const fixture = createComponent();

    fixture.componentInstance.onSubmitted({
      title: 'Detail UI',
      description: '',
      dependsOnFeatureId: '',
    });
    await flush();

    expect(epicApi.apiEpicsEpicIdFeaturesPost).toHaveBeenCalledWith('e-1', {
      title: 'Detail UI',
      description: undefined,
      dependsOnFeatureId: undefined,
    });
  });

  it('creates a feature with a dependency when one is picked', async () => {
    const fixture = createComponent();

    fixture.componentInstance.onSubmitted({
      title: 'Detail UI',
      description: 'The drill-down',
      dependsOnFeatureId: 'f-0',
    });
    await flush();

    expect(epicApi.apiEpicsEpicIdFeaturesPost).toHaveBeenCalledWith('e-1', {
      title: 'Detail UI',
      description: 'The drill-down',
      dependsOnFeatureId: 'f-0',
    });
  });

  it('sends clearDependsOn when an edit clears a previously-set dependency', async () => {
    const fixture = createComponent({ id: 'f-1', epicId: 'e-1', dependsOnFeatureId: 'f-0' });

    fixture.componentInstance.onSubmitted({
      title: 'Detail UI',
      description: '',
      dependsOnFeatureId: '',
    });
    await flush();

    expect(featureApi.apiFeaturesIdPut).toHaveBeenCalledWith('f-1', {
      title: 'Detail UI',
      description: undefined,
      dependsOnFeatureId: undefined,
      clearDependsOn: true,
    });
  });

  it('does not send clearDependsOn when no dependency was set before', async () => {
    const fixture = createComponent({ id: 'f-1', epicId: 'e-1' });

    fixture.componentInstance.onSubmitted({
      title: 'Detail UI',
      description: '',
      dependsOnFeatureId: '',
    });
    await flush();

    expect(featureApi.apiFeaturesIdPut).toHaveBeenCalledWith('f-1', {
      title: 'Detail UI',
      description: undefined,
      dependsOnFeatureId: undefined,
      clearDependsOn: undefined,
    });
  });

  it('excludes the edited feature itself from the dependency options', () => {
    queryClient.setQueryData(
      ['epic-features', 'e-1'],
      [
        { id: 'f-1', epicId: 'e-1', title: 'Self' },
        { id: 'f-2', epicId: 'e-1', title: 'Sibling' },
      ],
    );
    const fixture = createComponent({ id: 'f-1', epicId: 'e-1' });

    expect(fixture.componentInstance.dependencyOptions()).toEqual([
      { id: 'f-2', title: 'Sibling' },
    ]);
  });
});
