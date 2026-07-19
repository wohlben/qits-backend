# Telemetry tab: Traces / Logs / Metrics sub-tabs

## Introduction

Implemented 2026-07-10, directly (no prior idea doc — a small UX restructure). The workspace
Telemetry tab (`pattern/telemetry/workspace-telemetry.component.ts`) previously stacked all four
sections — Recent errors, Traces, Metrics, Log tail — into one long scroll. It now hosts a
**nested `z-tab-group`** with one sub-tab per signal:

- **Traces** — the recent-errors feed, the span list (Recent / Slowest lens) and the trace
  drill-down. Errors live here rather than in a tab of their own because clicking an error group
  selects its trace, whose detail renders directly below.
- **Logs** — the service-filterable log tail.
- **Metrics** — the latest point of every metric series.

Related / dependent plans:

- **Restyles [workspace observation tabs](2026-07-06_workspace-observation-tabs.md)** — same
  data, same queries (still SSE-invalidated, no polling), same child components; only the layout
  changed. Section headings that duplicated a tab label (Logs, Metrics) were dropped.
- **Extends the zard tabs component (`shared/components/tabs`)** with a third local qits
  extension (after `indicator` and `zReorderKey`): tab/panel DOM ids are now prefixed with a
  per-instance counter (`tab-<uid>-<index>` / `tabpanel-<uid>-<index>`). Before this, every
  `z-tab-group` on a page minted the same `tab-0`… ids, which nesting turned into duplicate DOM
  ids and ambiguous `aria-controls` — an ARIA violation this feature would have introduced.
  Preserve the `uid` extension when regenerating via the zard CLI.

## Notes

- Hidden sub-tab panels stay mounted (the `z-tab-group` contract), so switching signals doesn't
  refetch — queries stay warm and the SSE hint keeps them fresh.
- The nested group is not reorderable (no `zReorderKey`): three fixed, semantically ordered tabs.
- `workspace-detail.page.spec.ts` scoped its tab-row assertions to the page's *first* tablist,
  since the Telemetry panel now contributes a nested one.

## Testing

- `workspace-telemetry.component.spec.ts` — new structure test: three sub-tabs labelled
  Traces/Logs/Metrics, Traces active by default, each panel hosting its section (error feed with
  the trace list, log tail, metric list), hidden panels mounted; all prior behavior tests
  (error→trace click-through, Slowest lens refetch, service filter options, healthy empty
  states) unchanged and green.
- `tabs.component.spec.ts` — the existing aria-controls↔id pairing test now exercises the
  uid-prefixed ids.
