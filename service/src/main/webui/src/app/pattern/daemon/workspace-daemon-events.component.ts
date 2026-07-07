import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { DaemonEventControllerService } from '@/api/api/daemonEventController.service';
import { DaemonEventDto } from '@/api/model/daemonEventDto';
import { DaemonEventSeverity } from '@/api/model/daemonEventSeverity';
import { ZardButtonComponent } from '@/shared/components/button';

/** An event's "open in source" target for a tailed file: the path plus the anchored line range. */
export interface DaemonEventFileAnchor {
  path: string;
  startLine: number;
  endLine: number;
}

/**
 * The workspace's daemon events feed, read from the durable store: severity-colored, each
 * expandable to its log excerpt, with "open in source" jumping to the anchored place in the
 * command log or the tailed file. Split out of the daemons panel so it can live as an
 * observation tab beside Telemetry; it shares the `workspace-daemon-events` query key with the
 * daemons panel's start/stop invalidation, so daemon actions still refresh it.
 */
@Component({
  selector: 'app-workspace-daemon-events',
  imports: [DatePipe, RouterLink, ZardButtonComponent],
  template: `
    <div class="flex flex-col gap-1" aria-label="Recent daemon events">
      @if (eventsQuery.isPending()) {
        <p class="text-sm text-muted-foreground">Loading events…</p>
      } @else if (eventsQuery.isError()) {
        <p class="text-sm text-destructive">Failed to load events</p>
      } @else if (recentEvents().length === 0) {
        <p class="text-sm text-muted-foreground">
          No daemon events yet — start a daemon and its status changes and detected errors land
          here.
        </p>
      } @else {
        <ul class="flex flex-col gap-1">
          @for (event of recentEvents(); track $index) {
            <li class="rounded-md border px-3 py-1.5 text-sm">
              <details>
                <summary class="flex cursor-pointer list-none flex-wrap items-center gap-2">
                  <span
                    class="size-2 rounded-full"
                    [class]="severityDot(event)"
                    aria-hidden="true"
                  ></span>
                  <span class="text-xs text-muted-foreground">
                    {{ event.timestamp | date: 'HH:mm:ss' }}
                  </span>
                  <span class="font-medium">{{ event.daemonName }}</span>
                  @if (event.source) {
                    <span class="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                      {{ sourceLabel(event) }}
                    </span>
                  }
                  <span class="min-w-0 flex-1 truncate text-muted-foreground">
                    {{ event.summary }}
                  </span>
                </summary>
                @if (event.logExcerpt) {
                  <pre
                    class="mt-2 max-h-64 overflow-auto rounded bg-muted p-2 text-xs whitespace-pre-wrap"
                    >{{ event.logExcerpt }}</pre
                  >
                } @else {
                  <p class="mt-2 text-xs text-muted-foreground">No log excerpt captured.</p>
                }
                @if (isOutputAnchor(event)) {
                  <a
                    z-button
                    zType="ghost"
                    zSize="sm"
                    class="mt-1"
                    [routerLink]="['/commands', event.commandId]"
                    [queryParams]="{ seq: event.anchorFrom, seqTo: event.anchorTo }"
                  >
                    Open in command log
                  </a>
                } @else if (isFileAnchor(event)) {
                  <button
                    z-button
                    zType="ghost"
                    zSize="sm"
                    class="mt-1"
                    type="button"
                    (click)="emitFileAnchor(event)"
                  >
                    Open {{ event.source }}:{{ event.anchorFrom }}
                  </button>
                }
              </details>
            </li>
          }
        </ul>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkspaceDaemonEventsComponent {
  readonly repoId = input.required<string>();
  readonly workspaceId = input.required<string>();
  /** A file event's "open in source" click — the page routes it into the file browser. */
  readonly openFile = output<DaemonEventFileAnchor>();

  private readonly eventService = inject(DaemonEventControllerService);

  readonly eventsQuery = injectQuery(() => ({
    queryKey: ['workspace-daemon-events', this.repoId(), this.workspaceId()],
    queryFn: () =>
      lastValueFrom(
        // Durable store, newest first: page 0 of 20 is exactly the feed's window.
        this.eventService.apiDaemonEventsGet(
          0,
          20,
          this.repoId(),
          undefined,
          undefined,
          undefined,
          this.workspaceId(),
        ),
      ).then((r) => r.events ?? []),
  }));

  readonly recentEvents = computed(() => this.eventsQuery.data() ?? []);

  sourceLabel(event: DaemonEventDto): string {
    if (event.source === 'output') {
      return 'output';
    }
    return event.anchorFrom != null ? `${event.source}:${event.anchorFrom}` : (event.source ?? '');
  }

  isOutputAnchor(event: DaemonEventDto): boolean {
    return event.source === 'output' && !!event.commandId && event.anchorFrom != null;
  }

  isFileAnchor(event: DaemonEventDto): boolean {
    return !!event.source && event.source !== 'output' && event.anchorFrom != null;
  }

  emitFileAnchor(event: DaemonEventDto): void {
    this.openFile.emit({
      path: event.source!,
      startLine: event.anchorFrom!,
      endLine: event.anchorTo ?? event.anchorFrom!,
    });
  }

  severityDot(event: DaemonEventDto): string {
    switch (event.severity) {
      case DaemonEventSeverity.Error:
        return 'bg-red-500';
      case DaemonEventSeverity.Warning:
        return 'bg-amber-500';
      default:
        return 'bg-muted-foreground/50';
    }
  }
}
