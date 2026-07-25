import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { DatePipe } from '@angular/common';

import { AuditEntryDto } from '@/api/model/auditEntryDto';
import { AuditOperation } from '@/api/model/auditOperation';
import { ZardBadgeComponent } from '@/shared/components/badge';

@Component({
  selector: 'app-audit-entry-row',
  imports: [DatePipe, ZardBadgeComponent],
  template: `
    <div class="flex items-center gap-2 py-1.5 text-sm">
      <z-badge [zType]="badgeType()">{{ entry().operation }}</z-badge>
      <span class="font-medium">{{ entry().entityType }}</span>
      <span class="text-muted-foreground">by {{ entry().changedBy }}</span>
      <span class="ml-auto text-xs text-muted-foreground">
        {{ entry().changedAt | date: 'medium' }}
      </span>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuditEntryRowComponent {
  readonly entry = input.required<AuditEntryDto>();

  readonly badgeType = computed(() => {
    switch (this.entry().operation) {
      case AuditOperation.Delete:
        return 'destructive' as const;
      case AuditOperation.Update:
        return 'secondary' as const;
      default:
        return 'default' as const;
    }
  });
}
