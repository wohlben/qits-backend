import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { page } from 'vitest/browser';

import { AuditEntryDto } from '@/api/model/auditEntryDto';
import { AuditEntryRowComponent } from './audit-entry-row.component';

/** Visual regression for the epic audit trail rows (one badge style per operation). */

const ENTRIES: AuditEntryDto[] = [
  {
    id: 'audit-3',
    entityType: 'TASK',
    entityId: 'task-1',
    epicId: 'epic-1',
    operation: 'DELETE',
    changedBy: 'dev',
    changedAt: '2026-07-25T12:15:00Z',
  },
  {
    id: 'audit-2',
    entityType: 'FEATURE',
    entityId: 'feature-1',
    epicId: 'epic-1',
    operation: 'UPDATE',
    changedBy: 'alice',
    changedAt: '2026-07-25T10:00:00Z',
  },
  {
    id: 'audit-1',
    entityType: 'EPIC',
    entityId: 'epic-1',
    epicId: 'epic-1',
    operation: 'CREATE',
    changedBy: 'dev',
    changedAt: '2026-07-25T08:30:00Z',
  },
];

@Component({
  imports: [AuditEntryRowComponent],
  template: `
    <div data-testid="audit-list" class="bg-background p-6" style="width: 720px">
      <div class="flex flex-col divide-y">
        @for (entry of entries; track entry.id) {
          <app-audit-entry-row [entry]="entry" />
        }
      </div>
    </div>
  `,
})
class AuditListHost {
  readonly entries = ENTRIES;
}

describe('AuditEntryRowComponent (visual)', () => {
  it('renders create, update and delete rows with operation badges', async () => {
    const fixture = TestBed.createComponent(AuditListHost);
    document.body.style.margin = '0';
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    await expect.element(page.getByTestId('audit-list')).toMatchScreenshot('audit-list');
  });
});
