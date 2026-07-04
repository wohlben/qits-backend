import { TestBed } from '@angular/core/testing';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { WorktreeTelemetryControllerService } from '@/api/api/worktreeTelemetryController.service';
import { TelemetryErrorGroupDto } from '@/api/model/telemetryErrorGroupDto';
import { TelemetryLogDto } from '@/api/model/telemetryLogDto';
import { WorktreeTelemetryComponent } from './worktree-telemetry.component';

const TRACE_ID = '0af7651916cd43dd8448eb211c80319c';

const LOG: TelemetryLogDto = {
  epochNanos: 1_000_000_000,
  severityNumber: 17,
  severityText: 'ERROR',
  body: 'it broke',
  traceId: TRACE_ID,
  serviceName: 'my-service',
};

function errorGroup(): TelemetryErrorGroupDto {
  return {
    traceId: TRACE_ID,
    serviceName: 'my-service',
    errorSpans: [
      {
        traceId: TRACE_ID,
        spanId: 'b7ad6b7169203331',
        name: 'GET /boom',
        kind: 'SERVER',
        status: 'ERROR',
        statusMessage: 'boom',
        durationMs: 250,
        events: [
          {
            name: 'exception',
            epochNanos: 1,
            attributes: {
              'exception.type': 'java.lang.IllegalStateException',
              'exception.message': 'boom',
              'exception.stacktrace': 'at eu.example.Boom.go',
            },
          },
        ],
      },
    ],
    errorLogs: [LOG],
  } as TelemetryErrorGroupDto;
}

describe('WorktreeTelemetryComponent', () => {
  const telemetryService = {
    apiRepositoriesRepoIdWorktreesWorktreeIdTelemetryErrorsGet: vi
      .fn()
      .mockReturnValue(of({ groups: [] })),
    apiRepositoriesRepoIdWorktreesWorktreeIdTelemetryTracesTraceIdGet: vi
      .fn()
      .mockReturnValue(of({ trace: { traceId: TRACE_ID, spans: [], logs: [] } })),
    apiRepositoriesRepoIdWorktreesWorktreeIdTelemetryLogsGet: vi
      .fn()
      .mockReturnValue(of({ logs: [] })),
  };
  let queryClient: QueryClient;

  beforeEach(async () => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          staleTime: Infinity,
          retry: false,
          refetchOnMount: false,
          refetchInterval: false,
        },
      },
    });
    // Seed the caches the way the daemons spec does — the component reads, we assert rendering.
    queryClient.setQueryData(['telemetry-errors', 'repo-1', 'wt-1'], [errorGroup()]);
    queryClient.setQueryData(['telemetry-logs', 'repo-1', 'wt-1', null], [LOG]);
    queryClient.setQueryData(['telemetry-trace', 'repo-1', 'wt-1', TRACE_ID], {
      traceId: TRACE_ID,
      spans: errorGroup().errorSpans,
      logs: [LOG],
    });

    await TestBed.configureTestingModule({
      imports: [WorktreeTelemetryComponent],
      providers: [
        provideTanStackQuery(queryClient),
        { provide: WorktreeTelemetryControllerService, useValue: telemetryService },
      ],
    }).compileComponents();
  });

  function createComponent() {
    const fixture = TestBed.createComponent(WorktreeTelemetryComponent);
    fixture.componentRef.setInput('repoId', 'repo-1');
    fixture.componentRef.setInput('worktreeId', 'wt-1');
    fixture.detectChanges();
    return fixture;
  }

  it('renders the error feed with exception evidence and the log tail', () => {
    const fixture = createComponent();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('GET /boom');
    expect(text).toContain('java.lang.IllegalStateException');
    expect(text).toContain(TRACE_ID);
    expect(text).toContain('it broke');
  });

  it('shows the trace detail when an error group is clicked', () => {
    const fixture = createComponent();

    const groupButton = (fixture.nativeElement as HTMLElement).querySelector(
      'app-telemetry-error-feed button',
    ) as HTMLButtonElement;
    expect(groupButton).not.toBeNull();
    groupButton.click();
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Trace');
    expect(text).toContain('Correlated logs');
    expect(fixture.componentInstance.selectedTraceId()).toBe(TRACE_ID);
  });

  it('offers the exporting services as log-tail filter options', () => {
    const fixture = createComponent();

    expect(fixture.componentInstance.services()).toEqual(['my-service']);
    const select = (fixture.nativeElement as HTMLElement).querySelector(
      '#telemetry-log-service',
    ) as HTMLSelectElement;
    expect(select.options.length).toBe(2); // "All services" + my-service
  });
});
