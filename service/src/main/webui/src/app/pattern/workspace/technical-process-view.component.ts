import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  effect,
  inject,
  input,
  output,
  signal,
  viewChildren,
} from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideChevronDown, lucideChevronRight } from '@ng-icons/lucide';

import { ZardBadgeComponent } from '@/shared/components/badge';
import { appUrl } from '@/shared/utils/app-base';

/** One SSE frame of a technical process's stream — the raw-EventSource wire contract. */
interface TechnicalProcessFrame {
  segment?: string | null;
  kind: 'segment-open' | 'line' | 'segment-settled' | 'done' | 'ping';
  seq: number;
  line?: string | null;
  status?: 'ok' | 'failed' | null;
}

interface SegmentView {
  name: string;
  status: 'open' | 'ok' | 'failed';
  lines: string[];
}

/**
 * The live, replayable view of one technical process (e.g. a workspace container start): a stack
 * of expanders, one per named segment, fed by the process's payload-bearing SSE stream. The active
 * segment auto-expands and settled ones collapse to a status line (a user's manual toggle wins);
 * the log body auto-scrolls while the segment streams. On the terminal `done` frame the source is
 * closed, the final state freezes, and `finished` fires so the host can refresh its queries — the
 * view itself stays up for reading until the host dismisses it.
 *
 * Rendered identically in two hosts: the branch list's "Starting workspace" dialog and the
 * workspace detail route's transient first tab. Reconnects (EventSource auto-retry) reset the
 * local state and rebuild it from the server's replay, so no diffing protocol is needed. Like
 * {@link WorkspaceLiveService}, this is a sanctioned raw-`EventSource` exception to the
 * no-raw-fetch rule.
 */
@Component({
  selector: 'app-technical-process-view',
  imports: [NgIcon, ZardBadgeComponent],
  template: `
    <div class="flex flex-col gap-2" role="log" aria-label="Technical process log">
      @if (segments().length === 0 && !done()) {
        <div class="text-sm text-muted-foreground">Waiting for output…</div>
      }
      @for (segment of segments(); track segment.name) {
        <div class="rounded-lg border">
          <button
            type="button"
            class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm"
            [attr.aria-expanded]="isExpanded(segment)"
            (click)="toggle(segment.name)"
          >
            <ng-icon
              [name]="isExpanded(segment) ? 'lucideChevronDown' : 'lucideChevronRight'"
              class="size-4 shrink-0 text-muted-foreground"
            />
            <span class="min-w-0 flex-1 truncate font-medium">{{ segment.name }}</span>
            <z-badge [zType]="badgeType(segment.status)">{{ statusLabel(segment.status) }}</z-badge>
          </button>
          @if (isExpanded(segment)) {
            <pre
              #logBody
              class="max-h-64 overflow-auto border-t bg-muted/30 p-3 font-mono text-xs whitespace-pre-wrap"
              >{{ segment.lines.join('\n') }}</pre
            >
          }
        </div>
      }
      @if (done(); as verdict) {
        <div
          class="text-sm"
          [class]="verdict === 'ok' ? 'text-muted-foreground' : 'text-destructive'"
        >
          {{ verdict === 'ok' ? 'Finished.' : 'Finished with errors.' }}
        </div>
      } @else if (lost()) {
        <div class="text-sm text-muted-foreground">
          The log stream ended before the process finished (it may have expired).
        </div>
      }
    </div>
  `,
  viewProviders: [provideIcons({ lucideChevronDown, lucideChevronRight })],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TechnicalProcessViewComponent {
  readonly processId = input.required<string>();

  /** Fires once, on the terminal `done` frame, with the process's overall verdict. */
  readonly finished = output<'ok' | 'failed'>();

  private readonly destroyRef = inject(DestroyRef);
  private readonly logBodies = viewChildren<ElementRef<HTMLElement>>('logBody');

  readonly segments = signal<SegmentView[]>([]);
  readonly done = signal<'ok' | 'failed' | null>(null);
  /** The stream closed for good without a `done` frame (e.g. the process expired server-side). */
  readonly lost = signal(false);

  /** Manual expander toggles; they override the open-expands/settled-collapses default. */
  private readonly toggled = signal<Record<string, boolean>>({});

  private source: EventSource | null = null;

  constructor() {
    // (Re)connect per process id; no EventSource under SSR / unit tests — specs drive
    // handleFrame/handleStreamEnd directly.
    effect(() => {
      const id = this.processId();
      this.disconnect();
      this.reset();
      if (typeof EventSource === 'undefined') {
        return;
      }
      const source = new EventSource(
        appUrl(`api/technical-processes/${encodeURIComponent(id)}/events`),
      );
      this.source = source;
      // A reconnect replays from scratch — drop the half-built state and rebuild.
      source.onopen = () => this.reset();
      source.onmessage = (event) => this.handleFrame(JSON.parse(event.data as string));
      source.onerror = () => {
        // EventSource retries transient errors itself; a CLOSED readyState is final (404 after
        // eviction, or the server completing the stream post-done).
        if (source.readyState === EventSource.CLOSED) {
          this.handleStreamEnd();
        }
      };
      this.destroyRef.onDestroy(() => this.disconnect());
    });

    // Keep streaming log bodies pinned to their newest line.
    effect(() => {
      this.segments();
      if (typeof requestAnimationFrame === 'undefined') {
        return;
      }
      requestAnimationFrame(() => {
        for (const body of this.logBodies()) {
          body.nativeElement.scrollTop = body.nativeElement.scrollHeight;
        }
      });
    });
  }

  /** Apply one frame to the local view state. Exposed for tests (FakeEventSource-free driving). */
  handleFrame(frame: TechnicalProcessFrame): void {
    switch (frame.kind) {
      case 'segment-open':
        if (frame.segment) {
          this.segments.update((list) =>
            list.some((s) => s.name === frame.segment)
              ? list
              : [...list, { name: frame.segment!, status: 'open', lines: [] }],
          );
        }
        break;
      case 'line':
        if (frame.segment) {
          this.segments.update((list) => {
            const segment = list.find((s) => s.name === frame.segment);
            if (!segment) {
              return [...list, { name: frame.segment!, status: 'open', lines: [frame.line ?? ''] }];
            }
            segment.lines.push(frame.line ?? '');
            return [...list];
          });
        }
        break;
      case 'segment-settled':
        if (frame.segment) {
          this.segments.update((list) => {
            const segment = list.find((s) => s.name === frame.segment);
            if (segment) {
              segment.status = frame.status === 'failed' ? 'failed' : 'ok';
            }
            return [...list];
          });
        }
        break;
      case 'done': {
        const verdict = frame.status === 'failed' ? 'failed' : 'ok';
        this.done.set(verdict);
        this.disconnect();
        this.finished.emit(verdict);
        break;
      }
      case 'ping':
        break;
    }
  }

  /** The stream is gone for good without a `done` frame. Exposed for tests. */
  handleStreamEnd(): void {
    this.disconnect();
    if (this.done() === null) {
      this.lost.set(true);
    }
  }

  isExpanded(segment: SegmentView): boolean {
    return this.toggled()[segment.name] ?? segment.status === 'open';
  }

  toggle(name: string): void {
    const segment = this.segments().find((s) => s.name === name);
    if (!segment) {
      return;
    }
    this.toggled.update((map) => ({ ...map, [name]: !this.isExpanded(segment) }));
  }

  badgeType(status: SegmentView['status']): 'secondary' | 'destructive' | 'outline' {
    switch (status) {
      case 'failed':
        return 'destructive';
      case 'ok':
        return 'secondary';
      default:
        return 'outline';
    }
  }

  statusLabel(status: SegmentView['status']): string {
    switch (status) {
      case 'failed':
        return 'failed';
      case 'ok':
        return 'ok';
      default:
        return 'running…';
    }
  }

  private reset(): void {
    this.segments.set([]);
    this.done.set(null);
    this.lost.set(false);
  }

  private disconnect(): void {
    this.source?.close();
    this.source = null;
  }
}
