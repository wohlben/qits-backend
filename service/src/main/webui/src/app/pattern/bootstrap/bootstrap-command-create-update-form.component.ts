import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { Router } from '@angular/router';
import { injectMutation, QueryClient } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { BootstrapCommandControllerService } from '@/api/api/bootstrapCommandController.service';
import { BootstrapCommandDto } from '@/api/model/bootstrapCommandDto';
import { CreateBootstrapCommandRequest } from '@/api/model/createBootstrapCommandRequest';
import { UpdateBootstrapCommandRequest } from '@/api/model/updateBootstrapCommandRequest';
import { ZardButtonComponent } from '@/shared/components/button';
import {
  BootstrapCommandFormComponent,
  BootstrapCommandFormData,
} from '@/ui/forms/bootstrap/bootstrap-command-form.component';

@Component({
  selector: 'app-bootstrap-command-create-update-form',
  imports: [BootstrapCommandFormComponent, ZardButtonComponent],
  template: `
    <app-bootstrap-command-form
      [initialData]="initialData()"
      [loading]="createMutation.isPending() || updateMutation.isPending()"
      (submitted)="onSubmitted($event)"
    >
      <button formActions z-button zType="secondary" type="button" (click)="onCancel()">
        Cancel
      </button>
      @if (command()) {
        <button
          formActions
          z-button
          zType="destructive"
          type="button"
          [zLoading]="deleteMutation.isPending()"
          (click)="onDelete()"
        >
          Delete
        </button>
      }
    </app-bootstrap-command-form>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BootstrapCommandCreateUpdateFormComponent {
  readonly repoId = input.required<string>();
  readonly command = input<BootstrapCommandDto>();
  readonly saved = output<void>();

  private readonly bootstrapService = inject(BootstrapCommandControllerService);
  private readonly queryClient = inject(QueryClient);
  private readonly router = inject(Router);

  readonly initialData = computed<BootstrapCommandFormData | undefined>(() => {
    const c = this.command();
    return c
      ? {
          name: c.name ?? '',
          description: c.description ?? '',
          executeScript: c.executeScript ?? '',
          checkScript: c.checkScript ?? '',
          environment: Object.entries(c.environment ?? {}).map(([key, value]) => ({ key, value })),
        }
      : undefined;
  });

  readonly createMutation = injectMutation(() => ({
    mutationFn: (req: CreateBootstrapCommandRequest) =>
      lastValueFrom(
        this.bootstrapService.apiRepositoriesRepositoryIdBootstrapCommandsPost(this.repoId(), req),
      ),
    onSuccess: () => this.afterSave(),
  }));

  readonly updateMutation = injectMutation(() => ({
    mutationFn: (req: UpdateBootstrapCommandRequest) =>
      lastValueFrom(
        // NB: the generated client orders path params alphabetically (commandId, repositoryId).
        this.bootstrapService.apiRepositoriesRepositoryIdBootstrapCommandsCommandIdPut(
          this.command()!.id!,
          this.repoId(),
          req,
        ),
      ),
    onSuccess: () => this.afterSave(),
  }));

  readonly deleteMutation = injectMutation(() => ({
    mutationFn: () =>
      lastValueFrom(
        this.bootstrapService.apiRepositoriesRepositoryIdBootstrapCommandsCommandIdDelete(
          this.command()!.id!,
          this.repoId(),
        ),
      ),
    onSuccess: () => this.afterSave(),
  }));

  onSubmitted(data: BootstrapCommandFormData) {
    const request = {
      name: data.name,
      description: data.description,
      executeScript: data.executeScript,
      // Send "" (not undefined) so an emptied check script clears the stored value on update.
      checkScript: data.checkScript,
      environment: this.toEnvMap(data.environment),
    };
    if (this.command()) {
      this.updateMutation.mutate(request);
    } else {
      this.createMutation.mutate(request);
    }
  }

  onDelete() {
    this.deleteMutation.mutate();
  }

  onCancel() {
    this.router.navigate(['/repositories', this.repoId(), 'bootstrap']);
  }

  private afterSave() {
    this.queryClient.invalidateQueries({
      queryKey: ['repository-bootstrap-commands', this.repoId()],
    });
    const id = this.command()?.id;
    if (id) {
      this.queryClient.invalidateQueries({
        queryKey: ['repository-bootstrap-command', this.repoId(), id],
      });
    }
    this.router.navigate(['/repositories', this.repoId(), 'bootstrap']);
    this.saved.emit();
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
}
