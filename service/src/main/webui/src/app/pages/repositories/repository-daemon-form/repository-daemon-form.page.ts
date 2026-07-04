import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { RepositoryDaemonControllerService } from '@/api/api/repositoryDaemonController.service';
import { PageLayoutComponent } from '@/layout/page-layout/page-layout.component';
import { RepositoryDaemonCreateUpdateFormComponent } from '@/pattern/daemon/repository-daemon-create-update-form.component';

@Component({
  selector: 'app-repository-daemon-form-page',
  imports: [PageLayoutComponent, RepositoryDaemonCreateUpdateFormComponent],
  template: `
    <app-page-layout [hasActions]="false">
      <div pageTitle>
        <h1 class="text-2xl font-bold">{{ isEdit() ? 'Edit Daemon' : 'New Daemon' }}</h1>
      </div>
      @if (isEdit() && daemonQuery.isPending()) {
        <div class="text-muted-foreground">Loading daemon…</div>
      } @else if (isEdit() && daemonQuery.isError()) {
        <div class="text-destructive">Failed to load daemon</div>
      } @else {
        <app-repository-daemon-create-update-form [repoId]="repoId" [daemon]="daemon()" />
      }
    </app-page-layout>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RepositoryDaemonFormPage {
  private readonly route = inject(ActivatedRoute);
  private readonly daemonService = inject(RepositoryDaemonControllerService);

  readonly repoId = this.route.snapshot.paramMap.get('repoId')!;
  readonly daemonId = this.route.snapshot.paramMap.get('daemonId');

  readonly daemonQuery = injectQuery(() => ({
    queryKey: ['repository-daemon', this.repoId, this.daemonId ?? ''],
    queryFn: () =>
      lastValueFrom(
        this.daemonService.apiRepositoriesRepositoryIdDaemonsDaemonIdGet(
          this.daemonId!,
          this.repoId,
        ),
      ).then((r) => r.daemon!),
    enabled: () => !!this.daemonId,
  }));

  readonly daemon = computed(() => this.daemonQuery.data());
  readonly isEdit = computed(() => !!this.daemonId);
}
