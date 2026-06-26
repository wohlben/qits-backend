import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import { ProjectDto } from '@/api/model/projectDto';

@Component({
  selector: 'app-project-detail-header',
  template: `
    <div class="flex flex-col gap-1">
      <h1 class="text-2xl font-bold">{{ project().name }}</h1>
      @if (project().description) {
        <p class="text-sm text-muted-foreground">{{ project().description }}</p>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectDetailHeaderComponent {
  readonly project = input.required<ProjectDto>();
}
