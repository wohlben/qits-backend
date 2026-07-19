# Drag-to-reorder workspace detail tabs, persisted in localStorage

## Introduction

The workspace detail route is now one seven-tab row (Files / Chat / Daemons / Web view / Events /
Telemetry / Plugins), but its order is fixed by the template. Which tab matters most is a personal,
per-user thing — someone babysitting a coding agent lives in Chat, someone debugging a daemon lives
in Events. This feature makes the tab nav **drag-and-drop reorderable** and persists the chosen
order **per browser in localStorage**, so the row comes back the way the user left it (and the
user's preferred tab is the one selected on load, since the first *displayed* tab is the default
selection).

Related/dependent plans:

- **Extends [workspace-detail-tab-consolidation](./2026-07-09_workspace-detail-tab-consolidation.md)** —
  that feature made the tab group the page's single organizing idiom; this makes the idiom
  user-arrangeable. Its keep-mounted panel semantics (chat WebSocket, web-view iframe) are the main
  constraint on the implementation (see below).
- **Modifies the local zard tabs extension** started by that feature's `indicator` dot —
  `z-tab-group` gains a second deliberate local extension (`zReorderKey`), likewise marked
  preserve-on-regenerate for the zard CLI (`shared/components/tabs/tabs.component.ts`).

## What was built

`z-tab-group` gains an opt-in input:

```html
<z-tab-group zReorderKey="qits.workspace-detail.tab-order">
```

- When set, the nav buttons become Angular CDK drag-drop items (`cdkDropList` on the existing
  `nav[role=tablist]`, `cdkDrag` per button, orientation following `zTabsPosition`). Plain clicks
  still select; a drag past the CDK threshold reorders.
- On drop, the group saves the **label array** to localStorage under the key. On construction it
  restores it: saved labels lead the row, labels that no longer exist are dropped, tabs the saved
  order doesn't know are appended in template order — so adding/removing/renaming tabs degrades
  gracefully instead of invalidating the preference.
- Without the input (e.g. the branch-tree divergence tabs, whose labels are dynamic), nothing
  changes: dragging is disabled and no storage is touched.

The workspace detail page opts in with the key `qits.workspace-detail.tab-order` — one global
preference for the route, not per workspace, since it expresses "how I like this page laid out".

## Implementation notes

- **Only the nav reorders; the panels never move.** The tabpanel `@for` still iterates the tabs in
  content order — moving a panel's DOM node would reload the keep-mounted web-view iframe and reset
  scroll state, exactly what the consolidation feature promised not to do. Nav buttons pair with
  their panels through a stable *content index* (`tab-N` ↔ `tabpanel-N`), so `aria-controls` /
  `aria-labelledby` stay correct in any visual order.
- **Active-tab state moved from index to identity** (`signal<ZardTabComponent | null>`): a reorder
  shifts every index, but the selected tab must stay selected. `zTabChange` / `zDeselect` /
  `selectTabByIndex` now speak *displayed* positions; `selectTabByLabel` is unaffected (and remains
  what the page uses for the Events → Files jump).
- **Labels are the persistence identity**, which is why the feature is opt-in per group: it is only
  sound where labels are stable strings. Restore tolerates absent, corrupt, or non-string-array
  values (falls back to content order); writes are best-effort (quota/private-mode failures keep
  the new order for the session only).
- The persisted order is read once per key via `computed` + `linkedSignal`; a drop updates the
  signal and the storage together. No cross-tab (browser-tab) live sync — the other tab picks the
  order up on its next construction, which is fine for a layout preference.

## Testing

- `shared/components/tabs/tabs.component.spec.ts` (new): restore/merge semantics, corrupt-value
  fallback, drop → reorder + persist + selection retention, nav↔panel aria pairing after reorder,
  and drag disabled without `zReorderKey`.
- `workspace-detail.page.spec.ts`: a persisted order renders the row reordered (unknown tabs
  appended) with the first displayed tab selected; specs clear localStorage around each test since
  the page now reads the key.

## Possible follow-ups (not built)

- **Keyboard reordering** (e.g. Ctrl+Arrow on a focused tab) — CDK drag-drop is pointer-only, so
  the reorder affordance currently has no keyboard equivalent. Trigger: an a11y pass over the
  workspace detail route.
- A "reset order" affordance if user confusion ever shows up; today clearing the localStorage key
  is the escape hatch.
