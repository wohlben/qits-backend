import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { ServiceEventControllerService } from '@/api/api/serviceEventController.service';
import { ServiceEventDto } from '@/api/model/serviceEventDto';
import { ServiceEventSeverity } from '@/api/model/serviceEventSeverity';
import { ZardButtonComponent } from '@/shared/components/button';

/** An event's "open in source" target for a tailed file: the path plus the anchored line range. */
export interface ServiceEventFileAnchor {
  path: string;
  startLine: number;
  endLine: number;
}

/**
 * The workspace's service events feed, read from the durable store: severity-colored, each
 * expandable to its log excerpt, with "open in source" jumping to the anchored place in the
 * command log or the tailed file. A separate component from the services panel (it renders below
 * it in the Services tab); it shares the `workspace-service-events` query key with the services
 * panel's start/stop invalidation, so service actions still refresh it.
 */
@Component({
  selector: 'app-workspace-service-events',
  imports: [DatePipe, RouterLink, ZardButtonComponent],
  template: `
    <div class="flex flex-col gap-1" aria-label="Recent service events">
      @if (eventsQuery.isPending()) {
        <p class="text-sm text-muted-foreground">Loading events…</p>
      } @else if (eventsQuery.isError()) {
        <p class="text-sm text-destructive">Failed to load events</p>
      } @else if (recentEvents().length === 0) {
        <p class="text-sm text-muted-foreground">
          No service events yet — start a service and its status changes and detected errors land
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
                  <span class="font-medium">{{ event.serviceName }}</span>
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
export class WorkspaceServiceEventsComponent {
  readonly repoId = input.required<string>();
  readonly workspaceId = input.required<string>();
  /** A file event's "open in source" click — the page routes it into the file browser. */
  readonly openFile = output<ServiceEventFileAnchor>();

  private readonly eventService = inject(ServiceEventControllerService);

  readonly eventsQuery = injectQuery(() => ({
    queryKey: ['workspace-service-events', this.repoId(), this.workspaceId()],
    queryFn: () =>
      lastValueFrom(
        // Durable store, newest first: page 0 of 20 is exactly the feed's window.
        this.eventService.apiServiceEventsGet(
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

  sourceLabel(event: ServiceEventDto): string {
    if (event.source === 'output') {
      return 'output';
    }
    return event.anchorFrom != null ? `${event.source}:${event.anchorFrom}` : (event.source ?? '');
  }

  isOutputAnchor(event: ServiceEventDto): boolean {
    return event.source === 'output' && !!event.commandId && event.anchorFrom != null;
  }

  isFileAnchor(event: ServiceEventDto): boolean {
    return !!event.source && event.source !== 'output' && event.anchorFrom != null;
  }

  emitFileAnchor(event: ServiceEventDto): void {
    this.openFile.emit({
      path: event.source!,
      startLine: event.anchorFrom!,
      endLine: event.anchorTo ?? event.anchorFrom!,
    });
  }

  severityDot(event: ServiceEventDto): string {
    switch (event.severity) {
      case ServiceEventSeverity.Error:
        return 'bg-red-500';
      case ServiceEventSeverity.Warning:
        return 'bg-amber-500';
      default:
        return 'bg-muted-foreground/50';
    }
  }
}
