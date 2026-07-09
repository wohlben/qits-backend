import { CommandStatus } from '@/api/model/commandStatus';
import { ZardBadgeTypeVariants } from '@/shared/components/badge';

/** The badge variant for a command status — one mapping shared by every command list surface. */
export function commandStatusBadgeType(status: CommandStatus | undefined): ZardBadgeTypeVariants {
  switch (status) {
    case CommandStatus.Running:
      return 'default';
    case CommandStatus.Terminated:
      return 'destructive';
    case CommandStatus.Interrupted:
      return 'outline';
    default:
      return 'secondary';
  }
}

export function commandStatusLabel(status: CommandStatus | undefined): string {
  return status ? status.toLowerCase() : 'unknown';
}
