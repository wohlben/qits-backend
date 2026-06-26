import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { Router } from '@angular/router';
import { injectMutation, QueryClient } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { FeatureFlowConfigurationControllerService } from '@/api/api/featureFlowConfigurationController.service';
import { ProjectControllerService } from '@/api/api/projectController.service';
import { CreateProjectFeatureFlowConfigurationRequest } from '@/api/model/createProjectFeatureFlowConfigurationRequest';
import { FeatureFlowConfigurationDto } from '@/api/model/featureFlowConfigurationDto';
import { UpdateFeatureFlowConfigurationRequest } from '@/api/model/updateFeatureFlowConfigurationRequest';
import { FeatureFlowFormComponent, FeatureFlowFormData } from '@/ui/forms/feature-flow/feature-flow-form.component';
import { ZardButtonComponent } from '@/shared/components/button';

@Component({
  selector: 'app-feature-flow-create-update-form',
  imports: [FeatureFlowFormComponent, ZardButtonComponent],
  template: `
    <app-feature-flow-form
      [initialData]="initialData()"
      [loading]="loading()"
      (submitted)="onSubmitted($event)"
    >
      <button formActions z-button zType="secondary" type="button" (click)="onCancel()">Cancel</button>
    </app-feature-flow-form>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FeatureFlowCreateUpdateFormComponent {
  /** Present in edit mode: the feature flow being updated. */
  readonly featureFlow = input<FeatureFlowConfigurationDto>();
  /** Present in create mode: the project the new feature flow belongs to. */
  readonly projectId = input<string>();
  readonly saved = output<void>();

  private readonly featureFlowService = inject(FeatureFlowConfigurationControllerService);
  private readonly projectService = inject(ProjectControllerService);
  private readonly queryClient = inject(QueryClient);
  private readonly router = inject(Router);

  readonly initialData = computed(() => {
    const f = this.featureFlow();
    return f ? { name: f.name ?? '' } : undefined;
  });

  readonly loading = computed(
    () => this.createMutation.isPending() || this.updateMutation.isPending(),
  );

  readonly createMutation = injectMutation(() => ({
    mutationFn: (req: CreateProjectFeatureFlowConfigurationRequest) =>
      lastValueFrom(
        this.projectService.apiProjectsProjectIdFeatureFlowConfigurationsPost(this.projectId()!, req),
      ),
    onSuccess: (res) => {
      this.queryClient.invalidateQueries({ queryKey: ['feature-flows'] });
      const createdId = res.featureFlowConfiguration?.id;
      this.router.navigate(createdId ? ['/feature-flows', createdId] : ['/projects', this.projectId()!]);
      this.saved.emit();
    },
  }));

  readonly updateMutation = injectMutation(() => ({
    mutationFn: (req: UpdateFeatureFlowConfigurationRequest) =>
      lastValueFrom(this.featureFlowService.apiFeatureFlowConfigurationsIdPut(this.featureFlow()!.id!, req)),
    onSuccess: () => {
      const id = this.featureFlow()!.id!;
      this.queryClient.invalidateQueries({ queryKey: ['feature-flows'] });
      this.queryClient.invalidateQueries({ queryKey: ['feature-flow', id] });
      this.router.navigate(['/feature-flows', id]);
      this.saved.emit();
    },
  }));

  onSubmitted(data: FeatureFlowFormData) {
    if (this.featureFlow()) {
      this.updateMutation.mutate({ name: data.name });
    } else {
      this.createMutation.mutate({ name: data.name });
    }
  }

  onCancel() {
    if (this.featureFlow()) {
      this.router.navigate(['/feature-flows', this.featureFlow()!.id!]);
    } else if (this.projectId()) {
      this.router.navigate(['/projects', this.projectId()!]);
    } else {
      this.router.navigate(['/feature-flows']);
    }
  }
}
