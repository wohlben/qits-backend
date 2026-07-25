import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { injectMutation, injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { EpicControllerService } from '@/api/api/epicController.service';
import { FeatureControllerService } from '@/api/api/featureController.service';
import { UpdateFeatureRequest } from '@/api/model/updateFeatureRequest';
import { PageLayoutComponent } from '@/layout/page-layout/page-layout.component';
import { FeatureTaskListComponent } from '@/pattern/feature/feature-task-list.component';
import { FeatureDetailHeaderComponent } from '@/ui/components/feature/feature-detail-header.component';
import { ZardButtonComponent } from '@/shared/components/button';

@Component({
  selector: 'app-feature-detail-page',
  imports: [
    FeatureDetailHeaderComponent,
    FeatureTaskListComponent,
    PageLayoutComponent,
    RouterLink,
    ZardButtonComponent,
  ],
  template: `
    <app-page-layout
      [request]="featureQuery"
      pendingText="Loading feature…"
      errorText="Failed to load feature"
    >
      <ng-template #pageTitle let-feature>
        <app-feature-detail-header
          [feature]="feature"
          [projectId]="projectId"
          [dependsOnTitle]="dependsOnTitle()"
        />
      </ng-template>

      <div pageActions>
        <button
          z-button
          zType="secondary"
          (click)="onToggleImplemented()"
          [zLoading]="implementedMutation.isPending()"
        >
          {{ featureQuery.data()?.implementedOn ? 'Unmark implemented' : 'Mark implemented' }}
        </button>
        <a
          z-button
          [routerLink]="['/projects', projectId, 'epics', epicId, 'features', featureId, 'edit']"
        >
          Edit
        </a>
        <button
          z-button
          zType="destructive"
          (click)="onDelete()"
          [zLoading]="deleteMutation.isPending()"
        >
          Delete
        </button>
      </div>

      <app-feature-task-list [projectId]="projectId" [epicId]="epicId" [featureId]="featureId" />
    </app-page-layout>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FeatureDetailPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly epicService = inject(EpicControllerService);
  private readonly featureService = inject(FeatureControllerService);
  private readonly queryClient = inject(QueryClient);

  readonly projectId = this.route.snapshot.paramMap.get('projectId')!;
  readonly epicId = this.route.snapshot.paramMap.get('epicId')!;
  readonly featureId = this.route.snapshot.paramMap.get('featureId')!;

  readonly featureQuery = injectQuery(() => ({
    queryKey: ['feature', this.featureId],
    queryFn: () =>
      lastValueFrom(this.featureService.apiFeaturesIdGet(this.featureId)).then((r) => r.feature!),
  }));

  // Same key/shape as app-epic-feature-list; resolves the depended-on sibling's title.
  readonly siblingsQuery = injectQuery(() => ({
    queryKey: ['epic-features', this.epicId],
    queryFn: () =>
      lastValueFrom(this.epicService.apiEpicsEpicIdFeaturesGet(this.epicId)).then(
        (r) =>
          r.entries?.map((e) => e.feature!).filter((p): p is NonNullable<typeof p> => !!p) ?? []
      ),
  }));

  readonly dependsOnTitle = computed(() => {
    const dependsOnId = this.featureQuery.data()?.dependsOnFeatureId;
    if (!dependsOnId) return undefined;
    return this.siblingsQuery.data()?.find((f) => f.id === dependsOnId)?.title;
  });

  readonly implementedMutation = injectMutation(() => ({
    mutationFn: (req: UpdateFeatureRequest) =>
      lastValueFrom(this.featureService.apiFeaturesIdPut(this.featureId, req)),
    onSuccess: () => this.invalidate(),
  }));

  readonly deleteMutation = injectMutation(() => ({
    mutationFn: () => lastValueFrom(this.featureService.apiFeaturesIdDelete(this.featureId)),
    onSuccess: () => {
      this.invalidate();
      this.router.navigate(['/projects', this.projectId, 'epics', this.epicId]);
    },
  }));

  onToggleImplemented() {
    if (this.featureQuery.data()?.implementedOn) {
      this.implementedMutation.mutate({ clearImplementedOn: true });
    } else {
      this.implementedMutation.mutate({ implementedOn: new Date().toISOString() });
    }
  }

  onDelete() {
    if (confirm('Are you sure you want to delete this feature (including its tasks)?')) {
      this.deleteMutation.mutate();
    }
  }

  private invalidate() {
    this.queryClient.invalidateQueries({ queryKey: ['epic-features', this.epicId] });
    this.queryClient.invalidateQueries({ queryKey: ['feature', this.featureId] });
    this.queryClient.invalidateQueries({ queryKey: ['epic-audit', this.epicId] });
  }
}
