import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { EpicControllerService } from '@/api/api/epicController.service';
import { PageLayoutComponent } from '@/layout/page-layout/page-layout.component';
import { EpicCreateUpdateFormComponent } from '@/pattern/epic/epic-create-update-form.component';

@Component({
  selector: 'app-epic-form-page',
  imports: [EpicCreateUpdateFormComponent, PageLayoutComponent],
  template: `
    <app-page-layout [hasActions]="false">
      <div pageTitle>
        <h1 class="text-2xl font-bold">{{ isEdit() ? 'Edit Epic' : 'New Epic' }}</h1>
      </div>
      @if (isEdit() && epicQuery.isPending()) {
        <div class="text-muted-foreground">Loading epic…</div>
      } @else if (isEdit() && epicQuery.isError()) {
        <div class="text-destructive">Failed to load epic</div>
      } @else {
        <app-epic-create-update-form [projectId]="projectId" [epic]="epic()" />
      }
    </app-page-layout>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EpicFormPage {
  private readonly route = inject(ActivatedRoute);
  private readonly epicService = inject(EpicControllerService);

  readonly projectId = this.route.snapshot.paramMap.get('projectId')!;
  readonly epicId = this.route.snapshot.paramMap.get('epicId');

  readonly epicQuery = injectQuery(() => ({
    queryKey: ['epic', this.epicId ?? ''],
    queryFn: () =>
      lastValueFrom(this.epicService.apiEpicsIdGet(this.epicId!)).then((r) => r.epic!),
    enabled: () => !!this.epicId,
  }));

  readonly epic = computed(() => this.epicQuery.data());
  readonly isEdit = computed(() => !!this.epicId);
}
