# Workspace observation tabs: surface successful traces + metrics, and move daemon events into a tab

## Introduction

Two changes to the workspace-detail page's observation surfaces, driven by the same realisation —
**qits already captures more than it shows**, and the always-visible daemons panel is getting
crowded. Part A makes the Telemetry tab show the telemetry that is already flowing; Part B moves the
daemon **Recent events** feed out of the daemons panel into its own tab beside Telemetry, so the two
"what is my app doing" surfaces sit together and the panel shrinks back to controls.

> This is a **modification of already-implemented code**, not a parallel design. The telemetry
> pipeline, all its REST endpoints, the daemon events feed, and the `z-tab-group` on the workspace
> detail page all exist; this rewires what the frontend renders and where.

Related/dependent plans:

- **Fixes [telemetry tab empty for a healthy app](../../../issues/resolved/2026-07-06_telemetry-tab-empty-for-healthy-app.md)**
  — the issue that motivates Part A. That doc has the live verification proving spans + metrics
  arrive and are correctly workspace-bucketed; the gap is purely UI surfacing.
- **Modifies [observability](../../qits-observability/features/2026-07-04_observability.md)** — its
  `pattern/telemetry/workspace-telemetry.component.ts` ("iteration one, deliberately thin") is the
  component Part A grows. The backend `WorkspaceTelemetryController` endpoints
  (`errors`, `traces/{traceId}`, `slow-spans`, `logs`, `metrics`) are unchanged except for the one
  optional sort addition noted below.
- **Modifies [daemons](../../qits-workspace-daemons/features/2026-07-04_daemons.md)** — its
  `pattern/daemon/workspace-daemons.component.ts` currently hosts both the daemon controls and the
  Recent events feed; Part B splits the feed out.
- **Complements [daemon web-view configuration](../../qits-workspace-daemons/features/2026-07-06_daemon-webview-configuration.md)**
  — opening a daemon's web view and interacting with the app is the natural way to generate the
  traces Part A surfaces; it is how the empty-tab gap was found.
- Follows the repo's **[everything available, hidden by rules](../../../../CLAUDE.md)** convention (show
  the data qits has; don't hide it behind an error-only view) and the existing tabbed-layout pattern
  (`z-tab-group` / `z-tab`, `shared/components/tabs`).

## Part A — the Telemetry tab shows what's flowing

**Problem (from the issue doc).** The tab (`workspace-telemetry.component.ts`) wires up only three
views: **Recent errors** (`…/telemetry/errors`), a **trace drill-down** shown *only* after clicking
an error, and **Logs** (`…/telemetry/logs`). It never calls `…/telemetry/slow-spans` or
`…/telemetry/metrics`. So a healthy request — no error, fast, no app log — leaves the whole tab
empty even though its span and the JVM metrics are sitting in the store, correctly bucketed to the
workspace. The only path to *any* trace is: an error appears → click it → drill in.

**Change.** Add two views and honest empty states, reusing the existing endpoints and DTO
components:

1. **Recent traces** — a new section (and a new `injectQuery` on the existing
   `WorkspaceTelemetryControllerService`) listing recent spans newest-first, each click-through to
   the same `traceQuery` + `telemetry-span-list` drill-down the error feed already uses. Reuse
   `…/telemetry/slow-spans` with `thresholdMs=0`; because that endpoint sorts by duration desc
   (`TelemetryQueryService.slowSpans`), add a **recent-first sort option** to it (a `sort=recent`
   query param, or a sibling `recentSpans` method sorting by `startEpochNanos` desc) so "what did I
   just do" reads chronologically. Keep the existing slow-spans-by-duration behaviour available (it
   is the useful "what's slow" lens) — e.g. a small toggle **Recent / Slowest** on the section
   header.
2. **Metrics** — render `…/telemetry/metrics` (already returns `TelemetryMetricDto` with
   name/value/unit/type). A simple grouped table/list is enough for iteration one; a small
   `telemetry-metric-list` presentational component mirrors the existing
   `telemetry-error-feed` / `telemetry-log-tail` / `telemetry-span-list` trio.
3. **Explicit empty states** — "No errors — the app is healthy" / "No spans captured yet — interact
   with the app" / "No logs exported yet", so an empty section reads as *healthy*, not *broken*.

Shape stays "thin": polling `injectQuery` (5s, matching the existing queries), the same
`repoId`/`workspaceId` inputs, no new page. Files touched: `workspace-telemetry.component.ts`
(new sections + queries), a new `ui/components/telemetry/telemetry-metric-list.component.ts`,
`TelemetryQueryService` + `WorkspaceTelemetryController` (the one sort addition), then regenerate
`docs/openapi.yml` + `pnpm generate:api` if the endpoint signature changes.

## Part B — daemon Recent events become a tab

**Problem.** `workspace-daemons.component.ts` renders both the daemon **controls** (list, status
chips, start/stop, terminal, the web-view recreate affordance) *and* the **Recent events** feed
(`…/apiDaemonEventsGet`, the severity-dotted expandable list with "open in source"). On the
workspace-detail page that whole component sits *above* the `z-tab-group`, so the events feed is
always on screen, pushing the Files/Telemetry tabs down — and it is conceptually the same kind of
"observation" surface as Telemetry, which *is* a tab.

**Change.** Split the events feed into its own component and mount it as a **third tab** beside Files
and Telemetry; leave only the daemon controls in the always-visible panel.

- Extract `pattern/daemon/workspace-daemon-events.component.ts` — the `eventsQuery`
  (`['workspace-daemon-events', repoId, workspaceId]`, 5s poll), the `recentEvents` list template,
  `severityDot`, the output/file anchor logic, and the `openFile` output — lifted verbatim from
  `workspace-daemons.component.ts` (which keeps the daemon list + controls and its own
  `daemonsQuery`/start/stop/recreate). The two keep sharing the `workspace-daemons` /
  `workspace-daemon-events` query keys, so start/stop invalidation still refreshes both across the
  split (see [shared query key shape](../../../../CLAUDE.md)).
- In `workspace-detail.page.ts`, add a **`<z-tab label="Events">`** (or "Daemon events") hosting
  `<app-workspace-daemon-events>` between Files and Telemetry. The daemons controls panel
  (`<app-workspace-daemons>`) stays above the tab group.
- **Keep "open in source" working across the tab move.** The events feed's file-anchor click emits
  `openFile`, which the page currently routes into the mounted (but possibly hidden) file browser
  (`fileBrowser.openAtLine(...)`). Since the file browser is already kept mounted on its hidden tab
  for exactly this reason, the wiring survives; add a **switch-to-Files-tab** on `openFile` so the
  jump is visible (select the Files tab, then `openAtLine`). This is the one real interaction to get
  right.

Net: the top panel shrinks to daemon controls; **Files / Events / Telemetry** become three sibling
observation tabs. (Alternative considered: group Events + Telemetry under one "Observability" tab
with an inner switch — rejected for iteration one as more nesting than the content warrants; kept as
a later consolidation if the tab row grows.)

## Explicitly deferred

- **Trace waterfall / span tree** — the drill-down stays the existing flat `telemetry-span-list`;
  a real timeline is a separate richer view.
- **Metric charts** — a table first; sparklines/time-series rendering is later.
- **Persisting telemetry/events** — both remain the ephemeral in-memory buffers they are today;
  this is display only.
- **Merging the daemon events feed with the telemetry logs tail** — they draw from different stores
  (daemon supervisor events vs. OTLP logs); keep them distinct until a unified "activity" view is
  clearly wanted.

## Testing sketch

- **Telemetry (frontend):** `workspace-telemetry.component.spec.ts` — with a seeded `slow-spans`
  (recent sort) response the Recent traces section lists spans and click-through selects the trace;
  with a seeded `metrics` response the metrics section renders; all-empty responses render the
  healthy empty states, not a blank tab.
- **Telemetry (backend):** `TelemetryQueryService` recent-sort returns spans by `startEpochNanos`
  desc; the existing slowest-first path is unchanged; `OpenApiSchemaExportTest` regenerates if the
  endpoint changed.
- **Events tab (frontend):** `workspace-daemon-events.component.spec.ts` (moved assertions from the
  daemons spec) — the feed renders severity dots/excerpts and emits `openFile` for a file anchor;
  `workspace-detail` shows an Events tab and an `openFile` from it selects the Files tab and calls
  `openAtLine`.
- **Manual:** `seed-webapp` → open the greeting workspace → post a greeting via the web view → the
  Telemetry tab's Recent traces shows the `POST /greetings` span (no error needed) and Metrics shows
  the JVM metrics; the daemon events live under the Events tab, and "open in source" from an event
  jumps to the Files tab at the anchored line.
