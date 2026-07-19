# Component attribution follow-ups: more frameworks, tray deep-links, sharper cache invalidation

## Introduction

[Picked-element component attribution](../epics/qits-workspace-detail/features/2026-07-10_picked-element-component-attribution.md)
shipped Angular-only, with paths-only tray chips and a two-exec working-tree cache marker. This
parks the three follow-ups that were explicitly cut from that feature, phrased as changes to its
**already-implemented** code (`ComponentMapService`/`AngularComponentParser` in `domain`,
`component-matcher.ts` and the tray chips in `webui`).

Related / dependent plans:

- `docs/epics/qits-workspace-detail/features/2026-07-10_picked-element-component-attribution.md` — the landed feature every
  item below modifies.
- `docs/epics/qits-workspace-detail/features/2026-07-03_framework-aware-file-browser.md` — the frontend framework-detection
  registry a framework-parameterized scan would consult.
- `docs/epics/qits-workspace-detail/features/2026-07-02_workspace-file-browser.md` — the file browser a tray chip would
  deep-link into.

## 1. React/Vue scanner strategies

**Change**: `ComponentMapService.scan` currently hardcodes the Angular pipeline (grep for
`@Component`, `AngularComponentParser`). Extract a per-framework scanner strategy (grep pattern +
parser), keyed by the `framework` field the envelope already carries; scan all strategies (or let
the client pass `?framework=`) and merge. React attribution has no custom-element selectors — the
matcher side needs the React devtools hook (`__REACT_DEVTOOLS_GLOBAL_HOOK__`) or
`data-*`-convention support in `component-matcher.ts`, resolved against a className/displayName
map. Vue similarly via `__vue_app__`.

**Trigger**: the first workspace fixture or real repository with a React or Vue dev-server daemon
whose picks should be attributed.

## 2. Tray chip deep-link into the workspace file browser — **graduated**

Shipped as `docs/epics/qits-workspace-detail/features/2026-07-10_workspace-tab-url-and-picked-file-deep-link.md` (the trigger
fired): the speak-to-prompt rows' file paths became RouterLinks to the files tab with a `?path=`
query param the browser resolves to the closest match. The repo/workspace ids come from
speak-to-prompt's own inputs, so `PickedSnippet` needs no extension. Still open here: the
`command-chat` chips (rendered outside a workspace route) stay inert until a snippet carries its
own workspace identity.

**Trigger** (for the command-chat remainder): a command chat user asking for the file behind a
chip — needs `PickedSnippet` to carry repo/workspace ids or resolve them from the pick-time proxy
path.

## 3. Untracked-file content edits don't invalidate the component-map cache

**Change**: `ComponentMapService.workingTreeMarker` hashes `git status --porcelain=v2 --branch
-uall` + `git diff`; editing the *content* of an already-untracked file moves neither, so the
cached map stays stale until any other tree change. Sharpen the marker with a cheap mtime probe
over untracked files (e.g. `find` the paths status already listed, print `%T@`, hash along) — one
more exec on every request, so measure before adopting.

**Trigger**: an observed confusion where a freshly created-then-edited component attributes with
stale metadata during a single pick session (the window today: create file → pick → edit selector
→ pick again without touching anything else).
