import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { page } from 'vitest/browser';

import { FeatureDto } from '@/api/model/featureDto';
import { FeatureCardComponent } from './feature-card.component';

/** Visual regression for feature cards: one implemented (badge), one not. */

const FEATURES: FeatureDto[] = [
  {
    id: 'feature-1',
    epicId: 'epic-1',
    title: 'domain-and-persistence',
    description: 'The epics module: entities, own datasource, audit log, REST boundary.',
    implementedOn: '2026-07-25T08:30:00Z',
  },
  {
    id: 'feature-2',
    epicId: 'epic-1',
    title: 'project-detail-ui',
    description: 'The Angular drill-down: epics section, detail routes, forms.',
    dependsOnFeatureId: 'feature-1',
  },
];

@Component({
  imports: [FeatureCardComponent],
  template: `
    <div data-testid="feature-list" class="bg-background p-6" style="width: 720px">
      <div class="flex flex-col gap-2">
        @for (feature of features; track feature.id) {
          <app-feature-card [feature]="feature" projectId="project-1" />
        }
      </div>
    </div>
  `,
})
class FeatureListHost {
  readonly features = FEATURES;
}

describe('FeatureCardComponent (visual)', () => {
  it('renders feature cards with the implemented badge only when set', async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(FeatureListHost);
    document.body.style.margin = '0';
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    await expect.element(page.getByTestId('feature-list')).toMatchScreenshot('feature-list');
  });
});
