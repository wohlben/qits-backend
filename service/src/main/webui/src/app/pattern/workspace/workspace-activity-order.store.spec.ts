import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import type { WorkspaceDto } from '@/api/model/workspaceDto';
import { WorkspaceActivityOrderStore } from './workspace-activity-order.store';

function ws(workspaceId: string, agentActivity?: string): WorkspaceDto {
  return { workspaceId, agentActivity } as WorkspaceDto;
}

describe('WorkspaceActivityOrderStore', () => {
  let store: InstanceType<typeof WorkspaceActivityOrderStore>;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    store = TestBed.inject(WorkspaceActivityOrderStore);
  });

  it('stamps a change time for a newly active workspace', () => {
    store.observe([ws('a', 'BUSY')]);
    expect(store.changedAt('a')).toBeGreaterThan(0);
  });

  it('does not restamp an unchanged state', () => {
    store.observe([ws('a', 'BUSY')]);
    const first = store.changedAt('a');
    store.observe([ws('a', 'BUSY')]);
    expect(store.changedAt('a')).toBe(first);
  });

  it('restamps when the state flips', () => {
    vi.useFakeTimers();
    try {
      store.observe([ws('a', 'IDLE')]);
      const first = store.changedAt('a');
      vi.advanceTimersByTime(10);
      store.observe([ws('a', 'BUSY')]);
      expect(store.changedAt('a')).toBeGreaterThan(first);
    } finally {
      vi.useRealTimers();
    }
  });

  it('forgets a workspace whose activity goes null (ENDED / stopped)', () => {
    store.observe([ws('a', 'WAITING')]);
    expect(store.changedAt('a')).toBeGreaterThan(0);
    store.observe([ws('a', undefined)]);
    expect(store.changedAt('a')).toBe(0);
  });

  it('ignores workspaces with no activity', () => {
    store.observe([ws('a', undefined), ws('b', 'BUSY')]);
    expect(store.changedAt('a')).toBe(0);
    expect(store.changedAt('b')).toBeGreaterThan(0);
  });

  it('orders the most recently changed workspace first', () => {
    vi.useFakeTimers();
    try {
      store.observe([ws('a', 'BUSY')]);
      vi.advanceTimersByTime(10);
      store.observe([ws('a', 'BUSY'), ws('b', 'BUSY')]);
      // b changed after a, so b sorts first.
      expect(store.changedAt('b')).toBeGreaterThan(store.changedAt('a'));
    } finally {
      vi.useRealTimers();
    }
  });
});
