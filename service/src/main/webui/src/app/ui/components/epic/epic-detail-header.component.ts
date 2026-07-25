import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { DatePipe } from '@angular/common';

import { EpicDto } from '@/api/model/epicDto';
import { MarkdownComponent } from '@/ui/components/markdown/markdown.component';

@Component({
  selector: 'app-epic-detail-header',
  imports: [DatePipe, MarkdownComponent],
  template: `
    <div class="flex flex-col gap-1">
      <h1 class="text-2xl font-bold">{{ epic().title }}</h1>
      <p class="text-xs text-muted-foreground">
        Created {{ epic().createdAt | date: 'medium' }} · Updated
        {{ epic().updatedAt | date: 'medium' }}
      </p>
      @if (epic().description) {
        <div class="text-sm text-muted-foreground mt-1">
          <app-markdown [text]="epic().description!" />
        </div>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EpicDetailHeaderComponent {
  readonly epic = input.required<EpicDto>();
}
