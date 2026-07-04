import { CommandDto } from '@/api/model/commandDto';
import { CommandKind } from '@/api/model/commandKind';
import { CommandStatus } from '@/api/model/commandStatus';
import { newestRunningChat } from './running-chat';

function chat(overrides: Partial<CommandDto>): CommandDto {
  return {
    id: 'cmd-1',
    worktreeId: 'wt-1',
    kind: CommandKind.Chat,
    status: CommandStatus.Running,
    launchedAt: '2026-07-04T10:00:00Z',
    ...overrides,
  } as CommandDto;
}

describe('newestRunningChat', () => {
  it('returns null for undefined or empty input', () => {
    expect(newestRunningChat(undefined, 'wt-1')).toBeNull();
    expect(newestRunningChat([], 'wt-1')).toBeNull();
  });

  it('picks the newest of multiple running chats by launchedAt', () => {
    const older = chat({ id: 'cmd-old', launchedAt: '2026-07-04T09:00:00Z' });
    const newer = chat({ id: 'cmd-new', launchedAt: '2026-07-04T11:00:00Z' });
    expect(newestRunningChat([older, newer], 'wt-1')?.id).toBe('cmd-new');
    expect(newestRunningChat([newer, older], 'wt-1')?.id).toBe('cmd-new');
  });

  it('excludes finished chats regardless of how they ended', () => {
    const finished = [
      chat({ id: 'cmd-exited', status: CommandStatus.Exited }),
      chat({ id: 'cmd-terminated', status: CommandStatus.Terminated }),
      chat({ id: 'cmd-interrupted', status: CommandStatus.Interrupted }),
    ];
    expect(newestRunningChat(finished, 'wt-1')).toBeNull();

    const running = chat({ id: 'cmd-live', launchedAt: '2026-07-04T08:00:00Z' });
    expect(newestRunningChat([...finished, running], 'wt-1')?.id).toBe('cmd-live');
  });

  it("excludes other worktrees' chats", () => {
    const other = chat({ id: 'cmd-other', worktreeId: 'wt-2' });
    expect(newestRunningChat([other], 'wt-1')).toBeNull();
    expect(newestRunningChat([other], 'wt-2')?.id).toBe('cmd-other');
  });

  it('excludes terminal commands even when running in the same worktree', () => {
    const terminal = chat({ id: 'cmd-term', kind: CommandKind.Terminal });
    expect(newestRunningChat([terminal], 'wt-1')).toBeNull();
  });

  it('treats a missing launchedAt as oldest', () => {
    const undated = chat({ id: 'cmd-undated', launchedAt: undefined });
    const dated = chat({ id: 'cmd-dated' });
    expect(newestRunningChat([undated, dated], 'wt-1')?.id).toBe('cmd-dated');
    expect(newestRunningChat([undated], 'wt-1')?.id).toBe('cmd-undated');
  });
});
