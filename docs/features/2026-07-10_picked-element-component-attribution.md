# Picked-element component attribution: walk up to the owning component, attach its source files

> **Status: implemented 2026-07-10.** This doc was rewritten as-built from the original feature
> idea; the "Decisions made during implementation" section records where the built thing deviates
> from or sharpens the idea.

## Introduction

Extends the daemon web-view picker so a pick carries not only the DOM fragment but the **component
that rendered it**: on pick, the DOM is traversed upwards until an element matches a known
component of the framed app, and that component — selector, class name, and its **source files**
(`.ts`, plus template/styles when external) — is attached to the snippet. To match DOM against
code, the backend builds a **component map** of the workspace (selector/class → files) and serves
it per workspace.

Alongside it, the web-view toolbar gained a **URL bar behind a globe icon**: a toggle that
temporarily swaps the toolbar for an input showing the framed app's current URL, letting the user
navigate the frame manually — and making visible the same pick-time URL that every snippet already
carries (now including the **app-side path**, proxy prefix stripped) next to its component
attribution.

Related / dependent plans:

- `docs/features/2026-07-05_daemon-webview-picker.md` — the picker this extends. The pick snippet
  model (`PromptContextStore`, `dom-picker.ts`, `snippet-format.ts`) gained the third capture
  dimension (code attribution) on the same snippet.
- `docs/features/2026-07-04_container-file-access.md` + `2026-07-02_workspace-file-browser.md` —
  `WorkspaceFileAccess` is the read seam the scanner uses; the map endpoint is a sibling of
  `GET /{workspaceId}/files` and reuses the same validate → `ensureContainer` gate.
- `docs/features/2026-07-03_framework-aware-file-browser.md` — frontend framework detection stays
  frontend-side; the backend scanner runs unconditionally (an Angular scan of a non-Angular repo
  yields an empty map).
- `docs/features/2026-07-01_coding-agent-harness.md` — the consumer: the agent runs inside the
  workspace container and can open the attached file paths directly.
- `docs/backlog-ideas/component-attribution-followups.md` — deferred follow-ups (React/Vue
  scanners, tray-chip deep link, untracked-content cache staleness).

## Motivation

A pick told the agent *what the element looks like* (HTML, optionally style-frozen) and *where it
sits* (selector, URL) — but the agent still had to search the workspace for the code that renders
it. The renderer is almost always obvious from the DOM: Angular components appear as custom
elements named by their selector (`<app-greeting>`). Walking from the picked element to the
nearest such ancestor and attaching `app-greeting → src/…/greeting.ts` turns "this button is
misaligned" into a pointer at the exact files to edit — no exploratory grepping by the agent.

## As built

### Backend: the component map

```
GET /api/repositories/{repoId}/workspaces/{workspaceId}/component-map
→ { framework: "angular",
    components: [ { className: "Greeting",
                    componentFile: "src/main/webui/src/app/greeting.ts",
                    templateFile: null,                  // null for inline templates
                    styleFiles: [],
                    selectors: [ { element: "app-greeting", attribute: null } ] } ] }
```

- **Endpoint**: `WorkspaceController.componentMap` (sibling of `/files`), returning
  `ComponentMapDto`/`ComponentMapEntryDto`/`ComponentSelectorDto` (plain records in
  `repository/dto`, no MapStruct — service-derived, no entity).
- **Scanner**: `repository.control.ComponentMapService` validates like every file read (repo row →
  active workspace row → `ensureContainer`, so a merely-stopped container **lazily materializes**),
  then enumerates candidates with one exec —
  `git grep -l --untracked -e @Component -- '*.ts'` — reads each hit through
  `WorkspaceFileAccess.read`, and hands the source to the pure `AngularComponentParser`.
  `*.spec.ts` hits are dropped (test-host components would pollute the map).
- **Parser** (`AngularComponentParser`, package-private, pure): regex-level, **windowed** key
  extraction — each `@Component({` occurrence's window runs to the next occurrence or EOF, and the
  first match of each key (`selector`, `templateUrl`, `styleUrl`, `styleUrls`) wins. Deliberately
  not brace-balancing: inline templates contain `{{ }}` and `@if (...) {` blocks that defeat a
  brace counter. The class name is the first `export class X` after the decorator; a window
  without one is skipped entirely (decorators in comments, unexported test hosts) — misses degrade
  to "no attribution", never to wrong files. `templateUrl`/`styleUrl(s)` resolve lexically against
  the component file's directory; refs that are absolute or escape the workspace root are dropped.
- **Selector kinds**: comma alternatives are pre-parsed into `{ element?, attribute? }` entries
  (`app-foo` element-only, `[appFoo]` attribute-only, `button[appFoo]` both; `.class`/`:not(…)`
  alternatives skipped) so the frontend matcher stays dumb. A selector-less component is still
  emitted with an empty selectors list — routed components stay matchable by class name.
- **Cost/caching**: reading every candidate through `docker exec` per request is too slow, so
  scans are cached in-memory per workspace and validated per request against a cheap working-tree
  marker: SHA-256 over `git status --porcelain=v2 --branch -uall` (HEAD oid + every dirty and
  untracked path) plus `git diff` (tracked content edits). Cache hit = 2 execs; miss = 1 grep +
  N reads. The cache entry is evicted on `@Observes WorkspaceContainerStopping`. The frontend
  fetches **once per pick-mode activation** (TanStack query keyed
  `['component-map', repoId, workspaceId]`, `enabled: pickMode()`) — no polling.

### Frontend: attribution on pick

`component-matcher.ts` builds a matcher from the map; `daemon-webview.component.ts` hands it to
the picker via `DomPicker.setMatcher` as soon as the query resolves (picks made earlier simply
carry no attribution). On pick, `buildSnippet` walks `element` → `parentElement` → root; per node:

1. **`ng.getComponent` first**: the proxied frame is same-origin and daemon dev servers run
   Angular in dev mode, so the framed window's debug API resolves host elements exactly —
   including **selector-less routed components** (`<ng-component>`) — and the constructor name is
   looked up in the map. Try/catch-wrapped; a class name the map doesn't know (e.g. HMR-renamed
   `App2`) falls through.
2. **Selector fallback**: the node's tag against element selectors, then `hasAttribute` against
   attribute selectors (covers prod-mode daemons and minified class names).

The first matching node is the **owning component**; matches further up become the `ancestors`
chain (inner → outer; consecutive nodes resolving to the same entry are counted once). The snippet
gains:

```ts
component?: { selector: string; className: string; files: string[]; ancestors?: string[] }
appPath?: string   // pick-time URL with the daemon's proxy prefix stripped, e.g. /greeting/world
```

`formatSnippetsForPrompt` renders both as header lines before the HTML fence — **paths only, not
contents** (the agent runs in the workspace container and reads the files itself):

```
Picked element <h1> (selector: …) on http://…/daemon/wt/d/greeting/world:
App route: /greeting/world
Rendered by Greeting (app-greeting) — source files: src/main/webui/src/app/greeting.ts
Enclosing components: app-root
```

The trays surface the attribution: `command-chat`'s chip label prefers `component.className` over
the tag; `speak-to-prompt`'s "Picked elements" row shows the full pick context — `className
(selector)` next to the tag, plus a second muted line with the app route, the source file paths
and the enclosing chain (`in app-root`) — i.e. everything the prompt will carry. A matcher failure
never breaks a pick (try/catch to `undefined`).

### Web-view URL bar (globe icon)

The toolbar's first control is a **globe icon button** (`lucideGlobe`); it stays put and toggles
the rest of the bar between its two states:

- **Normal state** — daemon name/select, pick button, picked count.
- **URL state** — a URL input pre-filled with the frame's **current** app-side path (read from
  `iframe.contentWindow.location`, which — unlike `frameSrc` — tracks SPA navigations; falls back
  to the entry path when unreadable), a **reset** icon (`lucideRotateCcw`) shown only while the
  value differs from what the bar opened with, and an **arrow-right** apply button.

Behavior (all in `daemon-webview.component.ts`, path mapping in the pure `app-path.ts`):

- **Apply** (arrow or Enter) navigates the frame to the edited path and closes the bar; applying
  an unchanged path just closes it. Navigation is an in-frame `location.assign`, so the existing
  `(load)` → `picker.attach` re-attach hook covers the document swap — pick mode and marks survive.
- **Reset** restores the input to the path the bar opened with; the frame is untouched.
- **Globe** toggles back without applying (escape hatch).
- **Proxy-scoped**: the input displays and accepts the **app-side path** (`/greeting?tab=2`),
  mapped onto `/daemon/{workspaceId}/{daemonId}/`. A full URL is accepted iff it resolves inside
  this daemon's prefix on this origin; another daemon's `/daemon/…` path is rejected rather than
  silently reinterpreted as an app route. Invalid input shows an inline error and disables apply
  (`zDisabled`).

## Decisions made during implementation

- **Fixture reality vs. the idea's prose**: the `testing-repo-quarkus-angular` components use
  inline backtick templates and flat file names (`greeting.ts`, class `Greeting` — not
  `GreetingComponent`/`*.component.{ts,html}`), so `templateFile` is nullable and the parser's
  primary test shape is the inline-template component.
- **Stopped container**: lazily materializes via `ensureContainer` (the same gate as every file
  read), not an empty map — the acceptance left this open.
- **`git grep` exits 1 on zero matches**, which `WorkspaceFileAccess.git` surfaces as
  `InternalServerErrorException`; the scanner catches it around that one call → empty map. This
  deliberately also masks a genuine grep failure ("empty map, never a 500"; container health was
  just proven by `ensureContainer`).
- **Framework-generic envelope** (`framework: "angular"`) from day one, per the idea's lean.
- **Known cache staleness hole**: content edits to an already-untracked file move neither
  `git status` nor `git diff` — the map stays stale until any other tree change (at worst one pick
  session). Documented on `ComponentMapService`; refinement parked in the backlog idea.

## Limitations

- Angular-only. The scanner is a per-framework strategy behind the endpoint; React/Vue attribution
  is a follow-up (`docs/backlog-ideas/component-attribution-followups.md`).
- Selector matching can't attribute content **projected** via `ng-content` to the projecting
  parent — it attributes the DOM ancestor, which is usually still the right file; the `ancestors`
  chain covers the rest.
- Class-name matching via `ng.getComponent` assumes unminified dev bundles (true for daemons); the
  selector fallback covers the rest.

## Touch points

- `domain`: `AngularComponentParser` + `ComponentMapService` (`repository/control`),
  `ComponentMapDto`/`ComponentMapEntryDto`/`ComponentSelectorDto` (`repository/dto`).
- `service`: `WorkspaceController.componentMap`; `docs/openapi.yml` regenerated.
- `webui`: `component-matcher.ts` + `app-path.ts` (new, both pure), `dom-picker.ts`
  (`setMatcher`, `buildSnippet`), `daemon-webview.component.ts` (component-map query, matcher
  hand-off, URL bar, appPath enrichment in `onPicked`), `prompt-context.store.ts`
  (`SnippetComponent`, `appPath`), `snippet-format.ts`, tray chips in `command-chat` /
  `speak-to-prompt`.
- Tests: `AngularComponentParserTest` (pure), `WorkspaceControllerTest` component-map cases
  (inline+external templates, empty repo, untracked invalidation, dirty-tracked-edit
  invalidation, spec exclusion), `component-matcher.spec.ts`, `app-path.spec.ts`,
  `prompt-context.store.spec.ts` format cases, `daemon-webview.component.spec.ts` (map fetch
  gating, URL bar state machine, appPath), `dom-picker.browser.spec.ts` (real-frame attribution,
  throwing matcher, pick-after-navigation).
