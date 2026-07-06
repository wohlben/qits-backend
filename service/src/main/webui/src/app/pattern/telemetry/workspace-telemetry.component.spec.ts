import { TestBed } from '@angular/core/testing';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { WorkspaceTelemetryControllerService } from '@/api/api/workspaceTelemetryController.service';
import { TelemetryErrorGroupDto } from '@/api/model/telemetryErrorGroupDto';
import { TelemetryLogDto } from '@/api/model/telemetryLogDto';
import { TelemetryMetricDto } from '@/api/model/telemetryMetricDto';
import { TelemetrySpanDto } from '@/api/model/telemetrySpanDto';
import { WorkspaceTelemetryComponent } from './workspace-telemetry.component';

const TRACE_ID = '0af7651916cd43dd8448eb211c80319c';

const OK_SPAN: TelemetrySpanDto = {
  traceId: TRACE_ID,
  spanId: 'c8ad6b7169203332',
  name: 'POST /greetings',
  kind: 'SERVER',
  status: 'UNSET',
  startEpochNanos: 2_000_000_000,
  durationMs: 42,
};

const METRIC: TelemetryMetricDto = {
  name: 'jvm.memory.used',
  unit: 'By',
  type: 'GAUGE',
  value: 1024,
  serviceName: 'my-service',
};

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

describe('WorkspaceTelemetryComponent', () => {
  const telemetryService = {
    apiRepositoriesRepoIdWorkspacesWorkspaceIdTelemetryErrorsGet: vi
      .fn()
      .mockReturnValue(of({ groups: [] })),
    apiRepositoriesRepoIdWorkspacesWorkspaceIdTelemetryTracesTraceIdGet: vi
      .fn()
      .mockReturnValue(of({ trace: { traceId: TRACE_ID, spans: [], logs: [] } })),
    apiRepositoriesRepoIdWorkspacesWorkspaceIdTelemetryLogsGet: vi
      .fn()
      .mockReturnValue(of({ logs: [] })),
    apiRepositoriesRepoIdWorkspacesWorkspaceIdTelemetrySlowSpansGet: vi
      .fn()
      .mockReturnValue(of({ spans: [] })),
    apiRepositoriesRepoIdWorkspacesWorkspaceIdTelemetryMetricsGet: vi
      .fn()
      .mockReturnValue(of({ metrics: [] })),
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
    queryClient.setQueryData(['telemetry-spans', 'repo-1', 'wt-1', 'recent'], [OK_SPAN]);
    queryClient.setQueryData(['telemetry-metrics', 'repo-1', 'wt-1'], [METRIC]);

    await TestBed.configureTestingModule({
      imports: [WorkspaceTelemetryComponent],
      providers: [
        provideTanStackQuery(queryClient),
        { provide: WorkspaceTelemetryControllerService, useValue: telemetryService },
      ],
    }).compileComponents();
  });

  function createComponent() {
    const fixture = TestBed.createComponent(WorkspaceTelemetryComponent);
    fixture.componentRef.setInput('repoId', 'repo-1');
    fixture.componentRef.setInput('workspaceId', 'wt-1');
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

  it('lists recent traces and clicking a span selects its trace', () => {
    const fixture = createComponent();
    const element = fixture.nativeElement as HTMLElement;

    // The healthy span shows up without any error involved.
    expect(element.textContent).toContain('POST /greetings');
    expect(element.textContent).toContain('42 ms');

    const spanButton = Array.from(element.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('POST /greetings'),
    );
    expect(spanButton).toBeDefined();
    spanButton!.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.selectedTraceId()).toBe(TRACE_ID);
    expect(element.textContent).toContain('Trace');
  });

  it('refetches with the duration sort when the Slowest lens is toggled', () => {
    const fixture = createComponent();

    const slowestButton = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ).find((b) => b.textContent?.trim() === 'Slowest');
    slowestButton!.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.spanSort()).toBe('slowest');
    // The 'slowest' key has no seeded cache, so the query fetches — with thresholdMs=0 and the
    // duration sort (positional args: repoId, workspaceId, sinceMinutes, sort, thresholdMs).
    expect(
      telemetryService.apiRepositoriesRepoIdWorkspacesWorkspaceIdTelemetrySlowSpansGet,
    ).toHaveBeenCalledWith('repo-1', 'wt-1', undefined, 'duration', 0);
  });

  it('renders the metrics section from the metrics query', () => {
    const fixture = createComponent();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Metrics');
    expect(text).toContain('jvm.memory.used');
    expect(text).toContain('1,024');
    expect(text).toContain('By');
  });

  it('renders healthy empty states instead of a blank tab when nothing is buffered', () => {
    queryClient.setQueryData(['telemetry-errors', 'repo-1', 'wt-1'], []);
    queryClient.setQueryData(['telemetry-logs', 'repo-1', 'wt-1', null], []);
    queryClient.setQueryData(['telemetry-spans', 'repo-1', 'wt-1', 'recent'], []);
    queryClient.setQueryData(['telemetry-metrics', 'repo-1', 'wt-1'], []);
    const fixture = createComponent();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('No errors — the app is healthy.');
    expect(text).toContain('No spans captured yet');
    expect(text).toContain('No metrics captured yet');
    expect(text).toContain('No logs exported yet.');
  });
});
