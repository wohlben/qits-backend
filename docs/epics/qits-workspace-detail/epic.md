# Epic: qits-workspace-detail — the workspace detail route and its tabs

## Introduction

The **frontend domain of the workspace detail route** (`/repositories/:repoId/workspaces/:workspaceId`):
the tab framework and every tab's UI — Chat, Files, Web view, Agents, Actions, Daemons/Events,
Telemetry. This is a **retroactive umbrella epic**: unlike a delivery epic
([qits-userflows](../qits-userflows/epic.md)) it wasn't planned as one deliverable — it groups
the route's already-implemented features so the domain has one home, and future route work
lands here as new parts. First occupant of that epic flavor.

**Scope rule** (what belongs here vs. not): a feature belongs to this epic when its
deliverable is the detail route's *frontend surface* — a tab, a tab's UI behavior, the tab
framework itself. A **generally applicable backend feature stays outside** even when the route
is its main consumer: the [workspace SSE channel](../qits-workspaces/features/2026-07-07_workspace-sse-live-updates.md)
and [file-watcher freshness SSE](../qits-workspaces/features/2026-07-12_detection-live-freshness-sse.md),
[container file access](../qits-workspaces/features/2026-07-04_container-file-access.md) (what the Files tab
reads through), [backend framework detection](../qits-workspaces/features/2026-07-12_backend-framework-detection.md),
the chat/agent backends ([stream-json chat](../qits-coding-agents/features/2026-07-01_stream-json-chat.md),
[persistent sessions](../qits-coding-agents/features/2026-07-04_persistent-chat-sessions.md),
[session lineage](../qits-coding-agents/features/2026-07-10_agent-session-lineage.md)), the
[daemon domain](../qits-workspace-daemons/features/2026-07-04_daemons.md) (incl.
[web-view configuration](../qits-workspace-daemons/features/2026-07-06_daemon-webview-configuration.md)), and the
[observability pipeline](../qits-observability/features/2026-07-04_observability.md) the Telemetry tab renders.
Likewise, **a tab that is another epic's deliverable stays in that epic**: the CI tab is
[qits-userflows](../qits-userflows/epic.md) part 3.

Other related plans:

- **Parked tab ideas** keep their own archetype:
  [workspace-feature-dossier-tab](../../backlog-ideas/workspace-feature-dossier-tab.md) stays in
  `docs/backlog-ideas/` (it has a Trigger); if picked up, it becomes a part here.
- The route's per-workspace surfaces assume the workspace execution model —
  [workspace containers](../qits-workspaces/features/2026-07-04_workspace-containers.md) and
  [lazy provisioning](../qits-workspaces/features/2026-07-08_lazy-workspace-container-provisioning.md).

## Parts (implemented), grouped by surface

Chronology within each group is the implementation order; the groups themselves interleave.

### The route and its tab framework

- [speak-to-prompt](features/2026-07-02_speak-to-prompt.md) (07-02) — the route's origin: the
  workspace "work in progress" page with recorded-speech → refined-prompt → agent launch.
- [workspace-chat-dialog](features/2026-07-04_workspace-chat-dialog.md) (07-04) — the
  persistent chat session surfaced on the detail page (full-size dialog, later a tab).
- [workspace-observation-tabs](features/2026-07-06_workspace-observation-tabs.md) (07-06) —
  traces/metrics/daemon events become tabs; the tab group takes shape.
- [workspace-detail-tab-consolidation](features/2026-07-09_workspace-detail-tab-consolidation.md)
  (07-09) — Daemons, Chat, and Web view join the group; the tab group becomes the route's
  one structure (every later tab feature builds on this).
- [workspace-detail-tab-regrouping](features/2026-07-09_workspace-detail-tab-regrouping.md)
  (07-09) — Chat first, Events into Daemons, Plugins → Agents.
- [draggable-workspace-detail-tabs](features/2026-07-09_draggable-workspace-detail-tabs.md)
  (07-09) — drag-to-reorder, persisted in localStorage.
- [workspace-tab-url-and-picked-file-deep-link](features/2026-07-10_workspace-tab-url-and-picked-file-deep-link.md)
  (07-10) — the active tab in the URL (slug registry) + deep links into the file browser.

### Files tab

- [workspace-file-browser](features/2026-07-02_workspace-file-browser.md) (07-02) — tree +
  syntax-highlighted viewer.
- [lazy-directory-exploration](features/2026-07-03_lazy-directory-exploration.md) (07-03),
  [workspace-filter-ordered-rules-and-ignorelists](features/2026-07-03_workspace-filter-ordered-rules-and-ignorelists.md)
  (07-03),
  [workspace-smart-file-display](features/2026-07-03_workspace-smart-file-display.md) (07-03),
  [workspace-tree-path-compaction](features/2026-07-03_workspace-tree-path-compaction.md)
  (07-03),
  [framework-aware-file-browser](features/2026-07-03_framework-aware-file-browser.md) (07-03)
  — the tree grows lazy loading, rule-based filtering, per-filetype rendered views, path
  compaction, and framework-aware filters/test↔code tabs.
- [files-tab-line-picker-mode](features/2026-07-11_files-tab-line-picker-mode.md) (07-11),
  [files-tab-selection-as-prompt-context](features/2026-07-11_files-tab-selection-as-prompt-context.md)
  (07-11),
  [line-reference-selection-lifecycle](features/2026-07-11_line-reference-selection-lifecycle.md)
  (07-11) — picking lines like the web view picks elements, feeding the Chat tab's prompt
  context.
- [files-tab-gitignore-dimming-and-test-tab-naming](features/2026-07-12_files-tab-gitignore-dimming-and-test-tab-naming.md)
  (07-12).

### Chat tab

- [chat-markdown-rendering](features/2026-07-02_chat-markdown-rendering.md) (07-02) — the
  sanitizing markdown path both chat sides render through (also the precedent other
  markdown-rendering surfaces reuse).

### Web view tab

- [daemon-webview-picker](features/2026-07-05_daemon-webview-picker.md) (07-05) — proxy a
  daemon's app into the route, pick DOM elements into the prompt.
- [picked-element-component-attribution](features/2026-07-10_picked-element-component-attribution.md)
  (07-10) — walk a picked element up to its owning component and attach source files.

### Agents tab

- [embedded-workspace-agent-session](features/2026-07-10_embedded-workspace-agent-session.md)
  (07-10) — auto-resume the last session, embedded in the tab.

### Actions tab

- [workspace-actions-tab](features/2026-07-09_workspace-actions-tab.md) (07-09) — run and
  observe configured actions from the route.

### Telemetry tab

- [telemetry-sub-tabs](features/2026-07-10_telemetry-sub-tabs.md) (07-10) — Traces / Logs /
  Metrics sub-tabs.
- [telemetry-page-load-span-hiding](features/2026-07-12_telemetry-page-load-span-hiding.md)
  (07-12) — default-hide browser page-load spans in the Traces list.

## Open parts

- **[refresh-resilient-prompt-building](feature-ideas/refresh-resilient-prompt-building.md)**
  — the prompt draft (text, picked elements, code references, attachments) becomes
  backend-held workspace state, closing the route's last refresh-loss gap. **Since 2026-07-20 a
  prerequisite, not polish**: the persisted draft is what the agent fetches via the
  coding-agents
  [mcp-task-prompt-delivery](../qits-coding-agents/feature-ideas/mcp-task-prompt-delivery.md)
  idea, which requires its server-readable split (serialized prompt + attachment rows).
- **[sketch-tab-and-image-prompt-attachments](feature-ideas/sketch-tab-and-image-prompt-attachments.md)**
  — a Sketch tab (minimal canvas) + image attachments as a third structured prompt-context
  kind. Builds on the prompt-context conventions (picked elements, code references) above.
  Delivery to the agent (incl. the must-have interactive PTY session) is resolved to the MCP
  fetch (see the doc's 2026-07-20 resolution) — this epic keeps the compose-side UX; the
  backend legs live in the two docs above.

## Done when

An umbrella epic tracks a living surface, so "done" is rolling: the epic is *current* when
its `feature-ideas/` is empty and every route feature since this epic's creation has landed
as a part here. New workspace-detail frontend work starts as a draft in this epic's
`feature-ideas/`, not in the flat `docs/feature-ideas/`.

## Status

24 parts implemented (everything under [features/](features/), grouped above); 2 open ideas:

| Open part | Status |
|---|---|
| [refresh-resilient-prompt-building](feature-ideas/refresh-resilient-prompt-building.md) | idea |
| [sketch-tab-and-image-prompt-attachments](feature-ideas/sketch-tab-and-image-prompt-attachments.md) | idea |
