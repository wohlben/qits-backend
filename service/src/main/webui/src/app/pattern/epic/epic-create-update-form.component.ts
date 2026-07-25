import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { Router } from '@angular/router';
import { injectMutation, QueryClient } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { EpicControllerService } from '@/api/api/epicController.service';
import { ProjectEpicsControllerService } from '@/api/api/projectEpicsController.service';
import { CreateEpicRequest } from '@/api/model/createEpicRequest';
import { EpicDto } from '@/api/model/epicDto';
import { UpdateEpicRequest } from '@/api/model/updateEpicRequest';
import { ZardButtonComponent } from '@/shared/components/button';
import { errorMessage } from '@/shared/utils/error-message';
import { EpicFormComponent, EpicFormData } from '@/ui/forms/epic/epic-form.component';

@Component({
  selector: 'app-epic-create-update-form',
  imports: [EpicFormComponent, ZardButtonComponent],
  template: `
    @if (error(); as err) {
      <div class="mb-4 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
        {{ err }}
      </div>
    }
    <app-epic-form
      [initialData]="initialData()"
      [loading]="createMutation.isPending() || updateMutation.isPending()"
      (submitted)="onSubmitted($event)"
    >
      <button formActions z-button zType="secondary" type="button" (click)="onCancel()">
        Cancel
      </button>
    </app-epic-form>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EpicCreateUpdateFormComponent {
  readonly projectId = input.required<string>();
  readonly epic = input<EpicDto>();
  readonly saved = output<void>();

  private readonly projectEpicsService = inject(ProjectEpicsControllerService);
  private readonly epicService = inject(EpicControllerService);
  private readonly queryClient = inject(QueryClient);
  private readonly router = inject(Router);

  readonly initialData = computed(() => {
    const e = this.epic();
    return e ? { title: e.title ?? '', description: e.description ?? '' } : undefined;
  });

  readonly error = computed(() => {
    const err = this.createMutation.error() ?? this.updateMutation.error();
    return err ? errorMessage(err, 'Failed to save the epic') : null;
  });

  readonly createMutation = injectMutation(() => ({
    mutationFn: (req: CreateEpicRequest) =>
      lastValueFrom(this.projectEpicsService.apiProjectsProjectIdEpicsPost(this.projectId(), req)),
    onSuccess: () => {
      this.queryClient.invalidateQueries({ queryKey: ['project-epics', this.projectId()] });
      this.router.navigate(['/projects', this.projectId()]);
      this.saved.emit();
    },
  }));

  readonly updateMutation = injectMutation(() => ({
    mutationFn: (req: UpdateEpicRequest) =>
      lastValueFrom(this.epicService.apiEpicsIdPut(this.epic()!.id!, req)),
    onSuccess: () => {
      const id = this.epic()!.id!;
      this.queryClient.invalidateQueries({ queryKey: ['project-epics', this.projectId()] });
      this.queryClient.invalidateQueries({ queryKey: ['epic', id] });
      this.queryClient.invalidateQueries({ queryKey: ['epic-audit', id] });
      this.router.navigate(['/projects', this.projectId(), 'epics', id]);
      this.saved.emit();
    },
  }));

  onSubmitted(data: EpicFormData) {
    const req = { title: data.title, description: data.description || undefined };
    if (this.epic()) {
      this.updateMutation.mutate(req);
    } else {
      this.createMutation.mutate(req);
    }
  }

  onCancel() {
    const e = this.epic();
    if (e) {
      this.router.navigate(['/projects', this.projectId(), 'epics', e.id]);
    } else {
      this.router.navigate(['/projects', this.projectId()]);
    }
  }
}
