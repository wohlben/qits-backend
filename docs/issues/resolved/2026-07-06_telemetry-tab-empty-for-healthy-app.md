# RESOLVED: Telemetry tab shows nothing for a healthy app, even though spans + metrics are flowing

> **Resolution (2026-07-06):** fixed by
> [workspace observation tabs](../../epics/qits-workspace-detail/features/2026-07-06_workspace-observation-tabs.md) — the tab
> now renders a Recent traces section (slow-spans with `thresholdMs=0` + a new `sort=recent`
> option, click-through to the trace) and a Metrics section, with explicit healthy empty states
> (suggested-fix options 1–3; the fixture-side option 4 was not needed).

## Introduction

Related plans:

- **[observability](../../epics/qits-observability/features/2026-07-04_observability.md)** — the feature this is a gap in; the
  workspace telemetry tab is its UI surface.
- **[daemon web-view configuration](../../epics/qits-workspace-daemons/features/2026-07-06_daemon-webview-configuration.md)** — the
  work that surfaced this: opening the `seed-webapp` web view and posting a greeting is the natural
  way to generate telemetry, and the empty tab is what you see afterward. This issue is **not**
  caused by that change (the greeting POST reaches the fixture's Quarkus backend and produces a span
  regardless of which port the frame targets).
- **[servable quarkus-angular fixture](../../epics/qits-testing-fixtures/features/2026-07-05_servable-quarkus-angular-fixture.md)** —
  the `seed-webapp` fixture whose trivial echo endpoint (never errors, never logs) makes the gap
  maximally visible.

## Observed

On `http://localhost:4200/repositories/<repo>/workspaces/greeting`, the **Telemetry** tab is empty
after opening the daemon web view and posting a greeting — no traces, no logs, no metrics.

## Root cause: the data is captured, the UI just doesn't surface it

The OTLP pipeline works end-to-end. Verified live (dev mode, `seed-webapp`, greeting workspace,
after three greetings through the proxy):

- **Spans arrive and are correctly bucketed** to the workspace:
  `GET …/telemetry/slow-spans?thresholdMs=0` returns 4 `POST /greetings` spans (0–6 ms, serviceName
  `quarkus-angular`), and `…/telemetry/traces/{traceId}` returns the span. So the container→qits
  OTLP export, the `qits.workspace.id` resource-attribute bucketing, and the store all work.
- **Metrics arrive**: `…/telemetry/metrics` returns `jvm.class.count`, etc.

But the telemetry **tab** (`pattern/telemetry/workspace-telemetry.component.ts`, an "iteration one,
deliberately thin" component) only wires up three views:

1. **Recent errors** — `…/telemetry/errors` (error-status spans, grouped).
2. **Trace detail** — `…/telemetry/traces/{traceId}`, shown *only* after you click an error in (1).
3. **Logs** — `…/telemetry/logs`.

It never calls `…/telemetry/slow-spans` or `…/telemetry/metrics` (grep: 0 references in the
component). So there is **no view for a successful trace and no view for metrics**. The only path to
*any* trace in the UI is: an error appears in the error feed → click it → drill into its trace.

The `seed-webapp` fixture's `GreetingResource` just echoes `{name, timestamp}` — it **never errors
and never logs** (`domain/src/test/resources/fixtures/testing-repo-quarkus-angular` on `main`). So:

- Recent errors: empty (nothing errors).
- Trace detail: never shown (nothing selected).
- Logs: empty (the endpoint logs nothing; and the app emits no request-time log records).

Result: an empty tab, despite spans and metrics being received.

## Suggested fix direction

The gap is UI surfacing, not the pipeline. Options, smallest first:

1. **Add a "Recent traces" / all-spans view** to the tab (wire the already-existing `slow-spans`
   endpoint with a `thresholdMs=0` or a low default, newest-first), so a successful request is
   visible and click-through to its trace works without needing an error first. This is the most
   direct fix for "I made a request and want to see its trace."
2. **Wire the `metrics` endpoint into the tab** (it returns data today; nothing renders it).
3. Make the empty states explicit ("No errors — the app is healthy", "No logs exported yet") so an
   empty tab reads as "healthy," not "broken."
4. Fixture-side (optional, for a livelier demo): have `GreetingResource` log a line per request and
   add an error path (e.g. reject a blank name), so the error feed + log tail have something to
   show out of the box.

## Verification when fixed

`seed-webapp` → open the greeting workspace → post a greeting via the web view → the Telemetry tab
shows the `POST /greetings` trace (and/or metrics) without needing to manufacture an error first.
