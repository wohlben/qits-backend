# Epic: qits-feature-intake — from a captured moment to a workspace with a goal

## Introduction

The **feature-intake domain**: the front of the funnel that turns an observation in a running
app into an actionable workspace. You are using a qits-managed app, you spot something to change,
you press the capture button — a snapshot of the moment (route, environment, app state, the
style-frozen DOM, and, as an idea below, a rendered screenshot) lands as a **new branch +
workspace whose goal is that captured context**, ready for an agent to be pointed at. The
feature-idea/goal is the **output** of this domain, not its input.

> **Emerging epic.** The backend intake (`capture-ingest-workspace`) is implemented; the broader
> vision — richer captured signal, the full observation→feature funnel — is still being fleshed
> out. This epic is the home that work lands in as it matures.

**Cross-cutting epic**, not part of the projects → repositories → workspaces aggregate chain.
It sits at the seam between the SPA (which produces the capture) and qits (which turns it into a
workspace).

Related epics / cross-cutting concerns:

- **The SPA producers live in the library** — [qits-integration-angular](../qits-integration-angular/epic.md):
  the always-on capture **button** (`spa-feature-capture`) and the **state snapshot**
  (`capture-state-snapshot`) ship inside `@qits/angular`. This epic owns the qits-side *intake*
  of what they post; that epic owns the browser-side *production* of it.
- **Produces a workspace** — [qits-workspaces](../qits-workspaces/epic.md): intake creates a
  `feature/<date-time>` branch off main and a workspace whose `preamble` (goal) carries the
  captured context — so an agent ([qits-coding-agents](../qits-coding-agents/epic.md)) can be
  pointed at it immediately.
- **Open write surface** — the `POST /api/capture` endpoint is CORS-permissive and token-free on
  that one path (posted by an app's browser, no session); its trust model is an
  [auth](../qits-authentication/epic.md) concern (`PublicPaths`).
- **Distinct from the artifacts capture store** — the in-monolith `CaptureArtifactStore`
  (referenced by the rendered-view idea) is workspace-lifecycle-bound, not a branch-keyed golden;
  see [qits-artifacts](../qits-artifacts/epic.md).

## Parts (implemented)

- **[capture-ingest-workspace](features/2026-07-14_capture-ingest-workspace.md)** (07-14) — the
  qits-side receiver: `POST /api/capture` accepts a snapshot posted by the running app's browser,
  resolves the repository, branches `feature/<date-time>` off main, and opens a workspace whose
  goal carries URL/route, environment, state, and the frozen DOM.

## Open ideas

- **[capture-rendered-view-screenshot](feature-ideas/capture-rendered-view-screenshot.md)** — add
  a client-side rendering of the page (a PNG rasterized from the frozen DOM at the captured
  viewport) to the capture payload, so a responsive-design bug is shown, not just described
  implicitly by markup.

## Done when

Rolling: current when its `feature-ideas/` is empty and every feature-intake feature since this
epic's creation has landed here.

## Status

| Part | Status |
|---|---|
| [capture-ingest-workspace](features/2026-07-14_capture-ingest-workspace.md) | implemented |
| [capture-rendered-view-screenshot](feature-ideas/capture-rendered-view-screenshot.md) | idea |
