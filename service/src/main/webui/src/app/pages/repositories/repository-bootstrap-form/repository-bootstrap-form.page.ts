import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { BootstrapCommandControllerService } from '@/api/api/bootstrapCommandController.service';
import { PageLayoutComponent } from '@/layout/page-layout/page-layout.component';
import { BootstrapCommandCreateUpdateFormComponent } from '@/pattern/bootstrap/bootstrap-command-create-update-form.component';

@Component({
  selector: 'app-repository-bootstrap-form-page',
  imports: [PageLayoutComponent, BootstrapCommandCreateUpdateFormComponent],
  template: `
    <app-page-layout [hasActions]="false">
      <div pageTitle>
        <h1 class="text-2xl font-bold">
          {{ isEdit() ? 'Edit Bootstrap Command' : 'New Bootstrap Command' }}
        </h1>
      </div>
      @if (isEdit() && commandQuery.isPending()) {
        <div class="text-muted-foreground">Loading bootstrap command…</div>
      } @else if (isEdit() && commandQuery.isError()) {
        <div class="text-destructive">Failed to load bootstrap command</div>
      } @else {
        <app-bootstrap-command-create-update-form [repoId]="repoId" [command]="command()" />
      }
    </app-page-layout>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RepositoryBootstrapFormPage {
  private readonly route = inject(ActivatedRoute);
  private readonly bootstrapService = inject(BootstrapCommandControllerService);

  readonly repoId = this.route.snapshot.paramMap.get('repoId')!;
  readonly commandId = this.route.snapshot.paramMap.get('commandId');

  readonly commandQuery = injectQuery(() => ({
    queryKey: ['repository-bootstrap-command', this.repoId, this.commandId ?? ''],
    queryFn: () =>
      lastValueFrom(
        // NB: the generated client orders path params alphabetically (commandId, repositoryId).
        this.bootstrapService.apiRepositoriesRepositoryIdBootstrapCommandsCommandIdGet(
          this.commandId!,
          this.repoId,
        ),
      ).then((r) => r.command!),
    enabled: () => !!this.commandId,
  }));

  readonly command = computed(() => this.commandQuery.data());
  readonly isEdit = computed(() => !!this.commandId);
}
