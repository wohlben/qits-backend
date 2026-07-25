import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { ProjectEpicsControllerService } from '@/api/api/projectEpicsController.service';
import { ZardButtonComponent } from '@/shared/components/button';
import { EmptyStateComponent } from '@/ui/components/empty-state/empty-state.component';
import { EpicCardComponent } from '@/ui/components/epic/epic-card.component';

@Component({
  selector: 'app-project-epic-list',
  imports: [EpicCardComponent, EmptyStateComponent, RouterLink, ZardButtonComponent],
  template: `
    <div class="flex flex-col gap-4">
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold">Epics</h2>
        <a z-button zType="secondary" zSize="sm" [routerLink]="['/projects', projectId(), 'epics', 'new']">
          New Epic
        </a>
      </div>

      @if (epicsQuery.isPending()) {
        <div class="text-sm text-muted-foreground">Loading epics…</div>
      } @else if (epicsQuery.isError()) {
        <div class="text-sm text-destructive">Failed to load epics</div>
      } @else {
        @let epics = epicsQuery.data() ?? [];
        @if (epics.length === 0) {
          <app-empty-state>
            <span title>No epics</span>
            <span description>This project has no epics yet</span>
          </app-empty-state>
        } @else {
          <div class="flex flex-col gap-2">
            @for (epic of epics; track epic.id) {
              <app-epic-card [epic]="epic" [projectId]="projectId()" />
            }
          </div>
        }
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectEpicListComponent {
  readonly projectId = input.required<string>();

  private readonly projectEpicsService = inject(ProjectEpicsControllerService);

  readonly epicsQuery = injectQuery(() => ({
    queryKey: ['project-epics', this.projectId()],
    queryFn: () =>
      lastValueFrom(this.projectEpicsService.apiProjectsProjectIdEpicsGet(this.projectId())).then(
        (r) => r.entries?.map((e) => e.epic!).filter((p): p is NonNullable<typeof p> => !!p) ?? []
      ),
  }));
}
