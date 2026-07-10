import { TestBed } from '@angular/core/testing';

import { AgentSessionRefDto } from '@/api/model/agentSessionRefDto';
import { AgentSessionSource } from '@/api/model/agentSessionSource';
import { AgentSessionRefsComponent } from './agent-session-refs.component';

function ref(overrides: Partial<AgentSessionRefDto>): AgentSessionRefDto {
  return {
    sessionId: 'sess-1',
    source: AgentSessionSource.Pinned,
    recordedAt: '2026-07-10T10:00:00Z',
    ...overrides,
  };
}

describe('AgentSessionRefsComponent', () => {
  function createComponent(sessions: AgentSessionRefDto[]) {
    const fixture = TestBed.createComponent(AgentSessionRefsComponent);
    fixture.componentRef.setInput('sessions', sessions);
    fixture.detectChanges();
    return fixture;
  }

  function rows(fixture: { nativeElement: unknown }): HTMLLIElement[] {
    return Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('li'));
  }

  it('renders one row per session ref, in list order, as source · id · date', () => {
    const fixture = createComponent([
      ref({ sessionId: 'sess-a' }),
      ref({ sessionId: 'sess-b', source: AgentSessionSource.Switched }),
    ]);

    const items = rows(fixture);
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain('PINNED');
    expect(items[0].textContent).toContain('sess-a');
    expect(items[1].textContent).toContain('SWITCHED');
    expect(items[1].textContent).toContain('sess-b');
  });

  it('marks the last entry as the current session when the run crossed several', () => {
    const fixture = createComponent([
      ref({ sessionId: 'sess-a' }),
      ref({ sessionId: 'sess-b', source: AgentSessionSource.Switched }),
    ]);

    const [first, last] = rows(fixture);
    expect(first.textContent).not.toContain('current');
    expect(last.textContent).toContain('current');
  });

  it('shows no current marker on a single-session command', () => {
    const fixture = createComponent([ref({})]);
    expect(rows(fixture)[0].textContent).not.toContain('current');
  });

  it('shows the fork origin on FORKED entries', () => {
    const fixture = createComponent([
      ref({
        sessionId: 'sess-fork',
        source: AgentSessionSource.Forked,
        forkedFromSessionId: 'sess-origin',
      }),
    ]);

    const [row] = rows(fixture);
    expect(row.textContent).toContain('FORKED');
    expect(row.textContent).toContain('forked from sess-origin');
  });
});
