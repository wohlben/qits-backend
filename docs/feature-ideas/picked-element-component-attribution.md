# Picked-element component attribution: walk up to the owning component, attach its source files

## Introduction

Extend the daemon web-view picker so a pick carries not only the DOM fragment but the **component
that rendered it**: on pick, traverse the DOM upwards until an element matches a known component
of the framed app, and attach that component — selector, class name, and its **source files**
(`.ts`, `.html`, styles) — to the snippet. To match DOM against code, the backend builds a
**component map** of the workspace (selector/class → files) and serves it per workspace.

Alongside it, the web-view toolbar gains a **URL bar behind an earth icon**: a toggle that
temporarily swaps the toolbar for an input showing the framed app's current URL, letting the user
navigate the frame manually — and making visible the same pick-time URL that every snippet already
carries next to its component attribution.

Related / dependent plans:

- `docs/features/2026-07-05_daemon-webview-picker.md` — the picker this extends. The pick snippet
  model (`PromptContextStore`, `dom-picker.ts`, `snippet-format.ts`) has since grown one-shot/toggle
  pick gestures, already-picked marks, and an optional style-frozen HTML variant — this idea adds
  the third capture dimension (code attribution) to the same snippet.
- `docs/features/2026-07-04_container-file-access.md` + `2026-07-02_workspace-file-browser.md` —
  `WorkspaceFileAccess`/`WorkspaceFilesService` are the read seams the scanner uses; the map
  endpoint is a sibling of `GET /{workspaceId}/files`.
- `docs/features/2026-07-03_framework-aware-file-browser.md` — the frontend framework-detection
  registry (`shared/utils/detect-frameworks.ts`) already knows *that* a workspace contains an
  Angular app; this idea gives the backend a framework-specific scanner. Detection stays
  frontend-side; the scanner can simply be selected by request parameter or run unconditionally
  (an Angular scan of a non-Angular repo yields an empty map).
- `docs/features/2026-07-01_coding-agent-harness.md` — the consumer: the agent runs inside the
  workspace container and can open the attached file paths directly.
- `docs/features/2026-07-04_daemons.md` / `2026-07-04_workspace-containers.md` — the framed app is
  the workspace's own dev server; its sources live in the container at `/workspace`.

## Motivation

A pick currently tells the agent *what the element looks like* (HTML, optionally style-frozen) and
*where it sits* (selector, URL) — but the agent still has to search the workspace for the code
that renders it. The renderer is almost always obvious from the DOM: Angular components appear as
custom elements named by their selector (`<app-greeting>`). Walking from the picked element to the
nearest such ancestor and attaching `app-greeting → src/app/greeting/greeting.component.{ts,html}`
turns "this button is misaligned" into a pointer at the exact files to edit — no exploratory
grepping by the agent, fewer wasted turns.

## Design

### Backend: the component map

New endpoint, sibling of the files endpoints:

```
GET /api/repositories/{repoId}/workspaces/{workspaceId}/component-map
→ { components: [ { selector: "app-greeting",
                    className: "GreetingComponent",
                    componentFile: "src/app/greeting/greeting.component.ts",
                    templateFile: "src/app/greeting/greeting.component.html" | null,
                    styleFiles: ["src/app/greeting/greeting.component.scss"] } ] }
```

- **Scanner** (`domain`, e.g. `repository.control.ComponentMapService`): list `**/*.ts` via the
  existing `WorkspaceFileAccess` (the container's working tree is the source of truth — it sees
  uncommitted agent edits, unlike the bare origin), read candidate files, and extract
  `@Component({ ... })` metadata at regex level: `selector`, `templateUrl`/`styleUrl(s)` (resolved
  relative to the component file), class name from the following `export class X`. Full TS parsing
  is out of scope — the decorator-literal shape is near-universal in practice, and misses degrade
  to "no attribution", never to wrong files.
- **Selector kinds**: element selectors dominate but attribute (`[appFoo]`) and multi-selectors
  (`a, b`) exist; parse into a small structured form (`{ element?, attribute? }`, one entry per
  comma alternative) so the frontend matcher stays dumb.
- **Cost/caching**: reading every `.ts` file through `docker exec` per request is too slow to do
  eagerly. Scan lazily on first request per workspace and cache in-memory keyed by workspace +
  the working tree's state marker (cheapest available: `git -C /workspace status --porcelain`
  hash, or just a short TTL). The frontend fetches **once per pick-mode activation** (no polling —
  an SSE freshness channel is unnecessary; a stale map only means a just-created component isn't
  attributed until the next pick session).

### Frontend: upward traversal on pick

In `dom-picker.ts` / `daemon-webview.component.ts`:

1. The webview fetches the component map (TanStack Query, key
   `['component-map', repoId, workspaceId]`) when pick mode first turns on, and hands the picker a
   matcher.
2. On pick, walk `element` → `parentElement` → … → root. First ancestor (including the element
   itself) whose tag matches an element selector — or which carries a matched attribute selector —
   is the **owning component**. Record every match on the way up (`componentPath`), not just the
   first: the chain `app-greeting > app-root` is useful context and nearly free.
3. The snippet gains an optional field:

   ```ts
   component?: {
     selector: string;
     className: string;
     files: string[];        // workspace-relative
     ancestors?: string[];   // enclosing component selectors, inner → outer
   }
   ```

4. `formatSnippetsForPrompt` renders it as a short block: rendered by `GreetingComponent`
   (`app-greeting`) — files: `src/app/greeting/greeting.component.ts`, `….html`. **Paths only, not
   contents**: the agent runs in the workspace container and reads the files itself; inlining them
   would bloat every prompt with content the agent may not need.

### Web-view URL bar (earth icon)

The toolbar (`daemon-webview.component.ts`) gains a small **earth/globe icon button** at the top
left, next to the framed daemon's name ("quarkus dev server"). It toggles the toolbar between its
two states:

- **Normal state** — today's bar: daemon name/select, pick button, picked count.
- **URL state** — the earth icon stays put; the rest of the bar is temporarily replaced by a URL
  input, pre-filled with the frame's **current** document URL (`iframe.contentWindow.location`,
  readable because the proxy keeps the frame same-origin — unlike `frameSrc`, this tracks SPA
  navigations). On the right sits an **arrow-right** apply button; a **reset icon** appears
  between input and apply only once the value differs from what the bar opened with.

Behavior:

- **Arrow-right** navigates the iframe to the edited URL and switches back to the normal bar (the
  URL disappears again). Applying an unchanged URL just closes the bar. Enter in the input is an
  alias for the arrow.
- **Reset** restores the input to the URL the bar opened with (the frame's location at open time);
  it does not touch the frame.
- **Earth icon** toggles back without applying — an escape hatch identical in effect to reset +
  close.
- **Proxy-scoped navigation**: the frame must stay inside this daemon's same-origin proxy prefix
  (`/daemon/{workspaceId}/{daemonId}/`), or the picker and the URL bar itself break on a
  cross-origin document. The input therefore displays and accepts the **app-side path** (e.g.
  `/greeting?tab=2`), which the component maps onto the proxy prefix; a full URL pasted in is
  accepted iff it resolves inside the prefix, anything else is rejected inline (input error state,
  apply disabled). This also keeps the mental model right: the user edits the *app's* URL, not the
  proxy's.
- A frame navigation via the URL bar is an in-frame `location` assignment, so the existing
  `(load)` → `picker.attach` re-attach hook covers full document swaps; pick mode and marks
  survive exactly as they do for an in-app reload today.

**Pick-time URL** (already implemented, for context): every snippet records the framed document's
`location.href` at pick time, and `formatSnippetsForPrompt` emits it as `on <url>` next to the
selector — the same URL the bar shows, now attached alongside the component attribution. The only
refinement this feature adds: store/render the **app-side path** (proxy prefix stripped) as well,
so the agent sees the route the app itself was on rather than only the qits proxy path.

### Sharper alternative for the traversal: dev-mode `ng.getComponent`

The proxied frame is same-origin, and daemon dev servers run Angular in dev mode, so the parent
page can call the framed window's debug API directly:
`frameWindow.ng?.getComponent(el)?.constructor.name` while walking up. That is exact where
selector matching is heuristic, and it also attributes **selector-less routed components**
(rendered as `<ng-component>`, invisible to a selector map). It still needs the backend map to
resolve class name → files. Recommended shape: try `ng.getComponent` first, fall back to selector
matching (covers prod-mode daemons and non-dev builds); both resolve against the same map.

## Limitations

- Angular-only at first. The scanner is deliberately a per-framework strategy behind the endpoint;
  React/Vue attribution (devtools hooks, `data-*` conventions) are separate follow-ups and belong
  in `docs/backlog-ideas/` once this lands.
- Selector matching can't attribute content **projected** via `ng-content` to the projecting
  parent — it attributes the projector (the DOM ancestor), which is usually still the right file
  to look at; the `ancestors` chain covers the rest.
- Class-name matching via `ng.getComponent` assumes unminified dev bundles (true for daemons).

## Touch points

- `domain`: `ComponentMapService` + DTOs + mapper; uses `WorkspaceFileAccess`.
- `service`: endpoint on `WorkspaceController` (or a small `ComponentMapController`), OpenAPI
  regeneration (`OpenApiSchemaExportTest`), generated client via `pnpm generate:api`.
- `webui`: query + matcher in `daemon-webview.component.ts`, traversal in `dom-picker.ts`
  (`buildSnippet` gains the component lookup), `PickedSnippet.component`, `snippet-format.ts`
  block, tray display of the component name in `command-chat`/`speak-to-prompt` snippet chips.
- `webui`, URL bar: all inside `daemon-webview.component.ts` — a `urlBarOpen` signal swapping the
  toolbar content, the app-path ⇄ proxy-URL mapping (reusing the `proxyPath` join logic of
  `frameSrc`), lucide globe / arrow-right / reset icons; `PickedSnippet.appPath` (or equivalent)
  for the proxy-stripped route.
- Tests: scanner unit tests against the `testing-repo-quarkus-angular` fixture sources (it has a
  real `@Component`), controller test, picker browser-spec with a component-shaped frame
  (`<app-greeting>` custom tag), snippet-format spec. URL bar: component spec for the toolbar
  swap / reset visibility / prefix validation, browser spec for an actual in-frame navigation
  followed by a pick carrying the new URL.

## Acceptance

- Picking the greeting button in the seeded `seed-webapp` fixture attaches
  `GreetingComponent` with its `.ts` (and template/style files if split) to the snippet, visible
  in the prompt text handed to the agent.
- Picking an element outside any known component (e.g. `<body>` chrome) attaches nothing and
  degrades to today's snippet.
- The map endpoint answers for a workspace whose container is running; a stopped container either
  lazily materializes it (existing `ensureContainer` semantics) or returns an empty map — decide
  during implementation, but never a 500.
- The earth icon swaps the toolbar for the URL bar showing the frame's current app-side path;
  editing it and applying (arrow-right or Enter) navigates the frame and restores the normal bar;
  the reset icon appears only while the value is dirty and restores the opened-with URL; a URL
  outside the daemon's proxy prefix cannot be applied.
- A pick made after a URL-bar navigation carries the new URL (and app-side path) in the snippet,
  next to the component attribution.

## Open questions

- Scan trigger: purely lazy per request (simplest) vs. piggybacking on workspace events to
  pre-warm. Start lazy.
- Should the map endpoint be framework-generic from day one (`{ framework: "angular", ... }`
  envelope) so React support doesn't break the contract? Cheap now, annoying later — lean yes.
- Whether the tray chip should deep-link the attributed file into the workspace file browser
  (nice, orthogonal, can land separately).
