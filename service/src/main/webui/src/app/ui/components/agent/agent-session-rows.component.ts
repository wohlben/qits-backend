import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

/** One rendered row of the flattened session tree: a session card or a grayed subagent sidechain. */
export interface SessionRow {
  readonly key: string;
  readonly kind: 'session' | 'subagent';
  readonly depth: number;
  /** The fork lineage's accent (a border-color class); null on root lineages. */
  readonly branchClass: string | null;
  readonly date: string | null;
  readonly messageCount: number | null;
  readonly sessionId?: string;
  readonly newestCommandId?: string;
  readonly label?: string;
}

/**
 * The stable per-lineage accents. Complete literal class names so Tailwind's scanner picks them
 * up; assignment is a deterministic hash of the fork's session id.
 */
const FORK_PALETTE = [
  'border-l-sky-500',
  'border-l-amber-500',
  'border-l-emerald-500',
  'border-l-fuchsia-500',
  'border-l-rose-500',
  'border-l-indigo-500',
] as const;

export function forkBranchClass(sessionId: string): string {
  let hash = 0;
  for (let i = 0; i < sessionId.length; i++) {
    hash = (hash * 31 + sessionId.charCodeAt(i)) >>> 0;
  }
  return FORK_PALETTE[hash % FORK_PALETTE.length];
}

/**
 * Presentational list of flattened session-tree rows — `$date · $sessionId · $numOfMessages`,
 * kept deliberately minimal. Fork lineages indent under their origin with their stable accent
 * color on the left border; subagent sidechains render grayed (visually secondary to the sessions
 * an operator drove) and carry no navigation target. A session row navigates to the newest command
 * that drove it; the current session's row is highlighted, and a running (unswept) one shows a
 * "live" placeholder count. Dates render in UTC so captures stay machine-independent.
 */
@Component({
  selector: 'app-agent-session-rows',
  imports: [DatePipe, RouterLink],
  template: `
    <ul class="flex flex-col gap-1">
      @for (row of rows(); track row.key) {
        <li [style.margin-left.rem]="row.depth * 1.5">
          @if (row.kind === 'session') {
            <a
              class="flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent"
              [class]="row.branchClass ? 'border-l-4 ' + row.branchClass : ''"
              [class.ring-2]="row.sessionId === currentSessionId()"
              [class.ring-primary]="row.sessionId === currentSessionId()"
              [routerLink]="row.newestCommandId ? ['/commands', row.newestCommandId] : null"
            >
              <span class="whitespace-nowrap text-muted-foreground">
                {{ row.date | date: 'MMM d, HH:mm' : 'UTC' }}
              </span>
              <span aria-hidden="true" class="text-muted-foreground">·</span>
              <span class="min-w-0 truncate font-mono text-xs">{{ row.sessionId }}</span>
              <span aria-hidden="true" class="text-muted-foreground">·</span>
              <span class="whitespace-nowrap">
                @if (row.messageCount !== null) {
                  {{ row.messageCount }} messages
                } @else if (row.sessionId === currentSessionId()) {
                  live
                } @else {
                  —
                }
              </span>
            </a>
          } @else {
            <div
              class="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground"
              [class]="row.branchClass ? 'border-l-4 ' + row.branchClass : ''"
            >
              <span class="whitespace-nowrap">{{ row.date | date: 'MMM d, HH:mm' : 'UTC' }}</span>
              <span aria-hidden="true">·</span>
              <span class="min-w-0 truncate">{{ row.label }}</span>
              <span aria-hidden="true">·</span>
              <span class="whitespace-nowrap">{{ row.messageCount }} messages</span>
            </div>
          }
        </li>
      }
    </ul>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgentSessionRowsComponent {
  readonly rows = input.required<readonly SessionRow[]>();

  /** The embedded run's current session — its row is highlighted and reads "live" when unswept. */
  readonly currentSessionId = input<string | null>(null);
}
