# SPA feature capture: an always-on button that snapshots the running app into qits

## Introduction

A **floaty capture button** shipped by the
[qits Angular integration library](qits-angular-integration-library-1.md), rendered inside the
integrated app itself — not in qits' web view. Pressing it takes a **moment-in-time snapshot of
the running SPA**: the complete rendered DOM with effective styles frozen inline, the current
URL/route, viewport + environment metadata, and (via the
[state snapshot integration](capture-state-snapshot-4.md)) the app's serialized state. The snapshot
is POSTed by the browser **directly to qits' open capture ingest URL** (relayed to the SPA via
`config.json`, CORS-open on that one path) — where the
[capture ingest](capture-ingest-workspace-2.md) turns it into a new branch + workspace whose goal
carries the captured context — and answers with the workspace's URL, **which the library
navigates to**. The user-facing promise: *see something in the running app, press one button,
and you are standing in a qits workspace that already knows what you were looking at.*

Related / dependent plans:

- **Ships as a feature of** [qits-angular-integration-library](qits-angular-integration-library-1.md)
  (`provideQitsIntegration(withFeatureCapture())`) — hard dependency; capture is the first
  concrete payoff of having a library instead of copied files.
- **Pairs with** [capture-ingest-workspace](capture-ingest-workspace-2.md) — the qits-side
  receiver. Each is separately testable (this side against a stub receiver, that side with
  hand-posted payloads); only the E2E demo needs both.
- **Extends the identity-relay convention of**
  [spa-observability](../features/2026-07-06_spa-observability.md): a `capture` section in
  `/api/config.json` (the availability gate) relaying the qits ingest URL and identity. Unlike
  OTLP there is **no backend passthrough** — the browser posts straight to qits' CORS-open
  ingest endpoint (decided 2026-07-13; capture is a single explicit user gesture to one open
  URL, not a stream that must survive every topology).
- **Complements, does not replace, the**
  [daemon web-view picker](../features/2026-07-05_daemon-webview-picker.md): the picker is
  qits-side, element-scoped, and only exists inside qits' same-origin iframe; capture is
  app-side, whole-app-scoped, and works wherever the app runs — including deployed builds where
  no qits web view exists. The style-freeze machinery is shared lineage (below).
- **Reuses (by adaptation)** the qits webui's `style-freeze.ts`
  (`service/src/main/webui/src/app/pattern/daemon/webview/style-freeze.ts`), generalized from
  element-scoped to document-scoped capture.
- **Feeds on** [spa-telemetry-meta-enrichment](../features/2026-07-11_spa-telemetry-meta-enrichment.md):
  the matched route pattern (`app.route.path`) the library already computes is stamped into the
  snapshot metadata.

## Motivation

Today the jump from *"I'm looking at the running app and have an idea"* to *"an agent is working
on it with the right context"* is manual: open qits, find the repo, branch off, create a
workspace, write a goal that describes what you saw, maybe open the web view and pick an element.
Every step loses fidelity — by the time the goal is written, "the chart tooltip overlaps the
legend when the sidebar is collapsed" has to be reconstructed from memory.

The app itself has all of that context *at the moment of the idea*: the exact DOM, the styles as
rendered, the route, the state that produced the render. The element picker proved the value of
capturing rendered reality instead of describing it — but it is qits-side, so it only exists in
the dev web view. Moving capture **into the app** makes it available always: dev server, deployed
demo, production. That is the "easily jumping into a feature idea" loop this feature exists for.

## The capture payload

One JSON document, gzip-compressed on the wire (`Content-Encoding: gzip` via
`CompressionStream` — the DOM dominates and compresses ~10:1):

```jsonc
{
  "capturedAt": "2026-07-13T14:32:11Z",
  "identity": {                                   // self-stamped from the config.json relay
    "qits.repository.id": "…",
    "qits.workspace.id": "…"                      // source workspace; null outside qits
  },
  "page": {
    "url": "https://…/greeting/anna",              // document URL
    "appPath": "greeting/anna",                    // base-stripped app-side path
    "routePattern": "greeting/:name",              // matched route (app.route.path convention)
    "title": "…"
  },
  "environment": {
    "viewport": {"width": 1440, "height": 900, "devicePixelRatio": 2},
    "userAgent": "…",
    "prefersColorScheme": "dark"
  },
  "dom": {
    "html": "<html style=\"…\">…</html>",          // style-frozen serialization (below)
    "truncated": false,
    "bytes": 812345
  },
  "state": { … }                                   // from capture-state-snapshot-4.md, absent until it lands
}
```

### Document-scoped style freeze

`style-freeze.ts` already solves the hard problem — inline every computed style that differs from
the tag's bare UA default, measured against a stylesheet-free baseline iframe — but for one picked
element. Document scope needs:

- **The baseline iframe lives in the captured document itself** (the picker version creates it in
  the *parent* qits document; here there is no parent).
- **Scroll positions** recorded as attributes (`data-qits-scroll-top`) on scrolled containers —
  a frozen DOM otherwise renders at scroll zero.
- **Form/canvas state**: `value`/`checked` reflected into attributes; `<canvas>` replaced by a
  `toDataURL()` `<img>` (best-effort, taint-safe try/catch).
- **Exclusions**: the capture button's own DOM, `<script>` tags (inert noise in a frozen
  snapshot), and — reusing the picker's convention — anything marked `data-qits-pick-overlay`.
- **Cost honesty**: a computed-style walk over the whole document is O(nodes × properties) and
  can take hundreds of ms on large apps. Capture runs on explicit button press (never a
  background loop), shows a spinner, and is chunked with `requestIdleCallback`-style yielding if
  jank shows up in practice. A hard size cap (default ~2 MB pre-compression, configurable)
  truncates depth-first with `"truncated": true` — a capped snapshot beats a failed POST.
- The library extracts the shared freeze core so the qits picker and capture don't fork it —
  since the picker lives in the qits webui and capture in the library, "shared" means the library
  exports it and the qits webui eventually consumes the library's copy (acceptable duplication
  until then; the algorithm is ~100 lines and settled).

### What is deliberately *not* in iteration one

No screenshot (needs `getDisplayMedia` permission prompts or backend rendering), no recent
telemetry buffer, no console log capture, no DOM mutation timeline. The frozen DOM is the
screenshot substitute — it is what the picker already banks on, and it is diffable text.

## The button

- Rendered by `withFeatureCapture()` as a fixed-position floaty (bottom-left, to avoid colliding
  with qits' own bottom-right floaties when the app runs framed in the web view), using the
  library's own minimal styles — no dependency on the host app's CSS framework.
- **Gated by `config.json`**: rendered only when the relay reports `capture` non-null (next
  section). Standalone runs, capture-less backends, and misconfigured deploys show no button —
  the same dark-by-default stance as telemetry, and the answer to "always deployed": the *code*
  always ships, the *button* appears only where a qits can receive.
- **The press is the whole gesture — no input, no dialog.** Press → spinner → snapshot → POST →
  on `201`, **navigate to the created workspace**: the ingest response carries the workspace
  page's browser URL ([capture-ingest-workspace](capture-ingest-workspace-2.md) derives it from
  the request origin) and the library goes there — `window.top.location.assign(url)`, top window
  deliberately, so a capture from inside the qits web view lands the *qits tab* on the new
  workspace instead of navigating the framed app away inside its iframe. The user finishes on
  the workspace page, goal pre-filled, ready to edit intent in and start an agent. On failure: a
  retry-able error toast, the app undisturbed.
- Escape hatch: `withFeatureCapture({renderButton: false})` + an exported
  `captureNow(): Promise<{url: string}>` for apps that want their own trigger UI — it resolves
  instead of navigating, so custom triggers choose their own follow-through.

## Reaching qits: config relay, then straight to the open ingest URL

Decided (2026-07-13): **no backend passthrough.** The browser POSTs the payload directly to
qits' ingest endpoint, which is CORS-open for any origin — *on that one path only* (the
[ingest side](capture-ingest-workspace-2.md) owns the CORS decree). What remains app-side is pure
relay, one decree:

**`config.json` grows a `capture` section** (null when unavailable — the gate that hides the
button):

```json
"capture": {
  "ingestUrl": "http://…/api/capture",
  "resourceAttributes": { "qits.repository.id": "…", "qits.workspace.id": "…" }
}
```

- Built from whatever the backend has configured — the injected `QITS_CAPTURE_ENDPOINT` env
  under a qits daemon, an `application.properties` value in a deployed build. The backend
  relays; it does not proxy, validate, or stamp. (The telemetry section already relays the same
  resource attributes; `capture` carries its own copy so each section stays independently
  null-able.)
- The SPA self-stamps the relayed identity into the payload, exactly like it self-stamps OTEL
  resource attributes — the browser is at the same unauthenticated trust level either way, and
  the ingest fails closed on identity it can't resolve.
- Why direct-post is acceptable here where OTLP chose proxy-through: capture is one explicit
  user gesture producing one request to one URL that CORS explicitly opens — none of the
  exporter-URL-composition, streaming, or collector-exposure concerns that motivated the OTLP
  gateway. The cost is that the configured `ingestUrl` must be **browser-reachable** (below).

**qits-side injection seam**: `CommandService.prepare()` (where `OtelEnvironment` composes the
OTLP vars) additionally injects
`QITS_CAPTURE_ENDPOINT=http://<QitsHostResolver.qitsHost()>:<port>/api/capture` —
**unconditionally for daemons** (like `TERM`), not behind the `otel` toggle (decided
2026-07-13). The app-side gate (env unset ⇒ `capture: null` ⇒ no button) already handles
absence; deployed-outside-qits apps configure the value themselves.

**The browser-reachability wrinkle** (the one honest gap of direct-post): the injected value's
host (`qits` on `qits-net`, or `host.docker.internal`) is container-reachable but generally
*not* resolvable from the user's browser. Deployed apps configure a public URL and are fine.
For the dev web view the library covers it structurally: when the page runs under the daemon
proxy (it already detects the `/daemon/{…}/` base for the `<base>` rebase), the frame origin
*is* qits — so the library posts to `<frame-origin>/api/capture` (same-origin, CORS moot) and
uses the relayed `ingestUrl` only when not framed. Verbatim-relayed config plus one
frame-detection fallback, no new backend mechanism.

## Testing (green without the qits ingest existing)

- **Library browser specs** (the `*.browser.spec.ts` pattern the qits webui already runs):
  document freeze round-trips a fixture page (styles survive stylesheet removal — the existing
  `style-freeze.browser.spec.ts` assertion, document-scoped); scroll/form/canvas reflection;
  size-cap truncation sets the flag; the button renders iff config reports `capture`; press →
  POST body decompresses to a schema-valid payload carrying the relayed identity (stubbed
  `fetch`); target selection — framed under a `/daemon/{…}/` base ⇒ frame-origin `/api/capture`,
  unframed ⇒ the relayed `ingestUrl`; a stubbed `201` triggers top-window navigation to the
  returned `url` while a stubbed failure leaves the location untouched.
- **Fixture backend tests** (extending `ConfigResourceTest`): `capture` section relays
  `QITS_CAPTURE_ENDPOINT` + the parsed resource attributes when configured; `capture: null`
  without the env — the gate that keeps standalone runs buttonless.
- **qits side (this idea alone)**: one `CommandServiceTest` assertion — daemon env contains
  `QITS_CAPTURE_ENDPOINT` with the resolved host. The receiving endpoint is
  [capture-ingest-workspace](capture-ingest-workspace-2.md)'s test surface.
- **E2E (once the ingest lands)**: `seed-webapp` → web view → press capture → the qits tab
  lands on the new `feature/<ts>` workspace page with the goal populated.

## Open questions

- **Payload cap vs. fidelity**: 2 MB pre-compression is a guess; the greeting fixture is tiny,
  real apps aren't. Measure on a real app before hardening the default.
- **Capture from inside the qits web view**: the app framed in qits' web view will show the
  button too (it's the same app). That's coherent — capture works identically — but two floaty
  vocabularies coexist on screen; revisit placement if it confuses.
- **Auth**: the ingest URL is unauthenticated and CORS-open, same trust stance as the OTLP
  receiver. A deployed-on-the-internet app capturing into a qits needs a shared secret at
  minimum — defer until the deployed story is real, but don't design it out (a relayed token in
  the `capture` config section, sent as a header, is the natural later shape).
