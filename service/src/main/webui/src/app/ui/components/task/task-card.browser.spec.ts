import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { page } from 'vitest/browser';

import { TaskDto } from '@/api/model/taskDto';
import { TaskCardComponent } from './task-card.component';

/** Visual regression for task cards: one implemented (badge), one not. */

const TASKS: TaskDto[] = [
  {
    id: 'task-1',
    featureId: 'feature-1',
    repositoryId: 'repo-1',
    title: 'Schema change in the backend',
    description: 'Add the new columns plus the Flyway migration.',
    implementedAt: '2026-07-25T09:45:00Z',
  },
  {
    id: 'task-2',
    featureId: 'feature-1',
    repositoryId: 'repo-2',
    title: 'Consume the new endpoint',
    dependsOnTaskId: 'task-1',
  },
];

@Component({
  imports: [TaskCardComponent],
  template: `
    <div data-testid="task-list" class="bg-background p-6" style="width: 720px">
      <div class="flex flex-col gap-2">
        @for (task of tasks; track task.id) {
          <app-task-card [task]="task" projectId="project-1" epicId="epic-1" />
        }
      </div>
    </div>
  `,
})
class TaskListHost {
  readonly tasks = TASKS;
}

describe('TaskCardComponent (visual)', () => {
  it('renders task cards with the implemented badge only when set', async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(TaskListHost);
    document.body.style.margin = '0';
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    await expect.element(page.getByTestId('task-list')).toMatchScreenshot('task-list');
  });
});
