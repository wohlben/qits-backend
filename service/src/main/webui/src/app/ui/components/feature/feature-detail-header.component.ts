import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';

import { FeatureDto } from '@/api/model/featureDto';
import { MarkdownComponent } from '@/ui/components/markdown/markdown.component';
import { ZardBadgeComponent } from '@/shared/components/badge';

@Component({
  selector: 'app-feature-detail-header',
  imports: [DatePipe, MarkdownComponent, RouterLink, ZardBadgeComponent],
  template: `
    <div class="flex flex-col gap-1">
      <div class="flex items-center gap-2">
        <h1 class="text-2xl font-bold">{{ feature().title }}</h1>
        @if (feature().implementedOn) {
          <z-badge>Implemented {{ feature().implementedOn | date }}</z-badge>
        }
      </div>
      @if (feature().dependsOnFeatureId) {
        <p class="text-xs text-muted-foreground">
          Depends on
          <a
            class="underline underline-offset-2"
            [routerLink]="[
              '/projects',
              projectId(),
              'epics',
              feature().epicId,
              'features',
              feature().dependsOnFeatureId,
            ]"
          >
            {{ dependsOnTitle() ?? feature().dependsOnFeatureId }}
          </a>
        </p>
      }
      @if (feature().description) {
        <div class="text-sm text-muted-foreground mt-1">
          <app-markdown [text]="feature().description!" />
        </div>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FeatureDetailHeaderComponent {
  readonly feature = input.required<FeatureDto>();
  readonly projectId = input.required<string>();
  /** Title of the depended-on sibling, resolved by the page (fallback: the raw id). */
  readonly dependsOnTitle = input<string>();
}
