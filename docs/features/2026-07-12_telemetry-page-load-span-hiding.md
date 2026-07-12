# Telemetry: default-hide the browser's page-load spans in the Traces list

## Introduction

Builds directly on [SPA observability](2026-07-06_spa-observability.md) (which registered the
browser's `DocumentLoadInstrumentation`, the source of `resourceFetch`/`documentLoad`/`documentFetch`
spans) and [SPA telemetry meta-enrichment](2026-07-11_spa-telemetry-meta-enrichment.md) (which added
the custom `Navigation` span and already flagged the concern that unnamed browser spans "turn out to
be noise"). This is the UI-side answer to that flag for the page-load family. It is a **frontend-only**
change — consistent with the standing "qits ships zero SPA-observability backend code" stance; the
in-memory OTLP buffer and every telemetry endpoint are untouched.

## Problem

Opening a workspace web view floods the **Traces** list: `DocumentLoadInstrumentation` emits one
`resourceFetch` span per subresource downloaded on load (plus `documentLoad`/`documentFetch`), so the
list is dominated by low-signal page-load noise. These spans share the OTEL `INTERNAL` span kind with
the meaningful `Navigation` span, so filtering by kind is too coarse — it would also drop the
navigation events the user wants to keep.

## Change

Classify by span **name**, not kind. A small pure module,
`ui/components/telemetry/telemetry-span-classification.ts`, owns the `PAGE_LOAD_SPAN_NAMES` set
(`resourceFetch`, `documentLoad`, `documentFetch`) and an `isPageLoadSpan(span)` predicate.

`WorkspaceTelemetryComponent`:

- **default-hides** page-load spans from the Traces list via a `visibleSpans` computed (full buffer
  minus page-load spans, unless revealed);
- exposes a `showPageLoadSpans` signal and a reveal toggle button, shown only when
  `hiddenSpanCount() > 0`, labelled `Show N page-load span(s)` / `Hide …`;
- when the buffer holds *only* page-load spans, the empty state points at the reveal toggle instead
  of the "interact with the app" hint.

Scope is the **Traces list only**. Clicking into a specific trace still shows every span in its
`app-telemetry-span-list` drill-down — you asked for that trace explicitly, so nothing is hidden
there. `Navigation` stays visible throughout.

## Tests

- `telemetry-span-classification.spec.ts` — the family is hidden, `Navigation` and CLIENT/SERVER
  spans stay visible, a nameless span is visible.
- `workspace-telemetry.component.spec.ts` — new case: with an `OK_SPAN` + `Navigation` +
  `resourceFetch` buffer, the list shows `POST /greetings` and `Navigation` but not `resourceFetch`;
  clicking the reveal toggle surfaces it.
