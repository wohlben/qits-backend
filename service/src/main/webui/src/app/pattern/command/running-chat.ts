import { CommandDto } from '@/api/model/commandDto';
import { CommandKind } from '@/api/model/commandKind';
import { CommandStatus } from '@/api/model/commandStatus';

/**
 * The chat session that "belongs" to a workspace: the newest (by launch time) still-running
 * {@code CHAT} command for it, or null when none is running. The commands registry is the source
 * of truth, so a chat started from anywhere (WIP route, Commands page) is found here too. If
 * several are running for one workspace the newest wins — the Commands page shows all of them.
 */
export function newestRunningChat(
  commands: readonly CommandDto[] | undefined,
  workspaceId: string,
): CommandDto | null {
  const chats = (commands ?? []).filter(
    (c) =>
      c.kind === CommandKind.Chat &&
      c.status === CommandStatus.Running &&
      c.workspaceId === workspaceId,
  );
  if (chats.length === 0) return null;
  return chats.reduce((newest, c) => (launchMillis(c) > launchMillis(newest) ? c : newest));
}

/** Missing/unparsable launchedAt sorts as oldest, so a well-formed command always wins. */
function launchMillis(command: CommandDto): number {
  const millis = Date.parse(command.launchedAt ?? '');
  return Number.isNaN(millis) ? Number.NEGATIVE_INFINITY : millis;
}
