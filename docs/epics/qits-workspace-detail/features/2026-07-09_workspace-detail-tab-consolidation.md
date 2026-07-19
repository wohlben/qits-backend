# Workspace detail tab consolidation: Daemons, Chat, and Web view become tabs

## Introduction

The workspace detail route currently spreads its surfaces across **three different UI idioms**: a
tab group (Files / Events / Telemetry / Plugins), an always-visible **daemons panel** above it, a
**Chat** header button opening a near-fullscreen dialog, and a **floaty Web view button**
(bottom-right) opening a fullscreen dialog. This idea makes the tab group *the* organizing
principle of the page: the daemons panel, the chat, and the web view each become a sibling tab, and
the dialogs/floaty button go away. One page, one tab row, seven tabs — everything the workspace
offers is visible in one place, in one idiom.

> This is a **modification of already-implemented code**, not a parallel design. All three
> components exist and are used only on this page; the change is where they mount and what shell
> (tab panel instead of dialog/panel) they render in. The chat re-attach mechanism, the daemon
> supervisor, and the web-view proxy/picker are untouched.

Related/dependent plans:

- **Extends [workspace-observation-tabs](./2026-07-06_workspace-observation-tabs.md)** —
  that feature moved daemon events into a tab beside Files/Telemetry and noted the panel "shrinks
  back to controls". This completes the move: the remaining controls panel becomes a tab too, and
  the same treatment is applied to the two dialog surfaces.
- **Supersedes the dialog shell of
  [workspace-chat-dialog](./2026-07-04_workspace-chat-dialog.md)** — that doc called the
  dialog "explicitly the first iteration"; this is the next one. Its core semantic (closing only
  hides the viewport, the agent keeps running, reopening re-attaches losslessly — from
  [persistent-chat-sessions](../../qits-coding-agents/features/2026-07-04_persistent-chat-sessions.md) /
  [stream-json-chat](../../qits-coding-agents/features/2026-07-01_stream-json-chat.md)) carries over **for free**,
  because `z-tab-group` keeps inactive panels mounted (`[hidden]`), not destroyed.
- **Modifies the frame of [daemon-webview-picker](./2026-07-05_daemon-webview-picker.md)**
  (and its [configuration follow-up](../../qits-workspace-daemons/features/2026-07-06_daemon-webview-configuration.md)) —
  the proxy (`DaemonProxyRoute`), the `DomPicker`, and the `PromptContextStore` hand-off are
  unchanged; only the fullscreen-dialog + floaty-button shell is replaced by a tab.
- **Modifies [daemons](../../qits-workspace-daemons/features/2026-07-04_daemons.md)** — its workspace controls panel
  (`workspace-daemons.component.ts`) moves from above the tab group into a tab; the component
  itself is unchanged.
- **Interacts with the [daemon-healthchecks](../../qits-workspace-daemons/features/2026-07-10_daemon-healthchecks.md) idea** — its glanceable
  health dots render inside the daemons panel, which after this change lives in a tab. The
  tab-label indicator introduced below is the mitigation for "glanceable things now sit behind a
  tab" and is exactly the slot an aggregate health dot would use.
- Rides [workspace-sse-live-updates](../../qits-workspaces/features/2026-07-07_workspace-sse-live-updates.md)
  unchanged — `WorkspaceLiveService` is page-scoped, so freshness pushes reach every tab whether
  active or hidden.

## Current vs target layout

```
Today                                          Target
─────                                          ──────
Header:  <title>          [Chat ●]             Header:  <title>            (no actions)
┌──────────────────────────────────┐           ┌────────────────────────────────────────────┐
│ Daemons panel (always visible)   │           │ Files │ Chat ● │ Daemons ● │ Web view │    │
├──────────────────────────────────┤           │ Events │ Telemetry │ Plugins               │
│ Files │ Events │ Telemetry │ Plugins         ├────────────────────────────────────────────┤
│  …tab content…                   │           │  …active tab content…                      │
└──────────────────────────────────┘           └────────────────────────────────────────────┘
                       [Web view]  ← floaty
```

Proposed order: **Files · Chat · Daemons · Web view · Events · Telemetry · Plugins**. Files stays
at index 0 (the `openFileFromEvent` anchor target, see below); Chat/Daemons/Web view are the "act
on the workspace" cluster, Events/Telemetry/Plugins the observation cluster. Order is cheap to
change; the invariant worth keeping is Files first.

## Part A — Chat tab (replaces the header-button dialog)

`WorkspaceChatComponent` loses its dialog shell: drop the button, `ZardDialogService`, the
`#chatTpl` template and `open()`; render the template's content directly as the component's
template, mounted in a `<z-tab label="Chat">`. Everything inside survives verbatim:

- The **no-session → prompt panel, session → chat** swap (`activeChatId`), the launch bridge
  (`launchedCommandId`), and the non-`CHAT`-kind login redirect to `/commands/{id}` all stay.
- The content header keeps the **Terminate** button and the "the agent keeps running" hint —
  reworded from "closing this dialog" to "switching tabs".
- **Persistence semantics come from the tab group, not new code.** Inactive panels are `[hidden]`
  but mounted, so the chat's WebSocket stays attached across tab switches — switching away *is*
  what closing the dialog was, minus the re-replay on reopen (strictly better: no reopen cost).
- **Height:** the dialog gave the chat `90vh`; in a tab the chat keeps `app-command-chat`'s
  default `heightClass` (`h-[70vh]`, the same height the command detail page uses) so the
  transcript scrolls internally, not the page.
- The **running-session dot** (today on the header button) moves to the **tab label** — see the
  indicator extension in Part D.

The header's `#pageActions` slot becomes empty and is removed from the page.

## Part B — Daemons tab (folds the always-visible panel in)

`<app-workspace-daemons>` moves unchanged from above the tab group into
`<z-tab label="Daemons">`. The shared query keys keep working exactly as today — the daemons
component, the events tab, and the web view all read `['workspace-daemons', repoId, workspaceId]`
/ `['workspace-daemon-events', …]`, and start/stop invalidation crosses tabs because all panels
stay mounted.

What is genuinely lost is **at-a-glance daemon status while on another tab**. Mitigation: an
aggregate status dot on the Daemons tab label (green ready / amber degraded-restarting / none
stopped) — again the Part D indicator. The page feeds it (and the Chat dot) from its **own**
queries on the shared `['workspace-daemons', …]` / `['commands']` cache keys rather than reaching
into the tab components via `viewChild`: the tab-label bindings evaluate before Angular binds the
children's required inputs, so a `viewChild`-based read trips NG0950 ("required input … no value
available yet") — page-owned shared-key queries sidestep the ordering entirely and cost no extra
fetch.

## Part C — Web view tab (replaces the floaty button + fullscreen dialog)

`DaemonWebviewComponent` swaps its shell the same way: drop the fixed-position button, the dialog
service and `open()`/`close()`; the dialog's content — toolbar (daemon `<select>` when several,
pick-element toggle, picked-count + clear) above the proxied `<iframe>` — becomes the tab's
content, with the iframe filling the remaining height.

- **Always-present tab with an honest empty state.** Today the button only renders while a live
  web-viewable daemon exists; a tab that appears and disappears would reshuffle the row. Following
  the repo's everything-visible convention the tab is always there, and with no live web-viewable
  daemon it renders "No web-viewable daemon running — start one from the Daemons tab" (link/hint,
  not a dead iframe).
- **Iframe lifecycle: lazy-mount, then keep.** Mounted-but-hidden panels would load the framed app
  eagerly on page load even if the tab is never opened. Gate the iframe on
  "the tab has been activated at least once" (a small `wasActivated` signal set on first
  selection); after that it stays mounted so the framed SPA doesn't reload on every tab switch.
  The `DomPicker` re-attach on `(load)` is unchanged.
- **The picker flow gets *better*.** Picked elements land in the root `PromptContextStore`; today
  using them means closing the fullscreen dialog and opening the chat dialog. As sibling tabs the
  flow is: pick in **Web view** → switch to **Chat** → the context chips are waiting. Two clicks,
  no modal juggling — this is the concrete UX payoff of the consolidation.
- **Lost: full-viewport framing.** The dialog was `100dvh/100vw`; a tab shares the page with
  header + tab row. Acceptable for iteration one; an "expand" button restoring a fullscreen dialog
  over the same iframe is deferred (see below) rather than built speculatively.

## Part D — one shared primitive: tab-label indicators

`z-tab`'s `label` is a **plain required string** rendered as the tab button's text — there is no
badge/indicator slot. Both the Chat dot (running session) and the Daemons dot (aggregate status)
need one. Two options:

1. **Extend the local zard tabs component** with an optional `indicator` input on `z-tab`
   (`'none' | 'primary' | 'success' | 'warning'` or a plain boolean + color class) rendered as the
   same `size-2.5 rounded-full` dot the chat button uses today. zard is a local shadcn-style
   library, but its components are CLI-managed by convention (see `zardui-components`), so this is
   a deliberate, documented local divergence — small, additive, and upgrade-mergeable.
2. **Ship iteration one with plain labels** and defer indicators entirely.

Lean: option 1 — the Chat dot is not cosmetic (it answers "is an agent running right now?" from
anywhere on the page, which the header button answered before), and the same slot serves Daemons
now and [daemon-healthchecks](../../qits-workspace-daemons/features/2026-07-10_daemon-healthchecks.md) later.

## Cross-cutting details

- **`openFileFromEvent`** (Events → "open in source") selects the Files tab by
  `selectTabByIndex(0)`. Keeping Files at index 0 preserves it; hardening it to a
  `selectTabByLabel('Files')` helper on the tab group (or a page-level named-index constant) is a
  cheap robustness win while touching the page anyway.
- **The file browser's keep-mounted comment generalizes.** The page's "stays mounted on its hidden
  tab so openFile anchors keep working" note becomes the page-wide rule: *all* panels rely on
  keep-mounted (chat WebSocket, iframe, anchors). Worth stating once in the page's doc comment.
- **`workspace-wip` route untouched** — it uses the prompt panel directly, not
  `WorkspaceChatComponent`, and stays the unlinked prototyping surface.
- No backend, DTO, or `openapi.yml` changes — this is a pure frontend re-mount.

## Explicitly deferred

- **Tab deep-linking** (`?tab=chat` query param, restore on load). Seven tabs make it attractive
  — e.g. linking someone straight to a workspace's web view — but it's an orthogonal routing
  feature for the whole `z-tab-group` pattern, not this consolidation.
- **Web view expand-to-fullscreen** — an affordance re-opening the (kept) fullscreen dialog over
  the same iframe, for real browsing sessions. Build when the in-tab viewport measurably pinches.
- **Split-pane chat** (chat beside files, the evolution the chat-dialog doc anticipated) — a tab
  is still a full-page swap; a persistent side-by-side layout remains the possible iteration
  three, unblocked but not advanced by this change.
- **Per-tab lazy mounting as a general tab-group feature** — only the web view needs it now; do it
  locally with the `wasActivated` gate rather than growing the zard component's API.

## Testing sketch

- **`workspace-detail.page.spec.ts`** — the page renders seven tabs in the proposed order; no
  header chat button, no floaty web-view button; `openFileFromEvent` still selects Files and calls
  `openAtLine`.
- **`workspace-chat.component.spec.ts`** — reshaped from dialog assertions to inline ones: no
  session → prompt panel rendered; running session (seeded `commands` cache) → `app-command-chat`
  attached; terminate invalidates; non-CHAT launch navigates to the command page.
- **`daemon-webview.component.spec.ts`** — no live web-viewable daemon → empty state (no iframe);
  live daemon + first activation → iframe with the proxied `frameSrc`; iframe persists across a
  simulated tab switch (still in the DOM while hidden); picker toggle + picked-count behaviors
  unchanged.
- **Tabs component (Part D)** — covered through the page spec: the Chat/Daemons tabs render the
  indicator dot on their nav buttons (running chat, ready/degraded daemon), and
  `selectTabByLabel('Files')` drives the openFile jump.
- **Manual:** `seed-webapp` → workspace detail: start the daemon from the **Daemons** tab, open
  **Web view**, post a greeting, pick an element, switch to **Chat** — the picked context is
  there; launch a session, flip through every other tab and back — the transcript continues
  without re-replay; the Chat tab shows the running dot the whole time.
