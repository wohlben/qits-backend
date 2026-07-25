import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { FeatureControllerService } from '@/api/api/featureController.service';
import { ProjectControllerService } from '@/api/api/projectController.service';
import { TaskControllerService } from '@/api/api/taskController.service';
import { TaskCreateUpdateFormComponent } from './task-create-update-form.component';

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('TaskCreateUpdateFormComponent', () => {
  const featureApi = {
    apiFeaturesFeatureIdTasksGet: vi.fn().mockReturnValue(of({ entries: [] })),
    apiFeaturesFeatureIdTasksPost: vi.fn().mockReturnValue(of({ task: { id: 't-new' } })),
  };
  const taskApi = {
    apiTasksIdPut: vi.fn().mockReturnValue(of({ task: { id: 't-1' } })),
  };
  const projectApi = {
    apiProjectsProjectIdRepositoriesGet: vi.fn().mockReturnValue(of({ entries: [] })),
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
      imports: [TaskCreateUpdateFormComponent],
      providers: [
        { provide: Router, useValue: { navigate: vi.fn() } },
        provideTanStackQuery(queryClient),
        { provide: FeatureControllerService, useValue: featureApi },
        { provide: TaskControllerService, useValue: taskApi },
        { provide: ProjectControllerService, useValue: projectApi },
      ],
    }).compileComponents();
  });

  function createComponent(task?: object) {
    const fixture = TestBed.createComponent(TaskCreateUpdateFormComponent);
    fixture.componentRef.setInput('projectId', 'p-1');
    fixture.componentRef.setInput('epicId', 'e-1');
    fixture.componentRef.setInput('featureId', 'f-1');
    if (task) {
      fixture.componentRef.setInput('task', task);
    }
    fixture.detectChanges();
    return fixture;
  }

  it('creates a task with its repository binding', async () => {
    const fixture = createComponent();

    fixture.componentInstance.onSubmitted({
      title: 'Schema change',
      description: '',
      repositoryId: 'r-1',
      dependsOnTaskId: '',
    });
    await flush();

    expect(featureApi.apiFeaturesFeatureIdTasksPost).toHaveBeenCalledWith('f-1', {
      repositoryId: 'r-1',
      title: 'Schema change',
      description: undefined,
      dependsOnTaskId: undefined,
    });
  });

  it('updates without a repositoryId (the binding is immutable)', async () => {
    const fixture = createComponent({ id: 't-1', featureId: 'f-1', repositoryId: 'r-1' });

    fixture.componentInstance.onSubmitted({
      title: 'Schema change',
      description: 'Updated',
      repositoryId: 'r-1',
      dependsOnTaskId: '',
    });
    await flush();

    expect(taskApi.apiTasksIdPut).toHaveBeenCalledWith('t-1', {
      title: 'Schema change',
      description: 'Updated',
      dependsOnTaskId: undefined,
      clearDependsOn: undefined,
    });
    const sent = taskApi.apiTasksIdPut.mock.calls[0][1];
    expect('repositoryId' in sent).toBe(false);
  });

  it('sends clearDependsOn when an edit clears a previously-set dependency', async () => {
    const fixture = createComponent({
      id: 't-1',
      featureId: 'f-1',
      repositoryId: 'r-1',
      dependsOnTaskId: 't-0',
    });

    fixture.componentInstance.onSubmitted({
      title: 'Schema change',
      description: '',
      repositoryId: 'r-1',
      dependsOnTaskId: '',
    });
    await flush();

    expect(taskApi.apiTasksIdPut).toHaveBeenCalledWith('t-1', {
      title: 'Schema change',
      description: undefined,
      dependsOnTaskId: undefined,
      clearDependsOn: true,
    });
  });

  it('maps the project repositories into picker options and excludes self from dependencies', () => {
    queryClient.setQueryData(
      ['project-repositories', 'p-1'],
      [{ id: 'r-1', url: 'https://example.test/repo.git' }],
    );
    queryClient.setQueryData(
      ['feature-tasks', 'f-1'],
      [
        { id: 't-1', featureId: 'f-1', title: 'Self' },
        { id: 't-2', featureId: 'f-1', title: 'Sibling' },
      ],
    );
    const fixture = createComponent({ id: 't-1', featureId: 'f-1', repositoryId: 'r-1' });

    expect(fixture.componentInstance.repositoryOptions()).toEqual([
      { id: 'r-1', url: 'https://example.test/repo.git' },
    ]);
    expect(fixture.componentInstance.dependencyOptions()).toEqual([
      { id: 't-2', title: 'Sibling' },
    ]);
  });
});
