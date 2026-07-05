# Daemon proxy cross-origin mode: subdomain routing + injected picker

## Introduction

The [daemon web-view picker](../features/2026-07-05_daemon-webview-picker.md) serves every daemon
through the path-prefix proxy (`/daemon/{worktreeId}/{daemonId}/*`) on the qits origin: the dev
server is launched with `QITS_PUBLIC_BASE` so it natively serves under the prefix, the proxy
forwards bytes verbatim, the iframe is same-origin, and the picker reaches into
`iframe.contentDocument` from the qits frontend. That design deliberately assumes a
**cooperating, base-capable app**. This backlog idea covers the apps it excludes: dev servers
that cannot serve under a sub-path, apps whose hand-written root-absolute `fetch('/api/…')`
calls collide with qits' own `/api`, and apps we don't trust enough to share the qits origin
with. For those, the existing proxy grows a second, **cross-origin mode**: wildcard-subdomain
routing plus proxy-side picker injection.

Related/dependent plans:

- Changes the proxy and picker shipped by the
  [daemon web-view picker](../features/2026-07-05_daemon-webview-picker.md) — this is a modification
  of that code, not a parallel implementation. Everything here assumes that feature exists.
- The proxied thing is still a [daemon](../features/2026-07-04_daemons.md) instance; the daemon
  definition gains a mode field (below).

## What exists today (the code being changed)

- The Vert.x `HttpProxy` route mounted at `/daemon/*` (`@Observes Router` in `service`), with an
  `OriginRequestProvider` that resolves `(worktreeId, daemonId)` from the **path** to
  `127.0.0.1:{httpPort}` via the registry's runtime state. No interceptors — verbatim
  passthrough, WebSocket upgrades forwarded by default.
- The picker: an Angular service/directive in the qits frontend that attaches capture-phase
  listeners directly on the same-origin `iframe.contentDocument`, re-attaching on the iframe
  `load` event.
- The daemon supervisor injects `QITS_PUBLIC_BASE` into the daemon environment at spawn; the
  DTO exposes the proxied base path the dialog uses as relative iframe `src`.

## The change

### 1. Subdomain routing in the existing proxy

Add host-based key extraction next to the path-based one. A daemon in cross-origin mode is
served at `http://{worktreeId}--{daemonId}.daemon.localhost:{qitsPort}/` — the app lives at `/`
from its own point of view, so **no base path, no `QITS_PUBLIC_BASE`, no startScript
convention**; root-absolute assets, HMR, and hand-written fetches all just work, because paths
are still forwarded verbatim.

- The `@Observes Router` mount gains a `virtualHost("*.daemon.localhost")`-matched route (or
  Host-header inspection in the shared handler) feeding the same `OriginRequestProvider`, which
  now parses the key from either the path prefix or the host label.
- `*.localhost` resolves to loopback in modern browsers with zero setup — but **only on the
  machine running the browser against a local qits**. Remote access to cross-origin daemons
  needs a wildcard DNS record pointing at the qits host; the path-prefix mode keeps working
  remotely regardless.

### 2. Proxy-side picker injection (the machinery same-origin made unnecessary)

Cross-origin, `iframe.contentDocument` throws — our code must run *inside* the app's page
again. Since this mode exists precisely for apps we won't touch, the proxy injects it:

- A `ProxyInterceptor` on the cross-origin route rewrites **`text/html` responses only**:
  inject `<script src="{qitsOrigin}/qits-picker.js" data-qits-origin="{qitsOrigin}"></script>`
  into `<head>`, and strip `X-Frame-Options`/CSP `frame-ancestors` (headers and
  `<meta http-equiv>`) so the frame renders. Rewriting means buffering: strip
  `Accept-Encoding` upstream (or decompress), drop `Content-Length`/`Content-Encoding` after
  mutation. The verbatim-passthrough property is lost **on this route only** — the path-prefix
  route stays interceptor-free.
- vertx-http-proxy 4.5.x interceptors don't run on WebSocket upgrades — harmless here, since
  only HTML is mutated and the HMR socket needs no rewriting (no base path in this mode).
- `qits-picker.js` is a small framework-free static asset served by Quinoa from
  `service/src/main/webui/public/`. Cross-origin `<script src>` loads are not CORS-restricted.

### 3. Picker transport split in the frontend

The picker service gains a transport strategy behind its existing API, chosen per daemon mode:

- **Same-origin (unchanged):** direct `contentDocument` access.
- **Cross-origin (new):** the postMessage protocol — parent posts
  `{type:'qits-pick:enter'|'exit'}` to `iframe.contentWindow` (allowed cross-origin); the
  injected script validates `event.origin` against `data-qits-origin`, runs the same
  hover-overlay/click-capture logic in-page, and posts
  `{type:'qits-pick:result', payload:{outerHTML, selector, url, tag, textPreview}}` back. The
  parent validates the message origin against the daemon's subdomain origin. Downstream is
  untouched — results land in the same prompt-context store either way.
- Injection makes re-attach trivial in this mode: the script tag is re-served with every full
  reload, so only the parent's `enter` re-send hangs off the iframe `load` event.

### 4. Daemon definition: a mode field

`AbstractDaemonDefinition` gains `proxyMode` (enum `BASE_ALIGNED` default, `CROSS_ORIGIN`).
The supervisor skips `QITS_PUBLIC_BASE` injection for `CROSS_ORIGIN`; the DTO exposes the
subdomain URL instead of the relative base path, and the dialog binds whichever it gets.

## What this buys back

- **Base-incapable apps** (no `--base`/`--serve-path` equivalent, or serve-path bugs like
  angular-cli #29395) become frameable with zero app config.
- **Root-absolute runtime fetches** no longer leak into qits' `/api` — the app owns its whole
  origin.
- **Trust isolation:** the framed app no longer shares the qits origin, so it can't read qits
  storage or call qits `/api` with ambient credentials. This mode is the answer if an untrusted
  app ever needs framing — the same-origin path forecloses that by design.

## Costs and risks

- HTML-rewrite machinery (buffering, encoding fixups, CSP/meta stripping) on the cross-origin
  route — exactly the complexity the primary mode avoids; keep it off the path-prefix route.
- Remote access requires wildcard DNS; `*.localhost` is local-only.
- The postMessage protocol and its two-way origin validation return as code to maintain and
  test.
- Injection can still miss: apps serving HTML in unusual ways (streamed shells, service-worker
  rendered) may never pass a rewritable `text/html` body through the proxy.
- SSRF constraints carry over unchanged: keys (path or host label) resolve only through the
  registry; ports never come from the request; targets stay pinned to `127.0.0.1`.

## Trigger

Build this when the first real daemon can't be base-aligned, when an app's hard-coded
root-absolute calls collide with qits routes, or when an untrusted app needs framing. Until
then the mode field, the interceptor, and `qits-picker.js` all stay unwritten.

## Testing sketch

- **Proxy (`@QuarkusTest`):** a request with Host `{w}--{d}.daemon.localhost` reaches the same
  fixture server as the path-prefix form; HTML responses on the cross-origin route come back
  with the script tag injected, framing headers stripped, and correct lengths (gzip fixture
  included); non-HTML bodies pass through byte-identical; WebSocket echo still round-trips.
- **Picker script (fixture iframe or `playwright`/`chrome-devtools` MCP):** `enter` from the
  parent enables picking; a click posts a well-formed `qits-pick:result` to the trusted origin
  only; messages from foreign origins are ignored both directions; full reload re-arms via the
  re-served tag plus the parent's `load`-event `enter`.
- **Backend:** `proxyMode=CROSS_ORIGIN` suppresses `QITS_PUBLIC_BASE` in the spawned
  environment and flips the DTO to the subdomain URL.
