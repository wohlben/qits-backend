# Workspace tab in the URL + picked-element file paths deep-linking into the file browser

## Introduction

Two coupled additions to the workspace detail page
(`/repositories/:repoId/workspaces/:workspaceId`):

1. **The active tab becomes a URL path segment** — `/…/:workspaceId/chat`, `/…/files`,
   `/…/daemons`, `/…/actions`, `/…/web-view`, `/…/telemetry`, `/…/agents`. **No new routes or
   components per tab**: the same `WorkspaceDetailPage` renders, the segment only selects which
   tab is active (and tab switches update the URL). This makes every tab shareable/bookmarkable
   and gives in-app links something to aim at.
2. **The "Picked elements" attribution paths become links.** The file paths on speak-to-prompt's
   picked-element rows (added by the component-attribution feature) link to the **files tab**
   with the path as a query param (`/…/files?path=src/app/greeting.ts`); the file browser seeds
   its filter from that param automatically and **selects/opens the closest match**.

Part 2 is the reason for part 1: a file link needs a URL that lands on the files tab. This
supersedes item 2 ("tray chip deep-link") of
`docs/backlog-ideas/component-attribution-followups.md` — its trigger fired.

Related / dependent plans:

- `docs/features/2026-07-10_picked-element-component-attribution.md` — produces the
  `SnippetComponent.files` paths (workspace-relative) this feature makes clickable, rendered in
  `speak-to-prompt.component.ts`'s picked-elements rows.
- `docs/features/2026-07-02_workspace-file-browser.md` +
  `2026-07-03_framework-aware-file-browser.md` — the file browser being deep-linked into
  (`WorkspaceFileBrowserComponent`: `nameQuery` filter, `selectedPath`, `openAtLine`,
  `filterFilePaths`/`fuzzyMatch` utils).
- `docs/features/2026-07-09_workspace-detail-tab-consolidation.md` / `…tab-regrouping.md` — the
  tab strip (`z-tab-group`, label-keyed, user-reorderable via `zReorderKey`) whose active tab the
  URL now mirrors.
- `ROUTING.md` — the "view dispatch inside one route" rule this extends with a documented
  variant: view chosen by an explicit URL segment instead of entity state.

## Motivation

- The workspace page is where everything happens, but its URL says nothing about *where on the
  page* you are. "Look at the daemons tab of this workspace" is not a sendable link, and after a
  reload you always land on the default tab.
- The picked-elements tray now names the exact source files that render a picked element — as
  inert text. The obvious next action ("open that file") is a manual trip: Files tab → type the
  path into the filter → click the match. The row already knows everything needed to do that in
  one click.

## Design

### Tab path segment

- **Routes** (`repositories.routes.ts`): add a second route entry
  `':repoId/workspaces/:workspaceId/:tab'` loading the **same** `WorkspaceDetailPage` — one page,
  two entries, zero new components. The literal `':repoId/workspaces/:workspaceId/wip'` route
  must stay **declared before** the `:tab` entry so `wip` keeps winning (Angular matches in
  declaration order). `wip` becomes a reserved word the slug set must avoid.
- **Slugs**: tabs are keyed by human label today (`"Web view"`, spaces/caps — also in the
  `zReorderKey` localStorage order and `selectTabByLabel`), so the page owns a label↔slug map:
  `chat`, `files`, `daemons`, `actions`, `web-view`, `telemetry`, `agents`. No id/slug field
  exists on `ZardTabComponent`; the map lives in the page, keeping the shared tab component
  untouched.
- **URL → tab**: the page reads the param reactively
  (`toSignal(route.paramMap, …)` — the `command-terminal.page.ts` precedent; the page's current
  `snapshot.paramMap` reads stay as-is for repoId/workspaceId). An effect resolves slug → label
  and drives the existing `viewChild(ZardTabGroupComponent).selectTabByLabel(...)`. Deep links
  must also trip the one-way **activation latches** (`webviewActivated`, `agentsActivated`) the
  page currently only flips in `onTabChange` — factor that into a shared `activateTab(label)`.
  Unknown slug → fall back to the default tab and normalize the URL (`replaceUrl`).
- **Tab → URL**: `onTabChange` navigates to the slug segment. Panels are all-mounted-and-hidden
  (`[hidden]` toggling in `z-tab-group`), and the route/component stays the same, so switching
  tabs never remounts panels — iframes, WebSockets and scroll positions survive exactly as today.
- **No segment** = today's behavior (the tab group's default selection). Note the default is the
  *user-reordered* first tab, so the bare URL deliberately does not pin a specific tab.

### Picked-element file links → files tab

- **Link side** (`speak-to-prompt.component.ts`): the attribution line currently renders
  `component.files.join(', ')` as one span — split it into one link per file:
  `[routerLink]="['/repositories', repoId(), 'workspaces', workspaceId(), 'files']"` with
  `[queryParams]="{ path: file }"` (the `workspace-daemon-events` → command-terminal
  link-with-query-params precedent). The component already has both ids as inputs and imports
  `Router`; speak-to-prompt renders both on the detail page's Chat tab (same-route navigation,
  just a segment + query change) and on the legacy `/wip` page (cross-route) — RouterLink covers
  both identically.
- **Consume side**: the page reads `?path=` reactively and, once the files tab is active, hands
  it to the browser via the existing viewChild seam (precedent: `openFileFromEvent` →
  `fileBrowser.openAtLine`). New browser method `openClosestMatch(path: string)`:
  1. **Seed the filter**: `nameQuery.set(path)` — the tree filters automatically, exactly as if
     the user had typed it (the existing `expandTreeForFilter` reveals deep matches).
  2. **Resolve the closest match** among the filtered paths: exact path if present, else best
     `fuzzyMatch` score (tiebreak: longest common path *suffix*, so
     `src/app/greeting.ts` beats `src/other/greeting.spec.ts` for a stale-but-similar target).
  3. **Select/open it**: reuse the `openAtLine` mechanics (set `selectedPath`, tree
     `selectedKeys`, expand ancestor dirs). No match → filter stays seeded, nothing selected —
     the user sees why (empty filtered tree with their path in the box).
  - This is deliberately more forgiving than the existing `openLinkedPath` (which requires an
    exact loaded path and silently no-ops): picked snippets can outlive renames, and the
    container may have moved files since the pick. Known lazy-dir wrinkle applies: a target
    inside an unopened lazy directory isn't in `allEagerPaths` yet — ancestor expansion is
    best-effort, same as `openAtLine`.
- The query param stays in the URL (a shareable "this file in this workspace" link); it acts as
  a one-shot seed on navigation, not a controlled binding — manual filter edits afterwards don't
  rewrite the URL.

## Touch points

- `repositories.routes.ts` — the `:tab` route entry (after `wip`).
- `workspace-detail.page.ts` — slug map, reactive `tab`/`path` params, `activateTab` (tab select
  + latches), `onTabChange` → navigate, `?path=` → `openClosestMatch` wiring.
- `workspace-file-browser.component.ts` — `openClosestMatch(path)` (filter seed + fuzzy resolve +
  select/reveal), reusing `filterFilePaths`/`fuzzyMatch` and the `openAtLine` mechanics.
- `speak-to-prompt.component.ts` — per-file `RouterLink`s on the attribution line.
- `ROUTING.md` — document the "URL segment selects the active tab of one route" convention and
  the reserved `wip` segment.
- `docs/backlog-ideas/component-attribution-followups.md` — item 2 graduates to this idea.
- Tests: page spec (slug → tab selection incl. latches, unknown slug fallback, tab change →
  router navigate), browser-component spec for `openClosestMatch` (exact, fuzzy-closest,
  no-match), speak-to-prompt spec (file links carry route + query params), routing spec that
  `/wip` still wins over `:tab`.

## Acceptance

- Opening `/repositories/{r}/workspaces/{w}/daemons` lands on the Daemons tab; switching to
  Telemetry rewrites the URL to `…/telemetry`; reload restores it. Deep-linking `…/web-view`
  activates the web view (latch tripped, iframe mounts).
- `…/workspaces/{w}/wip` still opens the legacy speak-to-prompt page.
- Clicking `src/main/webui/src/app/greeting.ts` on a picked-element row lands on the files tab
  with the filter pre-filled and `greeting.ts` selected and open in the viewer.
- The same link with a slightly stale path (file renamed) still selects the closest match rather
  than doing nothing; a path with no plausible match leaves the seeded filter visible and selects
  nothing.
- No tab panel remounts on tab-URL changes (web-view iframe and chat sockets survive, as today).

## Open questions

- **History semantics**: push a history entry per tab switch (back walks through tabs) vs
  `replaceUrl` (back leaves the workspace). Lean **push** — matches URL-as-state; revisit if
  back-button fatigue shows up.
- Should `/wip` fold into the chat tab and free the segment? Out of scope here; the reserved-word
  handling keeps both alive.
- Should `openClosestMatch` clear `nameQuery` after selecting an *exact* match (filter served its
  purpose) or always leave it seeded? Lean: leave it — it shows why the tree is narrowed.
