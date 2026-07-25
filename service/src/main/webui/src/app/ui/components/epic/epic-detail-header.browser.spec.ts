import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { page } from 'vitest/browser';

import { EpicDto } from '@/api/model/epicDto';
import { EpicDetailHeaderComponent } from './epic-detail-header.component';

/** Visual regression for the epic detail header: title, timestamps, markdown spine. */

const EPIC: EpicDto = {
  id: 'epic-1',
  projectId: 'project-1',
  title: 'qits-epics',
  description:
    '# The planning spine\n\nEpics own **features**, features own tasks:\n\n- audit log replaces git\n- `epics/` is its own module',
  createdAt: '2026-07-25T08:30:00Z',
  updatedAt: '2026-07-25T12:15:00Z',
};

@Component({
  imports: [EpicDetailHeaderComponent],
  template: `
    <div data-testid="epic-header" class="bg-background p-6" style="width: 720px">
      <app-epic-detail-header [epic]="epic" />
    </div>
  `,
})
class EpicHeaderHost {
  readonly epic = EPIC;
}

describe('EpicDetailHeaderComponent (visual)', () => {
  it('renders the title, timestamps and the markdown description', async () => {
    const fixture = TestBed.createComponent(EpicHeaderHost);
    document.body.style.margin = '0';
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    await expect.element(page.getByTestId('epic-header')).toMatchScreenshot('epic-header');
  });
});
