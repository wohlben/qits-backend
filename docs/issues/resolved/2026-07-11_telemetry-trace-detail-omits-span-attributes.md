# Telemetry trace detail renders no span attributes — the meta-enrichment payoff is invisible in the UI

## Introduction

Found while E2E-verifying
[backend telemetry meta-enrichment](../../epics/qits-observability/features/2026-07-11_backend-telemetry-meta-enrichment.md).
Both that feature and its sibling
[SPA telemetry meta-enrichment](../../epics/qits-observability/features/2026-07-11_spa-telemetry-meta-enrichment.md) assume
"the span drill-down already renders arbitrary attributes" — richer drill-downs with zero UI
change. That holds for the **API and the agent's MCP tools**, but not for the **Telemetry tab**:
the trace detail displays only kind/name/duration/status per span, so `code.function.name`,
`code.file.path`, `greeting.name`, `app.route.*` etc. never appear anywhere in the UI. Related:
[workspace observation tabs](../../epics/qits-workspace-detail/features/2026-07-06_workspace-observation-tabs.md) (the tab in
question), and the parked
[picked-file deep link](../../epics/qits-workspace-detail/features/2026-07-10_workspace-tab-url-and-picked-file-deep-link.md)
move that a `code.file.path` display could reuse for Files-tab deep links.

## Observed

`seed-webapp` → greeting workspace → daemon up → post a greeting → Telemetry tab → click the
`POST /greetings` trace. The *Trace detail* region lists the three spans (CLIENT `HTTP POST` →
SERVER `POST /greetings` → INTERNAL `GreetingService.compose`) with kind, name and duration —
and nothing else. Clicking a span row does nothing. Meanwhile
`GET /api/repositories/{repoId}/workspaces/{wsId}/telemetry/traces/{traceId}` returns every span
with its full attribute map (verified: the server span carries `code.function.name` and
`code.file.path`, the compose span carries `greeting.name`). Log records in the Logs tab
likewise render timestamp/severity/body only, hiding the `code.function.name`/`code.line.number`
Quarkus stamps on them.

## Suspected cause

Deliberate thinness, not a regression:
`service/src/main/webui/src/app/ui/components/telemetry/telemetry-span-list.component.ts` — the
component doc says "deliberately no waterfall — the spec's UI stays thin" and its template
renders only `span.kind`, `span.name`, `span.status`, `span.durationMs`. The DTO
(`TelemetrySpanDto`) already includes `attributes`; the data is on the client, just unrendered.
Same shape in `telemetry-log-tail.component.ts` for log attributes. The meta-enrichment docs
overstated what the drill-down shows.

## Suggested fix direction

Make each span row in the trace detail expandable (disclosure), showing its attribute map as a
key/value list — same for log rows in the log tail. Purely presentational: extend
`telemetry-span-list.component.ts` (and `telemetry-log-tail.component.ts`), no API change. A
follow-up polish could render `code.file.path` as a deep link into the Files tab (the
picked-file deep-link move), which is why the backend derivation is workspace-relative.

## Resolution

Fixed as suggested — purely presentational, no API change. Each span row in the trace detail and
each row in the log tail (plus the span list's "Correlated logs" sub-list) is now a native
`<details>/<summary>` disclosure; expanding a row renders its `attributes` map as a `<dl>`
key/value list (empty maps show "No attributes"). Matches the existing disclosure idiom in
`pattern/daemon/workspace-daemon-events.component.ts`; attribute-map iteration uses a small
`attrEntries()` helper (mirroring `envEntries()` in the action-configuration detail page) rather
than a template pipe, per the webui style guide.

Touched: `service/src/main/webui/src/app/ui/components/telemetry/telemetry-span-list.component.ts`
and `telemetry-log-tail.component.ts`, with new `*.spec.ts` for each. The `code.file.path`
Files-tab deep link remains the noted follow-up.
