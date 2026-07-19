# Capture the rendered view: screenshot + layout rects for responsive-bug reports

## Introduction

A capture submitted via the `@qits/angular` capture button carries the style-frozen DOM, the
registered app state, and the viewport metadata (`environment.viewport`: width, height,
devicePixelRatio) — but nothing that shows how the page actually *looked*. For the feature's
prime use case — filing a responsive-design bug — that is the one thing missing: "the button
overlaps the header at 390px" is exactly the kind of defect the frozen markup describes only
implicitly and a picture shows instantly. This feature adds two complementary renderings of the
page to the same capture payload:

1. **A screenshot** — the frozen DOM rasterized client-side into a PNG at the captured viewport
   size, so the human triaging the workspace sees the page as the reporter saw it.
2. **Per-element layout rects** — every frozen element stamped with its viewport-relative
   `getBoundingClientRect()` geometry, so the coding agent gets machine-readable numbers
   ("rect `1180,12,320,48` exceeds viewport width 390") without needing vision.

On the backend this is the moment to build the **capture artifact store** that the ingest
feature explicitly deferred: the PNG cannot live in the goal markdown (`Workspace.preamble` is a
`@Lob` with a 256 kB DOM cap, and a megabyte of base64 would wreck the editable goal), so it
lands as a file beside the repo data dir, served by a small GET endpoint, and the goal embeds a
plain markdown image — the existing markdown viewer displays it with zero UI work.

Related/dependent plans:

- **Builds the deferred artifact storage** —
  `docs/epics/qits-feature-intake/features/2026-07-14_capture-ingest-workspace.md` stores the capture *only* as goal
  markdown and names "capture artifact storage (table or disk beside the repo data dir)" as an
  explicitly deferred extension; this feature is that extension, disk-flavored.
- **Extends the capture payload and gesture** —
  `docs/epics/qits-integration-angular/features/2026-07-14_spa-feature-capture.md` defined `CapturePayload`, the freeze, and
  the one-click button whose UX (no permission prompts, never block, degrade silently) this
  feature must preserve.
- **Lands in the integration library** —
  `docs/epics/qits-integration-angular/features/2026-07-13_qits-angular-integration-library.md`: the rasterizer and rect
  stamping are library code (`qits-angular-integration`), rolled out SHA-pinned like every
  library change.
- **Sibling payload enrichment** — `docs/epics/qits-integration-angular/features/2026-07-14_capture-state-snapshot.md` added
  `state` the same way (optional field, best-effort, absent on failure); the `screenshot` field
  follows its contract shape.

## Considered alternatives

- **True pixels via `getDisplayMedia`** (plus Region/Element Capture): pixel-perfect, but the
  browser permission prompt cannot be persisted — the user is prompted and walks a share-picker
  on *every* capture — and Element Capture is Chromium-desktop-only. That kills the one-click
  gesture the capture button is built around. Rejected as the primary path.
- **Viewer-side replay only** (render the frozen DOM in a sandboxed `<iframe srcdoc>` sized to
  the captured viewport, in the qits UI): zero payload change, but it re-renders in the
  *viewer's* browser — it shows how the page *should* render at that viewport, not how it *did*
  render, which is precisely the distinction a rendering-bug report exists to capture. May still
  be worth having later as a DOM-inspection view; it does not replace the screenshot.
- **Rasterization libraries** (html2canvas, html-to-image, modern-screenshot): all implement the
  same SVG-`foreignObject` technique this feature uses, but each re-does the style-inlining work
  our freeze already performs (and html2canvas re-implements CSS rendering outright, poorly for
  modern CSS). Since `freezeDocument` has already produced an inline-styled, canvas-flattened,
  form-state-reflected tree, the remaining rasterization is small enough to own — no new
  dependency.

## Payload contract

`CapturePayload` gains one optional field, absent whenever rasterization fails or is disabled:

```jsonc
"screenshot": {
  "mimeType": "image/png",      // or "image/jpeg" (cap fallback)
  "width": 1440,                 // CSS-pixel viewport size the image depicts
  "height": 900,
  "scale": 1,                    // canvas pixels per CSS pixel actually used (dpr clamped to 1)
  "base64": "iVBORw0K...",
  "bytes": 183204                // decoded binary size
}
```

The frozen DOM additionally carries, on every element, `data-qits-rect="x,y,w,h"` (rounded,
viewport-relative CSS px) and — where content overflows its scroll box —
`data-qits-clipped="x" | "y" | "xy"`.

Rollout is safe in either order: an old backend ignores the unknown `screenshot` field (the
Quarkus default `ObjectMapper` does not fail on unknown properties), and a new backend treats an
absent field exactly as today.

## Library design (`qits-angular-integration`)

### Rect stamping in `document-freeze.ts`

In `freezeInto`, after `reflectFormState` and **before** the `ctx.spent +=
approximateCost(clone)` accounting line — so the stamped attributes count against the existing
2 MB byte budget and the truncation semantics stay untouched:

- `data-qits-rect` from `orig.getBoundingClientRect()`, rounded ints, on every element in both
  `freezeDocument` and `freezeElement` (~30 bytes/element, gzips very well).
- `data-qits-clipped` when `scrollWidth > clientWidth + 1` and/or `scrollHeight > clientHeight
  + 1` (1px slop for subpixel rounding). "Rect exceeds viewport" is deliberately *not* stamped —
  it is derivable from `data-qits-rect` plus the payload's `environment.viewport`.
- Rects are read from the live `orig` and written to the detached clone; the baseline-diff
  iframe is not involved and nothing mutates the live tree between reads, so the walk forces at
  most one layout flush.

**Bonus fix for a found gap**: page-level scroll lives on `document.scrollingElement` (usually
`<html>`), which the body-only freeze never walks — a scrolled page currently freezes with no
scroll record at all. `freezeDocument` should stamp `data-qits-scroll-left/top` (from
`window.scrollX/scrollY`, when non-zero) onto the frozen body clone; the rasterizer takes the
values live regardless.

### Rasterizer — new `rasterize.ts`

```ts
export async function rasterizeFrozenHtml(
  frozenHtml: string,
  options: RasterizeOptions, // width, height, scrollX, scrollY, background, maxBytes, timeoutMs?
): Promise<CaptureScreenshot | undefined>;
```

Pipeline — every step best-effort under an overall ~4 s deadline (`Promise.race`); any throw or
timeout resolves `undefined`. **The capture must always succeed without the screenshot — the
rasterizer never blocks or fails a capture.**

1. **Parse** the frozen body html via `DOMParser` (`text/html`).
2. **Position "as currently rendered"**: append `margin:0; width:{w}px; min-height:{h}px;
   transform: translate({-scrollX}px, {-scrollY}px)` to the parsed body's frozen style, taking
   scroll offsets live from `window.scrollX/scrollY` (see the gap above). Documented fidelity
   limits: element-level scroll containers and `position: fixed` render at their frozen defaults
   inside `foreignObject`.
3. **Inline same-origin images** as data URLs (`fetch` against `document.baseURI`, per-fetch
   `AbortSignal.timeout` ~1.5 s, running inline-total cap). Failures — cross-origin without
   CORS, 404 — leave the src and continue: an SVG loaded through `<img>` fetches no external
   resources, so those render blank rather than tainting anything.
4. **Inline fonts best-effort**: walk the live `document.styleSheets` (cross-origin sheets throw
   on `cssRules` — skip), collect `@font-face` rules, inline their `url(...)` sources the same
   way, emit one `<style>` into the parsed body. Failure degrades to system-font fallback.
5. **Build the SVG**: `XMLSerializer` on the parsed body yields namespace-correct XHTML (xmlns
   stamped, voids self-closed, attributes escaped) — exactly what `foreignObject` requires —
   wrapped in `<svg xmlns=… width={w} height={h} viewBox="0 0 {w} {h}"><foreignObject
   width="100%" height="100%">…</foreignObject></svg>`.
6. **Load** as a `data:image/svg+xml` URL (not a blob URL — keeping every subresource `data:`
   avoids canvas taint in Chromium/Firefox) and `await img.decode()`.
7. **Draw** at `scale = min(devicePixelRatio, 1)` — a viewport-sized PNG is plenty for "how is
   it laid out", dpr-2 quadruples bytes for no diagnostic value, and the true dpr still rides
   `environment.viewport.devicePixelRatio`. Fill the resolved page background first (the frozen
   body is typically transparent; `captureNow` resolves the `documentElement`/body computed
   background, falling back to white).
8. **Encode with a two-attempt cap policy**: `toBlob('image/png')`; over `maxBytes` → re-encode
   `image/jpeg` q0.85; still over → return `undefined`. Deterministic, no downscale loop.

Wiring: `capture-now.ts` calls the rasterizer between freeze and `postCapture` (the button's
existing `busy` state covers the bounded latency); `withFeatureCapture` options gain
`screenshot?: boolean` (default true) and `maxScreenshotBytes?: number` (default
`DEFAULT_MAX_SCREENSHOT_BYTES = 2_097_152`); `public-api.ts` exports `CaptureScreenshot` and
`rasterizeFrozenHtml` (reusable, mirroring `freezeDocument`'s export rationale).

Documented degrades: Safari may taint canvases containing `foreignObject` regardless of
inlining (`toBlob` throws → `undefined` → capture without screenshot); exotic frozen markup that
survives HTML parsing but breaks XML serialization fails `decode()` and lands in the same
degrade path.

## Backend design (qits)

### Ingest: drop-with-warning, never 413

`CaptureResource.CaptureRequest` gains a nested `Screenshot(mimeType, width, height, scale,
base64, bytes)` record; `CaptureContent` gains a framework-free
`Screenshot(byte[] bytes, String mimeType, Integer width, Integer height)`. Validation in
`toContent`:

- base64 decode failure → drop + warn.
- Magic-byte sniff: PNG (`89 50 4E 47 0D 0A 1A 0A`) or JPEG (`FF D8 FF`); anything else →
  drop + warn. **The sniffed type wins over the claimed `mimeType`** — the served Content-Type
  never trusts the wire.
- Over `qits.capture.screenshot-max-bytes` (new config, default 4 MiB — 2× the client default
  for headroom) → drop + warn.

Rationale: the screenshot is auxiliary evidence the client already treats as best-effort, so the
server mirrors that — a corrupt or oversize screenshot must not cost the reporter their
snapshot. The existing decompressed-total 413 (`qits.capture.max-payload-bytes`, 10 MiB) still
applies unchanged and still fits the worst case (~2 MB DOM + ~2 MB selection + ~2.7 MB base64
screenshot + state).

### `CaptureArtifactStore` — the deferred artifact store, disk-flavored

New `@ApplicationScoped` class in `domain/…/capture/control/`, reusing the `MetadataService`
disk conventions (`qits.repositories.data-dir`), owning
`<data-dir>/<repoId>/captures/<workspaceId>.png|.jpg` (extension from the sniffed mime; read
probes both). Both path segments are re-validated against the workspace-slug regex
(`[A-Za-z0-9_-]{1,64}`) as defense in depth.

- **Write after `createWorkspace` succeeds** — no orphaned files when creation throws; the URL
  was safely pre-computable because `CaptureService` fixes the `workspaceId` before rendering.
  A failed write logs a warning and degrades to a 404 image, never failing the capture.
- **Lifecycle cleanup**: `WorkspaceService.doDiscard` calls `deleteScreenshot` beside
  `deleteWorkspaceMetadata`. This is correctness, not hygiene — resolved rows free their slug
  for reuse, so a stale file would be served for an unrelated later workspace. (Accepted taste
  tradeoff: the injection closes a `capture.control ↔ repository.control` package cycle with
  `CaptureService → WorkspaceService`; nothing enforces layering, and teaching `MetadataService`
  about captures would smear capture knowledge into repository code instead.)

### Serving + goal embedding

- New hidden resource: `GET /api/repositories/{repoId}/workspaces/{workspaceId}/
  capture-screenshot` (`@Operation(hidden = true)` — a wire endpoint for the goal markdown's
  `<img>`, not the generated Angular client; no client regen needed). Responds 200 with the
  stored mime as Content-Type and `Cache-Control: private, max-age=86400` (slugs are reusable —
  no `immutable`); 404 for missing file or invalid path-param shape.
- **Session-authed on purpose**: deliberately *not* added to `PublicPaths` (whose exact-match
  keeps `/api/capture` public but nothing under the new path), and not covered by
  `CaptureCorsRoute` (exact-path Vert.x route). The screenshot may contain sensitive app
  content; it is consumed same-origin by the qits UI, where oidc cookies / forwardauth proxy
  headers ride every `<img>` fetch under both auth variants.
- `CaptureGoalRenderer.render` gains a `screenshotUrl` parameter (2-arg overload delegates with
  null) and, when set, inserts before `## Rendered DOM`:

  ```markdown
  ## Rendered view

  ![Rendered view at 1440×900](api/repositories/<repoId>/workspaces/<id>/capture-screenshot)
  ```

  The URL is **base-relative** (`api/…`, no leading slash) per the webui convention — it
  resolves against `<base href>`, so it works at root and under the daemon-proxy prefix
  (qits dogfooding) and survives host changes. The `## Rendered DOM` intro gains a one-line
  legend for `data-qits-rect`/`data-qits-clipped`, emitted only when the DOM actually contains
  `data-qits-rect` so old-library captures don't get a false legend.
- The agent sees the image link and the rect legend through the interpolated preamble
  (`PromptRefinementService`); actually fetching the PNG from inside a container (vision
  dispatch) is explicitly out of scope — see Follow-up.

## Rollout (multi-repo)

1. **Library**: rect stamping + rasterizer + specs; `pnpm build && pnpm test &&
   pnpm test:browser && pnpm lint && pnpm check-exports`; push, note SHA.
2. **qits**: backend (DTOs, drop-validation, artifact store, GET resource, renderer, discard
   cleanup) + config comment block + this doc moving to `docs/features/`.
3. **qits**: bump the library pin in `service/src/main/webui/package.json` + lockfile
   (dogfooding — qits' own captures gain rects + screenshot).
4. **Fixture chain deferred**: the `qits-fixture-angular` → `qits-fixture-quarkus-angular` →
   qits submodule cascade buys only E2E freshness (the fixture works unchanged against the new
   backend); bump it when next touching the fixtures. Until then `/verify` (seed-webapp)
   exercises the old-library degrade path; a locally-linked library build exercises the new one.

## Testing

- **Library browser specs** (`*.browser.spec.ts`, headless Chromium): frozen `data-qits-rect`
  matches `getBoundingClientRect` ±1; `data-qits-clipped` on an overflow box; page-scroll
  stamped; budget still truncates with rects on. New `rasterize.browser.spec.ts`: red-div-on-
  white freeze → defined PNG (magic bytes, echoed dimensions), pixel-probe red inside / white
  outside via `createImageBitmap` + `getImageData`; scroll offset shifts the probe; tiny cap →
  `undefined`; intermediate cap → jpeg fallback. `capture-payload.spec.ts`: screenshot
  included/omitted.
- **Backend**: `CaptureGoalRendererTest` — `## Rendered view` + exact relative URL with the
  3-arg render, absent with null, rect legend only when the DOM carries rects. New
  `CaptureArtifactStoreTest` — write/read roundtrip both mimes, delete, missing → empty,
  invalid ids rejected. `CaptureResourceTest` — capture with a tiny real PNG → 201, preamble
  contains `![Rendered view`, GET roundtrips byte-equal with `image/png` + cache header;
  no-screenshot workspace GET → 404; invalid base64 / wrong magic / oversize (profile-shrunk
  cap) → still 201, no `## Rendered view`, GET 404; workspace discard deletes the file.
  `PublicPathsTest` — pins that the screenshot GET is *not* public.

## Follow-up (out of scope)

- **Webview-picker path**: the qits-side daemon webview picker feeds prompt context, not
  `/api/capture`. Rasterizing the same-origin iframe (`iframe.contentDocument` + the library's
  exported `freezeDocument`/`rasterizeFrozenHtml`) and attaching the image to prompt context
  requires teaching prompt-context and agent dispatch to carry images — a separate feature.
- **Agent vision dispatch**: letting the coding agent actually *see* the PNG (fetch from inside
  the container via a token-free surface, or inline into the prompt as an image block). Until
  then the rects are the agent's rendering.
