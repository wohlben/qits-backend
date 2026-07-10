import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import { AgentSessionRefDto } from '@/api/model/agentSessionRefDto';

/**
 * The sessions one command drove, in the order it drove them — the per-command face of the
 * lineage the data model records (`command_agent_session`). Most commands have exactly one entry;
 * an interactive run whose operator ran `/resume` inside the TUI lists every session it crossed
 * (`SWITCHED` entries), duplicates included. The last entry is the command's current session —
 * the one Resume/Fork act on — and is marked as such when the list has more than one. Each row is
 * `source · sessionId · recordedAt`, plus the fork origin on `FORKED` entries.
 */
@Component({
  selector: 'app-agent-session-refs',
  imports: [DatePipe],
  template: `
    <section class="flex flex-col gap-2" aria-label="Agent sessions">
      <h2 class="text-sm font-semibold text-muted-foreground">Sessions</h2>
      <ul class="flex flex-col gap-1">
        @for (ref of sessions(); track $index; let last = $last) {
          <li class="flex flex-wrap items-center gap-2 rounded-md border px-3 py-1.5 text-sm">
            <span class="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
              {{ ref.source }}
            </span>
            <span class="min-w-0 truncate font-mono text-xs">{{ ref.sessionId }}</span>
            <span aria-hidden="true" class="text-muted-foreground">·</span>
            <span class="whitespace-nowrap text-muted-foreground">
              {{ ref.recordedAt | date: 'MMM d, HH:mm' }}
            </span>
            @if (ref.forkedFromSessionId) {
              <span class="min-w-0 truncate text-xs text-muted-foreground">
                forked from {{ ref.forkedFromSessionId }}
              </span>
            }
            @if (last && sessions().length > 1) {
              <span
                class="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
              >
                current
              </span>
            }
          </li>
        }
      </ul>
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgentSessionRefsComponent {
  readonly sessions = input.required<readonly AgentSessionRefDto[]>();
}
