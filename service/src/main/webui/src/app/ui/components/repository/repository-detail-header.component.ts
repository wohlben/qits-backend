import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import { RepositoryDto } from '@/api/model/repositoryDto';

@Component({
  selector: 'app-repository-detail-header',
  template: `
    <div class="flex flex-col gap-1">
      <h1 class="text-2xl font-bold break-all">{{ repository().url }}</h1>
      @if (repository().archetype) {
        <p class="text-sm text-muted-foreground">{{ repository().archetype }}</p>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RepositoryDetailHeaderComponent {
  readonly repository = input.required<RepositoryDto>();
}
