import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { page } from 'vitest/browser';

import { EpicDto } from '@/api/model/epicDto';
import { EpicCardComponent } from './epic-card.component';

/** Visual regression for the epic cards as the project-detail Epics section stacks them. */

const EPICS: EpicDto[] = [
  {
    id: 'epic-1',
    projectId: 'project-1',
    title: 'qits-epics',
    description: 'Planning (epics → features → tasks) as a first-class domain with an audit log.',
  },
  { id: 'epic-2', projectId: 'project-1', title: 'qits-observability' },
];

@Component({
  imports: [EpicCardComponent],
  template: `
    <div data-testid="epic-list" class="bg-background p-6" style="width: 720px">
      <div class="flex flex-col gap-2">
        @for (epic of epics; track epic.id) {
          <app-epic-card [epic]="epic" projectId="project-1" />
        }
      </div>
    </div>
  `,
})
class EpicListHost {
  readonly epics = EPICS;
}

describe('EpicCardComponent (visual)', () => {
  it('renders epic cards with title, description preview and View action', async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(EpicListHost);
    document.body.style.margin = '0';
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    await expect.element(page.getByTestId('epic-list')).toMatchScreenshot('epic-list');
  });
});
