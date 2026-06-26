import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { Router } from '@angular/router';
import { injectMutation, QueryClient } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { ActionConfigurationControllerService } from '@/api/api/actionConfigurationController.service';
import { ActionConfigurationDto } from '@/api/model/actionConfigurationDto';
import { CreateActionConfigurationRequest } from '@/api/model/createActionConfigurationRequest';
import { UpdateActionConfigurationRequest } from '@/api/model/updateActionConfigurationRequest';
import { ActionConfigurationFormComponent, ActionConfigurationFormData } from '@/ui/forms/action-configuration/action-configuration-form.component';
import { ZardButtonComponent } from '@/shared/components/button';

@Component({
  selector: 'app-action-configuration-create-update-form',
  imports: [ActionConfigurationFormComponent, ZardButtonComponent],
  template: `
    <app-action-configuration-form
      [initialData]="initialData()"
      [loading]="createMutation.isPending() || updateMutation.isPending()"
      (submitted)="onSubmitted($event)"
    >
      <button formActions z-button zType="secondary" type="button" (click)="onCancel()">Cancel</button>
    </app-action-configuration-form>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ActionConfigurationCreateUpdateFormComponent {
  readonly action = input<ActionConfigurationDto>();
  readonly saved = output<void>();

  private readonly actionService = inject(ActionConfigurationControllerService);
  private readonly queryClient = inject(QueryClient);
  private readonly router = inject(Router);

  readonly initialData = computed(() => {
    const a = this.action();
    return a
      ? {
          name: a.name ?? '',
          description: a.description ?? '',
          executeScript: a.executeScript ?? '',
          checkScript: a.checkScript ?? '',
        }
      : undefined;
  });

  readonly createMutation = injectMutation(() => ({
    mutationFn: (req: CreateActionConfigurationRequest) =>
      lastValueFrom(this.actionService.apiActionConfigurationsPost(req)),
    onSuccess: () => {
      this.queryClient.invalidateQueries({ queryKey: ['action-configurations'] });
      this.router.navigate(['/action-configurations']);
      this.saved.emit();
    },
  }));

  readonly updateMutation = injectMutation(() => ({
    mutationFn: (req: UpdateActionConfigurationRequest) =>
      lastValueFrom(this.actionService.apiActionConfigurationsIdPut(this.action()!.id!, req)),
    onSuccess: () => {
      const id = this.action()!.id!;
      this.queryClient.invalidateQueries({ queryKey: ['action-configurations'] });
      this.queryClient.invalidateQueries({ queryKey: ['action-configuration', id] });
      this.router.navigate(['/action-configurations', id]);
      this.saved.emit();
    },
  }));

  onSubmitted(data: ActionConfigurationFormData) {
    if (this.action()) {
      this.updateMutation.mutate(data);
    } else {
      this.createMutation.mutate(data);
    }
  }

  onCancel() {
    if (this.action()) {
      this.router.navigate(['/action-configurations', this.action()!.id!]);
    } else {
      this.router.navigate(['/action-configurations']);
    }
  }
}
