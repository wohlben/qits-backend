# Workspace detail tab regrouping: Chat first, Events into Daemons, Plugins → Agents

## Introduction

Three small reshapes of the workspace detail tab row, made together as follow-up polish on the
seven-tab consolidation:

1. **Chat is the first tab** (and therefore the default selection on a fresh visit) — the tab
   template order is now Chat / Files / Daemons / Web view / Telemetry / Agents.
2. **The Events tab is merged into the Daemons tab**: the daemon events feed renders below the
   daemons control panel under an "Events" heading, reuniting the controls with their consequence
   stream. Six tabs remain.
3. **The Plugins tab is renamed Agents**, with the existing plugin list rendered under a "Plugins"
   heading inside it — making room for the tab to grow into the broader coding-agent surface its
   content (`AgentPluginControllerService`, `agent-plugin-registry`) already belongs to.

Related/dependent plans:

- **Modifies [workspace-detail-tab-consolidation](./2026-07-09_workspace-detail-tab-consolidation.md)** —
  the tab row stays the page's single idiom; only its composition changes (7 → 6 tabs).
- **Partially reverts [workspace-observation-tabs](./2026-07-06_workspace-observation-tabs.md)** —
  that feature split the events feed out of the daemons panel into its own tab. The split
  *component* (`WorkspaceDaemonEventsComponent`) survives and is still composed by the page (its
  `openFile` output still drives the jump-to-Files anchor); only the dedicated tab goes away.
- **Rides [draggable-workspace-detail-tabs](./2026-07-09_draggable-workspace-detail-tabs.md)** —
  these are *default*-order changes; a user's drag-reordered layout wins. The persisted-order merge
  semantics absorb the rename/removal gracefully: saved `"Events"`/`"Plugins"` labels are dropped
  on restore and the new `"Agents"` tab appends in template order, so stale localStorage never
  breaks the row (it just re-appends renamed tabs until the user re-drags them).
- The plugin list itself is unchanged — see
  [agent-lsp-plugins](../../qits-coding-agents/features/2026-07-07_agent-lsp-plugins.md).

## Implementation notes

- All three changes are template-level in `workspace-detail.page.ts`; no component moved files or
  changed behavior. The Daemons tab now stacks `app-workspace-daemons` and
  `app-workspace-daemon-events` (page-level composition — the events feed stays a sibling smart
  component, *not* nested into the daemons panel, preserving the observation-tabs split).
- `workspace-plugins.component.ts` gained an `<h2>Plugins</h2>` heading (mirroring the daemons
  panel's own heading) so it reads as a titled section inside the Agents tab.
- The events feed and daemons panel already shared the `workspace-daemon-events` /
  `workspace-daemons` query keys and the page's SSE-driven freshness, so co-locating them costs no
  extra requests.
- Spec updates: default label order, the events-feed-in-Daemons-panel assertion (replacing the
  events-not-in-daemons-panel one), and the openFile jump test now starts from the Daemons tab.
