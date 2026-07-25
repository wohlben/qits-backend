import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { injectMutation, injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { EpicControllerService } from '@/api/api/epicController.service';
import { PageLayoutComponent } from '@/layout/page-layout/page-layout.component';
import { EpicAuditListComponent } from '@/pattern/epic/epic-audit-list.component';
import { EpicFeatureListComponent } from '@/pattern/epic/epic-feature-list.component';
import { EpicDetailHeaderComponent } from '@/ui/components/epic/epic-detail-header.component';
import { ZardButtonComponent } from '@/shared/components/button';

@Component({
  selector: 'app-epic-detail-page',
  imports: [
    EpicAuditListComponent,
    EpicDetailHeaderComponent,
    EpicFeatureListComponent,
    PageLayoutComponent,
    RouterLink,
    ZardButtonComponent,
  ],
  template: `
    <app-page-layout
      [request]="epicQuery"
      pendingText="Loading epic…"
      errorText="Failed to load epic"
    >
      <ng-template #pageTitle let-epic>
        <app-epic-detail-header [epic]="epic" />
      </ng-template>

      <div pageActions>
        <a z-button [routerLink]="['/projects', projectId, 'epics', epicId, 'edit']">Edit</a>
        <button
          z-button
          zType="destructive"
          (click)="onDelete()"
          [zLoading]="deleteMutation.isPending()"
        >
          Delete
        </button>
      </div>

      <div class="flex flex-col gap-8">
        <app-epic-feature-list [projectId]="projectId" [epicId]="epicId" />
        <app-epic-audit-list [epicId]="epicId" />
      </div>
    </app-page-layout>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EpicDetailPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly epicService = inject(EpicControllerService);
  private readonly queryClient = inject(QueryClient);

  readonly projectId = this.route.snapshot.paramMap.get('projectId')!;
  readonly epicId = this.route.snapshot.paramMap.get('epicId')!;

  readonly epicQuery = injectQuery(() => ({
    queryKey: ['epic', this.epicId],
    queryFn: () =>
      lastValueFrom(this.epicService.apiEpicsIdGet(this.epicId)).then((r) => r.epic!),
  }));

  readonly deleteMutation = injectMutation(() => ({
    mutationFn: () => lastValueFrom(this.epicService.apiEpicsIdDelete(this.epicId)),
    onSuccess: () => {
      this.queryClient.invalidateQueries({ queryKey: ['project-epics', this.projectId] });
      this.router.navigate(['/projects', this.projectId]);
    },
  }));

  onDelete() {
    if (confirm('Are you sure you want to delete this epic (including its features and tasks)?')) {
      this.deleteMutation.mutate();
    }
  }
}
