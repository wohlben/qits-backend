import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { EpicControllerService } from '@/api/api/epicController.service';
import { ZardButtonComponent } from '@/shared/components/button';
import { EmptyStateComponent } from '@/ui/components/empty-state/empty-state.component';
import { FeatureCardComponent } from '@/ui/components/feature/feature-card.component';

@Component({
  selector: 'app-epic-feature-list',
  imports: [EmptyStateComponent, FeatureCardComponent, RouterLink, ZardButtonComponent],
  template: `
    <div class="flex flex-col gap-4">
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold">Features</h2>
        <a
          z-button
          zType="secondary"
          zSize="sm"
          [routerLink]="['/projects', projectId(), 'epics', epicId(), 'features', 'new']"
        >
          New Feature
        </a>
      </div>

      @if (featuresQuery.isPending()) {
        <div class="text-sm text-muted-foreground">Loading features…</div>
      } @else if (featuresQuery.isError()) {
        <div class="text-sm text-destructive">Failed to load features</div>
      } @else {
        @let features = featuresQuery.data() ?? [];
        @if (features.length === 0) {
          <app-empty-state>
            <span title>No features</span>
            <span description>This epic has no features yet</span>
          </app-empty-state>
        } @else {
          <div class="flex flex-col gap-2">
            @for (feature of features; track feature.id) {
              <app-feature-card [feature]="feature" [projectId]="projectId()" />
            }
          </div>
        }
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EpicFeatureListComponent {
  readonly projectId = input.required<string>();
  readonly epicId = input.required<string>();

  private readonly epicService = inject(EpicControllerService);

  readonly featuresQuery = injectQuery(() => ({
    queryKey: ['epic-features', this.epicId()],
    queryFn: () =>
      lastValueFrom(this.epicService.apiEpicsEpicIdFeaturesGet(this.epicId())).then(
        (r) =>
          r.entries?.map((e) => e.feature!).filter((p): p is NonNullable<typeof p> => !!p) ?? []
      ),
  }));
}
