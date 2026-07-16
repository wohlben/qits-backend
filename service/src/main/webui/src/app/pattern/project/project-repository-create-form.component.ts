import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { injectMutation, QueryClient } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { ProjectControllerService } from '@/api/api/projectController.service';
import { CreateProjectRepositoryRequest } from '@/api/model/createProjectRepositoryRequest';
import { RepositoryArchetype } from '@/api/model/repositoryArchetype';
import { RepositoryDto } from '@/api/model/repositoryDto';
import {
  RepositoryFormComponent,
  RepositoryFormData,
} from '@/ui/forms/repository/repository-form.component';
import { ZardButtonComponent } from '@/shared/components/button';

@Component({
  selector: 'app-project-repository-create-form',
  imports: [RepositoryFormComponent, ZardButtonComponent],
  template: `
    <app-repository-form
      [loading]="createMutation.isPending()"
      (submitted)="onSubmitted($event)"
    >
      <button formActions z-button zType="secondary" type="button" (click)="cancelled.emit()">
        Cancel
      </button>
    </app-repository-form>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectRepositoryCreateFormComponent {
  readonly projectId = input.required<string>();
  readonly saved = output<RepositoryDto>();
  readonly cancelled = output<void>();

  private readonly projectService = inject(ProjectControllerService);
  private readonly queryClient = inject(QueryClient);

  readonly createMutation = injectMutation(() => ({
    mutationFn: (req: CreateProjectRepositoryRequest) =>
      lastValueFrom(
        this.projectService.apiProjectsProjectIdRepositoriesPost(this.projectId(), req)
      ),
    onSuccess: (data) => {
      this.queryClient.invalidateQueries({ queryKey: ['project-repositories', this.projectId()] });
      this.saved.emit(data.repository!);
    },
  }));

  onSubmitted(data: RepositoryFormData) {
    const archetype = data.archetype as RepositoryArchetype | undefined;
    this.createMutation.mutate({
      url: data.url,
      archetype: archetype || undefined,
      importSubmodules: data.importSubmodules,
    });
  }
}
