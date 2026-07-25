import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { TaskFormComponent } from './task-form.component';

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('TaskFormComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TaskFormComponent],
    }).compileComponents();
  });

  function createComponent(mode: 'create' | 'edit' = 'create') {
    const fixture = TestBed.createComponent(TaskFormComponent);
    fixture.componentRef.setInput('mode', mode);
    fixture.detectChanges();
    return fixture;
  }

  function submitForm(fixture: ReturnType<typeof createComponent>) {
    (fixture.nativeElement as HTMLElement)
      .querySelector('form')!
      .dispatchEvent(new Event('submit'));
  }

  it('shows the repository picker in create mode only', () => {
    const create = createComponent('create');
    expect(
      (create.nativeElement as HTMLElement).querySelector('app-repository-select-input'),
    ).not.toBeNull();

    const edit = createComponent('edit');
    expect(
      (edit.nativeElement as HTMLElement).querySelector('app-repository-select-input'),
    ).toBeNull();
  });

  it('requires a repository (and a title) before emitting', async () => {
    const fixture = createComponent('create');
    const submitted = vi.fn();
    fixture.componentInstance.submitted.subscribe(submitted);
    fixture.componentInstance.model.set({
      title: 'Schema change',
      description: '',
      repositoryId: '',
      dependsOnTaskId: '',
    });

    submitForm(fixture);
    await flush();
    expect(submitted).not.toHaveBeenCalled();

    fixture.componentInstance.model.update((m) => ({ ...m, repositoryId: 'r-1' }));
    submitForm(fixture);
    await flush();
    expect(submitted).toHaveBeenCalledWith({
      title: 'Schema change',
      description: '',
      repositoryId: 'r-1',
      dependsOnTaskId: '',
    });
  });
});
