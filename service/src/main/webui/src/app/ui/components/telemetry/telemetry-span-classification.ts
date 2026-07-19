import { TelemetrySpanDto } from '@/api/model/telemetrySpanDto';

/**
 * Span names emitted by the browser's page-load instrumentation (`DocumentLoadInstrumentation`):
 * one span per subresource fetched while a document loads. High volume, low signal — opening a web
 * view floods the Traces list with a `resourceFetch` per asset. They share the `INTERNAL` span kind
 * with the meaningful `Navigation` span, so kind can't tell them apart; we classify by name and
 * treat this family as **default-hidden** (revealable via a toggle). `Navigation` stays visible.
 *
 * @see docs/epics/qits-observability/features/2026-07-06_spa-observability.md
 */
export const PAGE_LOAD_SPAN_NAMES: ReadonlySet<string> = new Set([
  'resourceFetch',
  'documentLoad',
  'documentFetch',
]);

/** True for a page-load instrumentation span (hidden from the Traces list unless revealed). */
export function isPageLoadSpan(span: TelemetrySpanDto): boolean {
  return span.name != null && PAGE_LOAD_SPAN_NAMES.has(span.name);
}
