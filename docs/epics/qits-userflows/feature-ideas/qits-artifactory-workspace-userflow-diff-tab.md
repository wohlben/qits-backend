# CI user-flow diff tab: story-level golden comparison on the workspace detail

## Introduction

The consumer that closes the [qits-artifactory](../../qits-artifactory/feature-ideas/qits-artifactory.md) →
[qits-userflows](qits-userflows.md) →
[renderer](qits-userflows-artifactory-renderer.md) chain: a new **CI tab** on the workspace
detail route showing, per **user story**, how the workspace branch compares against the parent
branch's goldens — **NEW / CHANGED / REMOVED / unchanged** badges on collapsed expanders, and
the two branches' rendered **story documents side-by-side** when an expander opens.

> **Supersedes the media-pairing draft** (2026-07-19): an earlier version of this plan diffed
> individual images/videos paired by element metadata, with the story documents deferred. That
> intermediate UI was dropped before implementation — element-level media lists without story
> context only become genuinely usable once story documents exist, so the tab ships once,
> story-shaped, directly on `ci-userstories`.

The load-bearing decision survives from that draft: the comparison is a **backend-driven
evaluation**. qits' backend queries artifactory for both sides (latest story documents on
`Workspace.parent` vs. the workspace branch), pairs them by user flow, compares their
`qits.diff.hash` metadata, and hands the UI finished verdicts. The smart component renders what
it is given — it never queries artifactory, never pairs, never hashes. The evaluation runs as
in-process calls into the artifactory module today (its API is hosted by `service` per the
artifactory plan's module split) behind a client seam that becomes an HTTP client after the
future deployment split.

Related/dependent plans:

- **Hard dependency** — [qits-artifactory](../../qits-artifactory/feature-ideas/qits-artifactory.md) (the store, the metadata
  contract — this tab is why `qits.display.name`/`qits.diff.hash` are mandatory there) and the
  [qits-userflows-artifactory-renderer](qits-userflows-artifactory-renderer.md) (the
  `ci-userstories` type and its deterministic document hash are exactly what the evaluation
  compares; the renderer's base-relative media URLs are what makes the documents render inside
  the qits UI with zero URL rewriting). This plan lifts the renderer's "displaying
  `ci-userstories` documents" out-of-scope item.
- **Producer** — [qits-userflows](qits-userflows.md) stories, run via
  [actions](../../qits-feature-flows/features/2026-05-01_actions.md) on the parent branch once and on the workspace
  branch per change; without both sides the tab is honestly empty, not broken.
- **One more `<z-tab>`** in the group owned by
  [workspace-detail-tab-consolidation](../../qits-workspace-detail/features/2026-07-09_workspace-detail-tab-consolidation.md);
  [draggable tabs](../../qits-workspace-detail/features/2026-07-09_draggable-workspace-detail-tabs.md) absorbs the new
  label, and [tab-url deep links](../../qits-workspace-detail/features/2026-07-10_workspace-tab-url-and-picked-file-deep-link.md)
  need a `CI → ci` slug entry.
- **Markdown rendering precedent** —
  [chat-markdown-rendering](../../qits-workspace-detail/features/2026-07-02_chat-markdown-rendering.md): the story
  document is markdown; the tab reuses the webui's markdown rendering path rather than
  growing a second one.
- **Session-authed media precedent** —
  [capture-rendered-view-screenshot](../../qits-feature-intake/feature-ideas/capture-rendered-view-screenshot.md)'s screenshot GET:
  the artifactory blob reads consumed by `<img>`/`<video>` are same-origin `api/…` fetches
  with oidc cookies / forwardauth headers riding along under both variants.
- **Live freshness convention** — one initial fetch per activation plus explicit refresh;
  push-freshness, if ever wanted, rides the
  [workspace SSE channel](../../qits-workspaces/features/2026-07-07_workspace-sse-live-updates.md), never a poll
  interval.

## Backend contract

### The evaluation endpoint

`GET /api/repositories/{repoId}/workspaces/{workspaceId}/ci/userflows`

The backend:

1. Resolves the two branches: parent = `Workspace.parent`, current = `Workspace.branch`.
2. Queries `ci-userstories` with the `latest=true` collapse for each branch — two queries,
   server-side, through the artifactory client seam.
3. **Pairs** story documents across the sides by `qits.userflow.name`.
4. **Evaluates** each pair:
   - workspace side only → `NEW`
   - parent side only → `REMOVED`
   - both, `qits.diff.hash` equal → `UNCHANGED`
   - both, `qits.diff.hash` differs → `CHANGED`
   The hash is compared as an opaque string; per the renderer's contract it is the digest of
   the deterministically rendered document, so it moves exactly when the description, the
   steps, or any referenced medium changed.
5. Returns finished verdicts with the **story markdown inlined** (documents are small text;
   inlining spares the UI a request per expander — the heavy media bytes stay behind the
   markdown's own blob URLs and load only when rendered):

```jsonc
{
  "parent":    { "branch": "main",      "commitHash": "abc123…" },
  "workspace": { "branch": "feature/x", "commitHash": "def456…" },
  "stories": [
    {
      "userflowName": "create-a-greeting",
      "displayName": "Create a greeting",          // qits.display.name of the story document
      "status": "CHANGED",                          // NEW | CHANGED | REMOVED | UNCHANGED
      "flowDefinitionChanged": true,                // sides' qits.userflow.hash differ
      "old": { "markdown": "# Create a greeting…", "metadata": { /* all stored keys */ } },
      "new": { "markdown": "…", "metadata": { … } } // NEW ⇒ old: null; REMOVED ⇒ new: null
    }
  ]
}
```

- Ordering: stable, by `displayName`; the badges carry the salience.
- A branch with no story documents yields an empty side (everything `NEW`, or an empty list) —
  never an error. A failing artifactory query → 5xx with a clear message (502 once artifactory
  is a remote service); the tab shows an error state, never a silent blank.
- `flowDefinitionChanged` does not alter the status math — a changed test is a changed
  yardstick, and the UI must be able to say so next to the badge.

### Media reads

None of qits' own endpoints: the story markdown already references its media as base-relative
`api/artifactory/repositories/…/blobs/<id>` URLs (the renderer's deliberate URL form), which
resolve same-origin against the `service`-hosted artifactory API with session auth riding
along — no dedicated per-workspace media proxy needed, one simplification the story-shaped
unification buys over the superseded draft. The blob GET's `Cache-Control: immutable` makes
re-opening expanders free. (After the deployment split, qits fronts these paths with a thin
proxy to the standalone service — the URLs in stored documents never change.)

## UI design

- New `<z-tab label="CI">` in `workspace-detail.page.ts` + `['CI', 'ci']` in
  `TAB_SLUG_BY_LABEL`. Dedicated smart component
  `pattern/workspace/workspace-ci-userflows.component.ts` (standalone, OnPush, signals): one
  fetch on first activation, manual refresh button — no polling.
- Header line: `main @ abc123 → feature/x @ def456`, plus per-status counts
  (`2 new · 3 changed · 1 removed · 14 unchanged`).
- **One expander per story** (zardui accordion). Collapsed row: the story's display name; the
  status badge visible while closed — `NEW` **green**, `CHANGED` **yellow**, `REMOVED`
  **red**, `UNCHANGED` **gray** (gray keeps unchanged rows scannable-past; the colored three
  are what the eye should find); a small "flow changed" annotation when
  `flowDefinitionChanged`.
- **Expanded**: two panes — **left = old** (parent's story document), **right = new**
  (workspace's) — each the rendered markdown: description, step block, inline screenshots,
  video. The markdown renderer special-cases artifactory blob links to video mediatypes into
  `<video controls preload="metadata">` (the document's plain link form stays the portable
  fallback everywhere else). The missing side of a `NEW`/`REMOVED` story renders a labeled
  placeholder ("no parent recording" / "removed on this branch") — the asymmetry *is* the
  information. Panes stack vertically on narrow viewports.
- Media loads lazily by construction: blob URLs are only fetched when an expander's markdown
  actually renders.

## Out of scope

- **Element-level diff verdicts inside a story** (badging which screenshot changed, computed
  from the media blobs' own `qits.diff.hash` metadata): the side-by-side documents make the
  change visually findable for iteration one; per-element annotation is the natural first
  enhancement if long stories make scanning tedious.
- Pixel-level overlays (onion-skin, swipe, highlight-rects).
- Any write path: re-blessing a workspace recording as golden, deleting story documents,
  triggering the userflows action from the tab — the tab is read-only.
- Cross-workspace comparison (arbitrary branch pickers): the parent is always
  `Workspace.parent`.

## Open questions

- **Parent staleness**: the parent side is the parent branch's *latest* document, which may
  postdate the workspace's branch point; comparing against the recording nearest the
  merge-base would be stricter. Deferred until it bites.
- Should `UNCHANGED` rows collapse behind a "show unchanged (14)" toggle by default? Leaning
  yes once real lists exist; trivial either way.
- **Markdown trust**: story documents are produced by workspace-run code, so the rendered
  markdown is attacker-influenceable by whoever controls the branch — same trust class as
  chat/goal markdown; the tab must use the same sanitizing renderer path, pinned by a test.

## Testing sketch

- **Backend evaluation unit tests** (stubbed artifactory query seam): pairing by flow name;
  each status incl. both null-side shapes; opaque hash comparison; empty parent side ⇒ all
  `NEW`; `flowDefinitionChanged` flag; stable ordering.
- **Controller test**: response shape with inlined markdown; failing artifactory query ⇒ 5xx;
  unknown workspace ⇒ 404.
- **Component spec**: badge color per status; badges visible collapsed; expand renders
  left-old/right-new markdown; video-link special-casing; placeholder on missing side;
  refresh refetches; error state on failed fetch; sanitizer path pinned.
- **Manual acceptance walk**: seed-webapp workspace, run the userflows action on parent and
  workspace branches with one changed flow, open the CI tab, verify one yellow expander whose
  side-by-side documents visibly differ and whose video plays.
