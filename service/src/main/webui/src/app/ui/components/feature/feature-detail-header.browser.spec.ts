import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { page } from 'vitest/browser';

import { FeatureDto } from '@/api/model/featureDto';
import { FeatureDetailHeaderComponent } from './feature-detail-header.component';

/** Visual regression for the feature detail header: badge, dependsOn chip, markdown body. */

const FEATURE: FeatureDto = {
  id: 'feature-2',
  epicId: 'epic-1',
  title: 'project-detail-ui',
  description: 'The **segmented drill-down**:\n\n1. epic detail\n2. feature detail\n3. task detail',
  dependsOnFeatureId: 'feature-1',
  implementedOn: '2026-07-25T08:30:00Z',
};

@Component({
  imports: [FeatureDetailHeaderComponent],
  template: `
    <div data-testid="feature-header" class="bg-background p-6" style="width: 720px">
      <app-feature-detail-header
        [feature]="feature"
        projectId="project-1"
        dependsOnTitle="domain-and-persistence"
      />
    </div>
  `,
})
class FeatureHeaderHost {
  readonly feature = FEATURE;
}

describe('FeatureDetailHeaderComponent (visual)', () => {
  it('renders the implemented badge, the dependency link and the markdown body', async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(FeatureHeaderHost);
    document.body.style.margin = '0';
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    await expect.element(page.getByTestId('feature-header')).toMatchScreenshot('feature-header');
  });
});
