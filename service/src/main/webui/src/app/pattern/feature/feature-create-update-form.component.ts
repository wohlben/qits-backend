import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { Router } from '@angular/router';
import { injectMutation, injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { EpicControllerService } from '@/api/api/epicController.service';
import { FeatureControllerService } from '@/api/api/featureController.service';
import { CreateFeatureRequest } from '@/api/model/createFeatureRequest';
import { FeatureDto } from '@/api/model/featureDto';
import { UpdateFeatureRequest } from '@/api/model/updateFeatureRequest';
import { ZardButtonComponent } from '@/shared/components/button';
import { errorMessage } from '@/shared/utils/error-message';
import { FeatureFormComponent, FeatureFormData } from '@/ui/forms/feature/feature-form.component';

@Component({
  selector: 'app-feature-create-update-form',
  imports: [FeatureFormComponent, ZardButtonComponent],
  template: `
    @if (error(); as err) {
      <div class="mb-4 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
        {{ err }}
      </div>
    }
    <app-feature-form
      [initialData]="initialData()"
      [loading]="createMutation.isPending() || updateMutation.isPending()"
      [dependencyOptions]="dependencyOptions()"
      (submitted)="onSubmitted($event)"
    >
      <button formActions z-button zType="secondary" type="button" (click)="onCancel()">
        Cancel
      </button>
    </app-feature-form>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FeatureCreateUpdateFormComponent {
  readonly projectId = input.required<string>();
  readonly epicId = input.required<string>();
  readonly feature = input<FeatureDto>();
  readonly saved = output<void>();

  private readonly epicService = inject(EpicControllerService);
  private readonly featureService = inject(FeatureControllerService);
  private readonly queryClient = inject(QueryClient);
  private readonly router = inject(Router);

  readonly initialData = computed(() => {
    const f = this.feature();
    return f
      ? {
          title: f.title ?? '',
          description: f.description ?? '',
          dependsOnFeatureId: f.dependsOnFeatureId ?? '',
        }
      : undefined;
  });

  // Same key/shape as app-epic-feature-list so they share a cache entry.
  readonly siblingsQuery = injectQuery(() => ({
    queryKey: ['epic-features', this.epicId()],
    queryFn: () =>
      lastValueFrom(this.epicService.apiEpicsEpicIdFeaturesGet(this.epicId())).then(
        (r) =>
          r.entries?.map((e) => e.feature!).filter((p): p is NonNullable<typeof p> => !!p) ?? []
      ),
  }));

  readonly dependencyOptions = computed(() =>
    (this.siblingsQuery.data() ?? [])
      .filter((f) => f.id !== this.feature()?.id)
      .map((f) => ({ id: f.id!, title: f.title ?? f.id! }))
  );

  readonly error = computed(() => {
    const err = this.createMutation.error() ?? this.updateMutation.error();
    return err ? errorMessage(err, 'Failed to save the feature') : null;
  });

  readonly createMutation = injectMutation(() => ({
    mutationFn: (req: CreateFeatureRequest) =>
      lastValueFrom(this.epicService.apiEpicsEpicIdFeaturesPost(this.epicId(), req)),
    onSuccess: () => {
      this.queryClient.invalidateQueries({ queryKey: ['epic-features', this.epicId()] });
      this.queryClient.invalidateQueries({ queryKey: ['epic-audit', this.epicId()] });
      this.router.navigate(['/projects', this.projectId(), 'epics', this.epicId()]);
      this.saved.emit();
    },
  }));

  readonly updateMutation = injectMutation(() => ({
    mutationFn: (req: UpdateFeatureRequest) =>
      lastValueFrom(this.featureService.apiFeaturesIdPut(this.feature()!.id!, req)),
    onSuccess: () => {
      const id = this.feature()!.id!;
      this.queryClient.invalidateQueries({ queryKey: ['epic-features', this.epicId()] });
      this.queryClient.invalidateQueries({ queryKey: ['feature', id] });
      this.queryClient.invalidateQueries({ queryKey: ['epic-audit', this.epicId()] });
      this.router.navigate(['/projects', this.projectId(), 'epics', this.epicId(), 'features', id]);
      this.saved.emit();
    },
  }));

  onSubmitted(data: FeatureFormData) {
    if (this.feature()) {
      // Clearing a previously-set dependency needs the explicit flag (PUT is a partial update).
      this.updateMutation.mutate({
        title: data.title,
        description: data.description || undefined,
        dependsOnFeatureId: data.dependsOnFeatureId || undefined,
        clearDependsOn:
          !data.dependsOnFeatureId && !!this.feature()!.dependsOnFeatureId ? true : undefined,
      });
    } else {
      this.createMutation.mutate({
        title: data.title,
        description: data.description || undefined,
        dependsOnFeatureId: data.dependsOnFeatureId || undefined,
      });
    }
  }

  onCancel() {
    const f = this.feature();
    if (f) {
      this.router.navigate([
        '/projects',
        this.projectId(),
        'epics',
        this.epicId(),
        'features',
        f.id,
      ]);
    } else {
      this.router.navigate(['/projects', this.projectId(), 'epics', this.epicId()]);
    }
  }
}
