import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { page } from 'vitest/browser';

import { TaskDto } from '@/api/model/taskDto';
import { TaskDetailHeaderComponent } from './task-detail-header.component';

/** Visual regression for the task detail header: repository link, dependency chip, badge. */

const TASK: TaskDto = {
  id: 'task-2',
  featureId: 'feature-1',
  repositoryId: 'repo-1',
  title: 'Consume the new endpoint',
  description: 'Regenerate the client and wire the store:\n\n- `pnpm generate:api`\n- adapt the list',
  dependsOnTaskId: 'task-1',
  implementedAt: '2026-07-25T09:45:00Z',
};

@Component({
  imports: [TaskDetailHeaderComponent],
  template: `
    <div data-testid="task-header" class="bg-background p-6" style="width: 720px">
      <app-task-detail-header
        [task]="task"
        projectId="project-1"
        epicId="epic-1"
        repositoryUrl="https://example.test/backend.git"
        dependsOnTitle="Schema change in the backend"
      />
    </div>
  `,
})
class TaskHeaderHost {
  readonly task = TASK;
}

describe('TaskDetailHeaderComponent (visual)', () => {
  it('renders the repository link, the dependency link, the badge and the markdown body', async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(TaskHeaderHost);
    document.body.style.margin = '0';
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    await expect.element(page.getByTestId('task-header')).toMatchScreenshot('task-header');
  });
});
