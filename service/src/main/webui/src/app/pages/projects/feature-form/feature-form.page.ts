import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { FeatureControllerService } from '@/api/api/featureController.service';
import { PageLayoutComponent } from '@/layout/page-layout/page-layout.component';
import { FeatureCreateUpdateFormComponent } from '@/pattern/feature/feature-create-update-form.component';

@Component({
  selector: 'app-feature-form-page',
  imports: [FeatureCreateUpdateFormComponent, PageLayoutComponent],
  template: `
    <app-page-layout [hasActions]="false">
      <div pageTitle>
        <h1 class="text-2xl font-bold">{{ isEdit() ? 'Edit Feature' : 'New Feature' }}</h1>
      </div>
      @if (isEdit() && featureQuery.isPending()) {
        <div class="text-muted-foreground">Loading feature…</div>
      } @else if (isEdit() && featureQuery.isError()) {
        <div class="text-destructive">Failed to load feature</div>
      } @else {
        <app-feature-create-update-form
          [projectId]="projectId"
          [epicId]="epicId"
          [feature]="feature()"
        />
      }
    </app-page-layout>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FeatureFormPage {
  private readonly route = inject(ActivatedRoute);
  private readonly featureService = inject(FeatureControllerService);

  readonly projectId = this.route.snapshot.paramMap.get('projectId')!;
  readonly epicId = this.route.snapshot.paramMap.get('epicId')!;
  readonly featureId = this.route.snapshot.paramMap.get('featureId');

  readonly featureQuery = injectQuery(() => ({
    queryKey: ['feature', this.featureId ?? ''],
    queryFn: () =>
      lastValueFrom(this.featureService.apiFeaturesIdGet(this.featureId!)).then((r) => r.feature!),
    enabled: () => !!this.featureId,
  }));

  readonly feature = computed(() => this.featureQuery.data());
  readonly isEdit = computed(() => !!this.featureId);
}
