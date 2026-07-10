import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { page } from 'vitest/browser';

import {
  AgentSessionRowsComponent,
  forkBranchClass,
  SessionRow,
} from './agent-session-rows.component';

// Deterministic fixture — stable session ids, fixed ISO dates (rendered in UTC by the component).
// Shaped like a real workspace history: two roots (newest first), a color-coded fork lineage
// under the older root, and a grayed subagent sidechain.
const ROWS: readonly SessionRow[] = [
  {
    key: 'f0a1b2c3-0000-4000-8000-000000000002',
    kind: 'session',
    depth: 0,
    branchClass: null,
    date: '2026-07-10T12:30:00Z',
    messageCount: null, // running: unswept counts render as the "live" placeholder
    sessionId: 'f0a1b2c3-0000-4000-8000-000000000002',
    newestCommandId: 'cmd-live',
  },
  {
    key: 'f0a1b2c3-0000-4000-8000-000000000001',
    kind: 'session',
    depth: 0,
    branchClass: null,
    date: '2026-07-10T09:15:00Z',
    messageCount: 12,
    sessionId: 'f0a1b2c3-0000-4000-8000-000000000001',
    newestCommandId: 'cmd-root',
  },
  {
    key: 'f0a1b2c3-0000-4000-8000-000000000001/a1b2',
    kind: 'subagent',
    depth: 1,
    branchClass: null,
    date: '2026-07-10T09:20:00Z',
    messageCount: 4,
    label: 'Explore: scan the failing tests',
  },
  {
    key: 'f0a1b2c3-0000-4000-8000-000000000003',
    kind: 'session',
    depth: 1,
    branchClass: forkBranchClass('f0a1b2c3-0000-4000-8000-000000000003'),
    date: '2026-07-10T10:00:00Z',
    messageCount: 7,
    sessionId: 'f0a1b2c3-0000-4000-8000-000000000003',
    newestCommandId: 'cmd-fork',
  },
];

@Component({
  imports: [AgentSessionRowsComponent],
  template: `
    <div data-testid="session-rows" class="bg-background p-6" style="width: 720px">
      <app-agent-session-rows
        [rows]="rows"
        currentSessionId="f0a1b2c3-0000-4000-8000-000000000002"
      />
    </div>
  `,
})
class SessionRowsHost {
  readonly rows = ROWS;
}

describe('AgentSessionRowsComponent (visual)', () => {
  it('renders the session tree — roots, a fork branch, and a subagent row', async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(SessionRowsHost);
    document.body.style.margin = '0';
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    await expect.element(page.getByTestId('session-rows')).toMatchScreenshot('session-tree');
  });
});
