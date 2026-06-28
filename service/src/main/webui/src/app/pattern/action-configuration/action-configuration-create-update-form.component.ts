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

  readonly initialData = computed<ActionConfigurationFormData | undefined>(() => {
    const a = this.action();
    return a
      ? {
          name: a.name ?? '',
          description: a.description ?? '',
          executeScript: a.executeScript ?? '',
          checkScript: a.checkScript ?? '',
          interactive: a.interactive ?? false,
          environment: Object.entries(a.environment ?? {}).map(([key, value]) => ({ key, value })),
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
    const request = {
      name: data.name,
      description: data.description,
      executeScript: data.executeScript,
      // Send "" (not undefined) so an emptied check script clears the stored value on update.
      checkScript: data.checkScript,
      interactive: data.interactive,
      environment: this.toEnvMap(data.environment),
    };
    if (this.action()) {
      this.updateMutation.mutate(request);
    } else {
      this.createMutation.mutate(request);
    }
  }

  /** Collapse the editor rows into a map, dropping rows with a blank key and keeping the last dup. */
  private toEnvMap(rows: { key: string; value: string }[]): { [key: string]: string } {
    const map: { [key: string]: string } = {};
    for (const row of rows) {
      const key = row.key.trim();
      if (key) map[key] = row.value;
    }
    return map;
  }

  onCancel() {
    if (this.action()) {
      this.router.navigate(['/action-configurations', this.action()!.id!]);
    } else {
      this.router.navigate(['/action-configurations']);
    }
  }
}
