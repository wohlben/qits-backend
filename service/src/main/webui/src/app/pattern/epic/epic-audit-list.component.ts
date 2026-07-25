import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { EpicControllerService } from '@/api/api/epicController.service';
import { AuditEntryRowComponent } from '@/ui/components/epic/audit-entry-row.component';

/** The epic's audit trail (whole subtree: epic + features + tasks), collapsed by default. */
@Component({
  selector: 'app-epic-audit-list',
  imports: [AuditEntryRowComponent],
  template: `
    <details class="flex flex-col gap-2">
      <summary class="cursor-pointer text-lg font-semibold">History</summary>

      @if (auditQuery.isPending()) {
        <div class="text-sm text-muted-foreground">Loading history…</div>
      } @else if (auditQuery.isError()) {
        <div class="text-sm text-destructive">Failed to load history</div>
      } @else {
        @let entries = auditQuery.data() ?? [];
        @if (entries.length === 0) {
          <div class="text-sm text-muted-foreground">No history yet</div>
        } @else {
          <div class="flex flex-col divide-y">
            @for (entry of entries; track entry.id) {
              <app-audit-entry-row [entry]="entry" />
            }
          </div>
        }
      }
    </details>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EpicAuditListComponent {
  readonly epicId = input.required<string>();

  private readonly epicService = inject(EpicControllerService);

  readonly auditQuery = injectQuery(() => ({
    queryKey: ['epic-audit', this.epicId()],
    queryFn: () =>
      lastValueFrom(this.epicService.apiEpicsIdAuditGet(this.epicId())).then(
        (r) => r.entries ?? []
      ),
  }));
}
