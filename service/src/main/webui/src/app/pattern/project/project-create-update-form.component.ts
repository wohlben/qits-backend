import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { Router } from '@angular/router';
import { injectMutation, QueryClient } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { ProjectControllerService } from '@/api/api/projectController.service';
import { CreateProjectRequest } from '@/api/model/createProjectRequest';
import { ProjectDto } from '@/api/model/projectDto';
import { UpdateProjectRequest } from '@/api/model/updateProjectRequest';
import { ProjectFormComponent, ProjectFormData } from '@/ui/forms/project/project-form.component';
import { ZardButtonComponent } from '@/shared/components/button';

@Component({
  selector: 'app-project-create-update-form',
  imports: [ProjectFormComponent, ZardButtonComponent],
  template: `
    <app-project-form
      [initialData]="initialData()"
      [editing]="!!project()"
      [loading]="createMutation.isPending() || updateMutation.isPending()"
      (submitted)="onSubmitted($event)"
    >
      <button formActions z-button zType="secondary" type="button" (click)="onCancel()">Cancel</button>
    </app-project-form>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectCreateUpdateFormComponent {
  readonly project = input<ProjectDto>();
  readonly saved = output<void>();

  private readonly projectService = inject(ProjectControllerService);
  private readonly queryClient = inject(QueryClient);
  private readonly router = inject(Router);

  readonly initialData = computed(() => {
    const p = this.project();
    return p ? { name: p.name ?? '', slug: p.slug ?? '', description: p.description ?? '' } : undefined;
  });

  readonly createMutation = injectMutation(() => ({
    mutationFn: (req: CreateProjectRequest) =>
      lastValueFrom(this.projectService.apiProjectsPost(req)),
    onSuccess: () => {
      this.queryClient.invalidateQueries({ queryKey: ['projects'] });
      this.router.navigate(['/projects']);
      this.saved.emit();
    },
  }));

  readonly updateMutation = injectMutation(() => ({
    mutationFn: (req: UpdateProjectRequest) =>
      lastValueFrom(this.projectService.apiProjectsIdPut(this.project()!.id!, req)),
    onSuccess: () => {
      const id = this.project()!.id!;
      this.queryClient.invalidateQueries({ queryKey: ['projects'] });
      this.queryClient.invalidateQueries({ queryKey: ['project', id] });
      this.router.navigate(['/projects', id]);
      this.saved.emit();
    },
  }));

  onSubmitted(data: ProjectFormData) {
    if (this.project()) {
      // The slug is immutable, so an update never carries it.
      this.updateMutation.mutate({ name: data.name, description: data.description });
    } else {
      // A blank slug means "derive it from the name" — send undefined, not an empty string, which
      // would fail the format check.
      this.createMutation.mutate({
        name: data.name,
        slug: data.slug?.trim() ? data.slug.trim() : undefined,
        description: data.description,
      });
    }
  }

  onCancel() {
    if (this.project()) {
      this.router.navigate(['/projects', this.project()!.id!]);
    } else {
      this.router.navigate(['/projects']);
    }
  }
}
