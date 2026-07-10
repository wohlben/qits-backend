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

- **Routes** (`repositories.routes.ts`): **one route entry with a custom `UrlMatcher`**
  (`workspaceDetailMatcher`, exported for its spec) matching
  `':repoId/workspaces/:workspaceId(/:tab)?'` — one page, one entry, zero new components.
  (This deviates from the originally drafted "two path entries" design: Angular's default route
  reuse compares `routeConfig` identity, so two entries would destroy and recreate the page on
  every bare↔slugged transition — chat socket reconnect, web-view iframe reload — violating the
  no-remounts acceptance below. A single matcher-based config is always reused; `paramMap` just
  emits.) The matcher **declines `wip`** explicitly, so the legacy
  `':repoId/workspaces/:workspaceId/wip'` route keeps winning regardless of declaration order;
  `wip` stays a reserved word the slug set must avoid. Any other 4th segment is accepted so
  unknown slugs still reach the page for the normalize-away fallback.
- **Slugs**: tabs are keyed by human label today (`"Web view"`, spaces/caps — also in the
  `zReorderKey` localStorage order and `selectTabByLabel`), so the page owns a label↔slug map:
  `chat`, `files`, `daemons`, `actions`, `web-view`, `telemetry`, `agents`. No id/slug field
  exists on `ZardTabComponent`; the map lives in the page, keeping the shared tab component
  untouched.
- **URL → tab**: the page reads the param reactively
  (`toSignal(route.paramMap, …)` — the `command-terminal.page.ts` precedent; the page's current
  `snapshot.paramMap` reads stay as-is for repoId/workspaceId). An effect resolves slug → label
  and drives the existing `viewChild(ZardTabGroupComponent).selectTabByLabel(...)`. Deep links
  trip the one-way **activation latches** (`webviewActivated`, `agentsActivated`) for free:
  `setActiveTab` emits `zTabChange` for every selection, so `onTabChange` (which flips them)
  sees URL-driven selections too. Unknown slug → the page keeps the default tab and normalizes
  the URL away (`replaceUrl`).
  **Ordering subtlety**: `ZardTabGroupComponent.ngAfterViewInit` unconditionally default-selects
  the first *displayed* tab, and the effect/hook flush order of the pass that mounts the group
  (inside the page layout's success template) is not guaranteed. The effect therefore gates on a
  page-side `activeLabel` mirror (written by `onTabChange`, null until the group's own default
  selection has fired) — the URL's tab is applied strictly *after* the default selection,
  whichever order the pass runs in.
- **Tab → URL**: `onTabChange` navigates to the slug segment (`queryParamsHandling: 'preserve'`),
  guarded twice: not before the URL→tab effect has settled (the group's init default selection
  must never write a segment into a bare URL), and not when the URL already carries the slug (the
  echo of a URL-driven selection). Panels are all-mounted-and-hidden (`[hidden]` toggling in
  `z-tab-group`), and the route/component stays the same, so switching tabs never remounts
  panels — iframes, WebSockets and scroll positions survive exactly as today.
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
- **Consume side**: the page reads `?path=` reactively and hands each distinct value to the
  browser once via the existing viewChild seam (precedent: `openFileFromEvent` →
  `fileBrowser.openAtLine`; panels are always mounted, so no active-tab gate is needed). New
  browser method `openClosestMatch(path: string)`:
  1. **Seed the filter**: `nameQuery.set(path)` — the tree filters automatically, exactly as if
     the user had typed it (the existing `expandTreeForFilter` reveals deep matches). This
     required a small `filterFilePaths` extension: the name pass matched **basenames only**, so a
     slash-bearing query could never match — a query containing `/` now fuzzy-matches the full
     path (strictly enabling; hand-typed path queries start working too).
  2. **Resolve the closest match** among the filtered paths — deferred in an effect until
     `filesQuery` has loaded (a hard deep link arrives before the file list): exact path if
     present, else the new `closestPath` util (longest common path *suffix*, so
     `src/app/greeting.ts` beats `src/other/greeting.spec.ts` for a stale-but-similar target;
     ties → shorter path, then lexicographic).
  3. **Select/open it**: the `revealPath` helper extracted from `openAtLine`/`openLinkedPath`
     (set `selectedPath`, tree `selectedKeys`, expand ancestor dirs). No match → filter stays
     seeded, nothing selected — the user sees why (empty filtered tree with their path in the
     box).
  - This is deliberately more forgiving than the existing `openLinkedPath` (which requires an
    exact loaded path and silently no-ops): picked snippets can outlive renames, and the
    container may have moved files since the pick. Known lazy-dir wrinkle applies: a target
    inside an unopened lazy directory isn't in `allEagerPaths` yet — ancestor expansion is
    best-effort, same as `openAtLine`.
- The query param stays in the URL (a shareable "this file in this workspace" link); it acts as
  a one-shot seed on navigation, not a controlled binding — manual filter edits afterwards don't
  rewrite the URL.

## Touch points

- `repositories.routes.ts` — the `workspaceDetailMatcher` entry replacing the bare path entry
  (`wip` declined explicitly), plus `repositories.routes.spec.ts`.
- `workspace-detail.page.ts` — slug maps, reactive `tab`/`path` params, the URL↔tab sync effect
  (with the `activeLabel` init gate), `onTabChange` → guarded navigate, `?path=` →
  `openClosestMatch` wiring.
- `workspace-file-browser.component.ts` — `openClosestMatch(path)` (filter seed + deferred
  resolution effect), `revealPath` extracted from `openAtLine`/`openLinkedPath`.
- `shared/utils/filter-file-paths.ts` — path-aware name pass (slash queries match full paths),
  new `closestPath` util.
- `speak-to-prompt.component.ts` — per-file `RouterLink`s on the attribution line (its spec and
  `workspace-chat.component.spec.ts` switched from a `Router` mock to `provideRouter([])`).
- `ROUTING.md` — the "URL-segment view selection" deviation and the reserved `wip` segment.
- `docs/backlog-ideas/component-attribution-followups.md` — item 2 graduated to this feature.
- Tests: page spec (slug → tab selection incl. latches, unknown slug fallback, tab change →
  router navigate, loop guards, `?path=` one-shot), browser-component spec for `openClosestMatch`
  (exact, fuzzy-closest, no-match, deferred resolution), utils spec (`closestPath`, slash
  queries), speak-to-prompt spec (file links carry route + query params), matcher spec that
  `wip` is declined.

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

## Resolved questions (as implemented)

- **History semantics**: **push** per tab switch (back walks through tabs) — matches URL-as-state;
  revisit if back-button fatigue shows up. Unknown-slug normalization uses `replaceUrl` so bogus
  URLs don't pollute history. Back to the *bare* URL keeps the current tab (the bare URL doesn't
  pin one).
- `/wip` stays its own page; the matcher's explicit decline keeps both alive. Folding it into the
  chat tab remains out of scope.
- `openClosestMatch` always leaves `nameQuery` seeded (even on an exact match) — it shows why the
  tree is narrowed.
- Tab switches navigate with `queryParamsHandling: 'preserve'`, so a `?path=` link stays shareable
  while flipping tabs; the page's one-shot guard keeps the surviving param from re-seeding.
