import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { ServiceEventControllerService } from '@/api/api/serviceEventController.service';
import { ServiceEventSeverity } from '@/api/model/serviceEventSeverity';
import {
  ServiceEventFileAnchor,
  WorkspaceServiceEventsComponent,
} from './workspace-service-events.component';

describe('WorkspaceServiceEventsComponent', () => {
  const eventService = {
    apiServiceEventsGet: vi.fn().mockReturnValue(of({ events: [] })),
  };
  let queryClient: QueryClient;

  beforeEach(async () => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { staleTime: Infinity, retry: false, refetchOnMount: false, refetchInterval: false },
      },
    });

    await TestBed.configureTestingModule({
      imports: [WorkspaceServiceEventsComponent],
      providers: [
        provideRouter([]),
        provideTanStackQuery(queryClient),
        { provide: ServiceEventControllerService, useValue: eventService },
      ],
    }).compileComponents();
  });

  function createComponent() {
    const fixture = TestBed.createComponent(WorkspaceServiceEventsComponent);
    fixture.componentRef.setInput('repoId', 'repo-1');
    fixture.componentRef.setInput('workspaceId', 'wt-1');
    fixture.detectChanges();
    return fixture;
  }

  it('renders an honest empty state when no events have been recorded', () => {
    queryClient.setQueryData(['workspace-service-events', 'repo-1', 'wt-1'], []);
    const fixture = createComponent();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('No service events yet');
  });

  it('renders the events feed severity-colored with expandable excerpts and source badges', () => {
    queryClient.setQueryData(
      ['workspace-service-events', 'repo-1', 'wt-1'],
      [
        {
          serviceName: 'dev server',
          severity: ServiceEventSeverity.Error,
          summary: 'crashed (exit 1)',
          logExcerpt: 'stacktrace-here',
          timestamp: '2026-07-04T10:00:00Z',
        },
        {
          serviceName: 'dev server',
          severity: ServiceEventSeverity.Error,
          summary: 'NPE in handler',
          logExcerpt: 'boom',
          source: 'output',
          commandId: 'cmd-9',
          anchorFrom: 12,
          anchorTo: 14,
          timestamp: '2026-07-04T10:01:00Z',
        },
      ],
    );
    const fixture = createComponent();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.textContent).toContain('crashed (exit 1)');
    expect(element.querySelector('details pre')?.textContent).toContain('stacktrace-here');
    expect(element.querySelector('.bg-red-500')).not.toBeNull();
    // The anchored output event carries a source badge and an "open in command log" link with
    // the anchored sequence range as query params.
    expect(element.textContent).toContain('output');
    const hrefs = Array.from(element.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/commands/cmd-9?seq=12&seqTo=14');
  });

  it('file events emit an openFile anchor instead of routing', () => {
    queryClient.setQueryData(
      ['workspace-service-events', 'repo-1', 'wt-1'],
      [
        {
          serviceName: 'dev server',
          severity: ServiceEventSeverity.Error,
          summary: 'kaboom',
          logExcerpt: 'ERROR: kaboom',
          source: 'logs/app.log',
          anchorFrom: 7,
          anchorTo: 9,
          timestamp: '2026-07-04T10:02:00Z',
        },
      ],
    );
    const fixture = createComponent();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.textContent).toContain('logs/app.log:7');
    const anchors: ServiceEventFileAnchor[] = [];
    fixture.componentInstance.openFile.subscribe((a) => anchors.push(a));
    const openButton = Array.from(element.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Open logs/app.log:7'),
    );
    expect(openButton).toBeDefined();
    openButton!.click();
    expect(anchors).toEqual([{ path: 'logs/app.log', startLine: 7, endLine: 9 }]);
  });
});
