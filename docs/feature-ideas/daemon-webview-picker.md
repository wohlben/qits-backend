# Daemon web-view picker: frame a daemon's app, pick DOM into the prompt

## Introduction

Once [daemons](daemons.md) run the project's dev server, the rendered app is *right there* on a
loopback port — but invisible to the coding agent, which only ever sees source. This idea closes
that loop from the human side: a floaty button opens a full-screen dialog with an **iframe of the
daemon-served app**, plus a **DOM picker** — hover an element, click it, and its HTML lands in a
**prompt-context cache** that the existing prompt-entry flows draw from. "This button is
misaligned" stops being a description and becomes the actual `<button class="…">` handed to the
agent.

The key realisation that keeps this small: **we own both sides.** The daemon app is one of the
user's own projects, launched by qits. So rather than intercepting a stranger's app, we let a tiny
**cooperating script** loaded by the app do the DOM work and `postMessage` picks back to qits. No
reverse proxy, no HTML rewriting, no header surgery — the app is served untouched by its own dev
server, so its assets and hot-reload keep working exactly as they do today. (A zero-touch reverse
proxy is still possible for apps we *don't* control; it's demoted to an optional mode at the end.)

Related/dependent plans:

- Hard dependency on [daemons](daemons.md): the thing being framed is a daemon instance (a
  `CommandKind.DAEMON` registry command). This idea adds one field to the daemon definition
  (`httpPort`) so the UI knows the app's URL, and reads the registry to confirm the instance is
  running.
- The captured HTML feeds the agent through the same door the
  [coding-agent harness](../features/2026-07-01_coding-agent-harness.md) and
  [stream-json chat](../features/2026-07-01_stream-json-chat.md) already use: the
  `speak-to-prompt` flow's `initialContext` (launch a new agent) and the command-chat `draft`
  (message a running one). The picker is an *input source* for prompts, not a new agent channel.
- Complements the [worktree chat dialog](worktree-chat-dialog.md): "pick this element" and "ask
  the agent about it" want to sit next to each other.
- Orthogonal to [observability](observability.md), but the same shape of idea — qits obtaining a
  view into a running app the source alone can't give. Neither requires the other.

## Plausibility: the one wall, and why it isn't in our way

There is exactly one browser constraint here, and it's narrower than it first looks. The daemon app
runs on a **different loopback port** from the qits UI, so it's a **different origin**. The
same-origin policy therefore blocks the qits parent window from reading `iframe.contentDocument`.
That's the whole wall. Critically, it does **not** block `postMessage`:

- A script running **inside** the daemon app reads *its own* DOM freely (home origin to itself) and
  calls `window.parent.postMessage(pick, qitsOrigin)` — cross-origin `postMessage` **out** is
  allowed.
- The qits parent calls `iframe.contentWindow.postMessage({type:'enter'}, daemonOrigin)` to toggle
  pick mode — calling `postMessage` on a cross-origin `contentWindow` is *also* allowed (you just
  can't read its properties).

So the only thing we actually need is **our code running inside the app's page**. Since we own the
app, we simply load it there — no proxy required to inject it. Framing works too: qits sets no
framing headers, and our own dev servers don't set `X-Frame-Options`/`frame-ancestors`, so the
iframe renders.

For contrast, the approaches that would be needed *if we didn't control the app* (all now
unnecessary for the primary case, retained as fallbacks in §"Zero-touch mode"):

1. **Cooperative injection + postMessage** — the above. **Chosen.** Zero proxy, perfect asset/HMR
   fidelity because the app is served untouched.
2. **Reverse proxy + injected script** — rewrite every HTML response to inject the picker and strip
   framing/CSP headers. The only way in for an app we can't touch; carries asset-URL rewriting and
   an SSRF-shaped proxy surface. **Demoted to optional zero-touch mode.**
3. **CDP / Playwright** driving a qits-owned browser — powerful and origin-agnostic, but qits would
   own a Chromium process. The escape hatch if injection ever proves impossible.

## Architecture

### Getting the picker into the app (cooperative injection)

`__qits_picker.js` is a small, framework-free, self-contained file that qits **serves as a static
asset** (e.g. `service/src/main/webui/public/qits-picker.js`, served by Quinoa at the qits origin).
A cross-origin `<script src>` load is not CORS-restricted, so the app can load it directly. Three
delivery flavors, increasingly automatic:

- **Manual script tag (documented v1 default).** Add one dev-only line to the app's `index.html`:
  `<script src="http://localhost:8080/qits-picker.js" data-qits-origin="http://localhost:8080"></script>`.
  Ten seconds per project, works today, nothing clever. The `data-qits-origin` attribute tells the
  picker which parent origin to trust and post to.
- **qits-assisted launch wrapper (refinement).** The daemon's `startScript` is qits-controlled, so
  for known stacks qits can inject without a source edit — e.g. launch Vite with a merged config
  that adds an `transformIndexHtml` plugin emitting the tag, or wrap webpack-dev-server similarly.
  Per-framework work; deferred behind the manual path.
- **Reverse proxy (zero-touch, apps you don't control).** See §"Zero-touch mode".

### The picker script (`__qits_picker.js`)

Vanilla JS, no framework, runs in the daemon app's origin:

- **Mode toggle:** listens for `message`, validates `event.origin` against `data-qits-origin`, and
  on `{type:'qits-pick:enter'|'exit'}` toggles a **capture-phase** `mousemove`/`click` listener.
- **Hover overlay:** one absolutely-positioned `div` (high z-index, `pointer-events:none`, outline)
  repositioned to `target.getBoundingClientRect()` on `mousemove`. No per-element mutation, cheap.
- **Click capture:** capture-phase `click` → `preventDefault()` + `stopPropagation()` so the app
  doesn't react, then post back
  `{type:'qits-pick:result', payload:{outerHTML, selector, url, tag, textPreview}}` to
  `qitsOrigin`, where `selector` is an nth-child chain up to the nearest `id`/`data-testid` and
  `url` is `location.href` (the framed route). When `element.shadowRoot` exists, also include
  `shadowRoot.innerHTML`.
- **Persistence:** the tag lives in the app's own `index.html`, so it survives SPA navigation and
  HMR (same document, and re-served on a full reload) with no re-injection machinery.

The data path is **postMessage only** — no backend round-trip. (Shipping picks through qits' REST
API instead would make the cross-origin `POST` a preflighted request needing loopback CORS
(`quarkus.http.cors=true`); postMessage avoids that entirely and keeps everything client-side.)

### Frontend (`service/src/main/webui/src/app/…`)

- **Floaty button** in `layout/main-layout/main-layout.component.ts` — the only always-mounted
  chrome — fixed bottom-right, `@ng-icons/lucide` (e.g. `lucideScan`). Rendered only when a
  running, web-viewable daemon exists for the context (a TanStack query; `@if` gate).
- **Full-screen dialog** via `ZardDialogService`. The ZardUI dialog is CDK-overlay based and
  centered by default (`dialog.variants.ts` hard-codes `left-[50%] top-[50%] translate-*`). Add a
  `fullscreen` size to the variant (`inset-0 h-full w-full max-w-none rounded-none` overriding the
  centering) through the ZardUI variant mechanism — not an ad-hoc component edit. The body hosts an
  `<iframe [src]="daemonUrl()">` pointing **straight at the real daemon origin**
  (`http://localhost:{httpPort}`), a pick-mode toggle that posts into the iframe, a `message`
  listener (origin-validated) that receives picks, and a thin snippet tray.
- **Prompt-context store** — new root `signalStore` at `shared/state/prompt-context.store.ts` (the
  repo's first `signalStore`; today only `signalState` is used in `branch-list`). Holds
  `PickedSnippet[]` (`{id, html, selector, url, tag, textPreview, capturedAt}`) with
  `add/remove/clear`. Root-scoped so the cache **outlives the dialog** — pick elements, close the
  frame, then use them. The store is the product; the consumers are thin:
  - `pattern/speech/speak-to-prompt.component.ts` — concatenate selected snippets into
    `initialContext` (prompt text + fenced ```html blocks) before launching the agent.
  - `pattern/command/command-chat.component.ts` — insert snippet HTML into the `draft` signal to
    message a running agent.

### Backend / daemon coupling (small)

Extend `AbstractDaemonDefinition` (mirrors
`domain/…/featureflow/entity/AbstractActionDefinition.java` — public Panache fields) with a
nullable **`Integer httpPort`** (+ optional `httpPath`). Nullable cleanly means "web-viewable": the
floaty button only lights up when it's set. Surface it on the daemon/command DTO so the UI can
compose `http://localhost:{httpPort}{httpPath}` for the iframe `src`, gated on the registry showing
a running (`READY`) `CommandKind.DAEMON` instance. That's the entire backend surface — **no new
Vert.x route, no proxy, no `vertx-http-proxy` dependency** in the primary design.

## Zero-touch mode (optional: apps we don't control)

If a daemon app can't be given the script tag (not our source, no launch hook), fall back to a
reverse proxy that injects the picker on the fly — the iframe then points at a qits proxy URL
instead of the daemon directly. This resurrects the machinery the cooperative path avoids and is
worth building *only* if that need appears:

- Add `io.vertx:vertx-http-proxy` (BOM-managed) to `service/pom.xml`; mount `HttpProxy` on the
  Vert.x `Router` at a top-level `/daemon-view/:commandId/*` (not under `/api`), added to
  `quarkus.quinoa.ignored-path-prefixes`.
- A `ProxyInterceptor` injects the picker `<script>` into `text/html` and strips
  `x-frame-options`/CSP (headers **and** `<meta http-equiv>`), stripping `accept-encoding` upstream
  and dropping `content-length`/`content-encoding` after mutation.
- The unavoidable costs that make this the fallback, not the default: root-absolute and
  JS-constructed asset URLs can't be reliably rewritten (Vite/modern-Angular assets and HMR
  degrade); a `*.localhost` subdomain-per-daemon proxy fixes fidelity but adds routing; and the
  proxy is an **SSRF-shaped primitive** (qits fetching `127.0.0.1:{port}`) that must be locked to a
  running daemon's registered loopback port, never a client-supplied URL.

## Explicitly deferred

- **qits-assisted launch-wrapper injection** for known frameworks — the manual tag ships first.
- **Zero-touch reverse-proxy mode** (above) — built only if an app we can't edit needs framing.
- **In-page screenshots** attached to a pick — `html-to-image` inside the framed doc is heavy and
  tainted-canvas-prone on cross-origin subresources. A CDP-side screenshot is the right later shape.
- **Backend snippet channel / MCP feed** — picks could POST to qits and reach the agent's MCP tools
  directly (needs loopback CORS); postMessage-into-the-prompt is enough for iteration one.
- **Port auto-allocation** — inherited limitation from daemons.md; `httpPort` is hardcoded in the
  definition, so parallel worktrees running the same daemon collide.

## Risks and failure modes

1. **Web components / shadow DOM (highest).** `outerHTML` of a custom element is a shallow tag —
   useless for exactly the component-heavy apps this targets (Lit/Stencil). Mitigation:
   `shadowRoot.innerHTML` when present, and frame the feature as *"point the agent at this
   element,"* not *"clone this UI."* (Angular's default light DOM is fine.)
2. **Per-project injection (the trade we accepted).** Each daemon app needs the script tag; this
   is not automatic across arbitrary apps. Fine for the handful of repos you own; the qits-assisted
   wrapper and the zero-touch proxy are the answers if that friction bites.
3. **The app's own dev CSP** could block the external `<script>` or the framing. Dev servers almost
   never set one, and we own the app so we can relax it — but note it for stacks with a strict dev
   CSP.
4. **`outerHTML` fidelity.** Captured HTML carries dev-time hydration attributes and no scoped
   CSS/computed styles — it's a *structural pointer* for the agent, not a reproduction. A UI-copy
   framing to set, not a bug to fix.
5. **Selector brittleness.** nth-child chains drift across HMR re-renders; a `data-testid`-first
   path plus a text preview softens this, but a pick is a moment-in-time capture.
6. **No auth.** The picker script trusts `data-qits-origin` and qits trusts the iframe's origin;
   both are local-loopback assumptions. Acceptable for a local prototype; revisit if qits is ever
   networked.

## Open questions

- **Injection default** — ship the manual tag and add the qits-assisted wrapper later, or invest in
  the Vite/webpack wrapper up front so setup is zero-step for the common stacks? Lean: manual first.
- **Scope of the cache** — global (pick from any daemon, use anywhere) vs per-worktree? Lean:
  global root store, since a snippet is just text once captured.
- **Selector strategy** — is `data-testid`-first enough, or should a pick also carry a coarse
  text/role fingerprint to survive re-renders?
- **`httpPath` vs port only** — do any of our dev servers serve the app under a sub-path? Lean:
  port-only first, add `httpPath` when a case appears.

## Testing sketch

- **Picker script (frontend, or via the `playwright`/`chrome-devtools` MCP):** serve a fixture page
  that loads `qits-picker.js` with a `data-qits-origin`; from a parent frame `postMessage` `enter`,
  click an element → assert a `qits-pick:result` arrives with the right `outerHTML`/`selector`;
  assert a message from a foreign origin is ignored, and that a pick posts only to the trusted
  origin. Shadow-DOM case: a custom element yields `shadowRoot.innerHTML` alongside the shallow
  `outerHTML`.
- **Store:** `add`/`remove`/`clear`; a snippet flows into `speak-to-prompt`'s `initialContext` and
  into `command-chat`'s `draft`.
- **Backend (`@QuarkusTest`):** a daemon definition with `httpPort` set surfaces a web-viewable flag
  + composed URL on its DTO; without it, not web-viewable; the flag also requires a running `READY`
  `DAEMON` command in the registry.
- **Manual:** seed a repo with a web-viewable daemon (`httpPort` set) running `ng serve`, drop the
  script tag into its `index.html`; floaty button → dialog → iframe renders the live app with
  working HMR → toggle pick → click a component → snippet in the tray → insert into a prompt →
  launch the agent and confirm `initialContext` carries the HTML.
