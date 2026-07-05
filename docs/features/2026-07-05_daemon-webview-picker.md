# Daemon web-view picker: proxy a daemon's app, pick DOM into the prompt

> **Status: implemented 2026-07-05.** This document was the design draft; the notes below record
> where the built feature diverged from it. Read this banner and the deltas before treating any
> detail here as current.
>
> **As-built deltas (what changed during implementation):**
> - **Proxy target is a published localhost port, not `127.0.0.1:{httpPort}` directly, and not a
>   container bridge IP.** Daemons run inside per-workspace docker containers (the workspace-containers
>   feature, which landed after this draft), so the dev-server port lives in the container's network
>   namespace. On this project's Docker Desktop/WSL2 host, container bridge IPs are *not*
>   host-reachable, but ports published with `docker run -p 127.0.0.1:0:<port>` are. So
>   `ContainerRuntime.run` publishes every `httpPort` the repo's daemon definitions declare (at
>   container-creation time — docker can't add ports to a live container), and `ContainerRuntime.hostPort`
>   resolves the ephemeral host port. The proxy targets `127.0.0.1:{hostPort}`. Because publishing is
>   create-time only, a daemon whose port was declared *after* its workspace container already existed
>   is not web-viewable until the container is recreated — surfaced as a WARNING daemon event, and
>   the proxy answers a "recreate the container" 502.
> - **The daemon definition entity is `RepositoryDaemon`, not `AbstractDaemonDefinition`** (the
>   mapped superclass was collapsed earlier). The new field is a nullable `Integer httpPort` on it,
>   threaded through the DTO/mapper/service/REST/MCP exactly like the `otel` boolean.
> - **`DaemonInstanceDto` carries a single nullable `proxyPath` field, not a separate flag + path.**
>   Its presence *is* the web-viewable flag (set iff `httpPort` is declared); the frontend combines
>   it with a live `status`.
> - **The supervisor exposes `proxyTarget(workspaceId, daemonId) → Optional<ProxyTarget{status, hostPort}>`**
>   as the proxy's only lookup seam. `DaemonProxyPath` is the shared source of truth for the
>   `/daemon/{workspaceId}/{daemonId}/` shape.
> - **`STARTING`/`RESTARTING` serve an auto-refreshing splash; `STOPPED`/`CRASHED` a branded 502**
>   (the draft's leaning, now decided).
> - **Floaty button lives on the workspace-detail page, not `main-layout`.** The layout has no route
>   context (repoId/workspaceId aren't available there) and the feature is only meaningful in a
>   workspace; the root-scoped prompt-context store still keeps picks alive across the dialog and
>   navigation, which was the actual goal.
> - **The fullscreen dialog uses `zCustomClasses` twMerge overrides, not a new ZardUI variant** —
>   ZardUI files are CLI-managed; `mergeClasses` (twMerge) lets the custom classes override the
>   dialog's centering classes.
> - **Startup convention gained `--host 0.0.0.0`**: the in-container dev server must bind all
>   interfaces, else the published port can't reach it (e.g. `vite --host 0.0.0.0 --base "$QITS_PUBLIC_BASE"`).
> - The browser-mode picker spec caught a real cross-realm bug: framed elements fail
>   `instanceof Element` against the parent window's constructor — the picker checks `nodeType`.
> - Two pre-existing bugs found while verifying are documented in `docs/issues/2026-07-05_*`
>   (dev-mode SPA deep-links 404; branch-tree screenshot baseline drift) — neither caused by this
>   feature.

## Introduction

Once [daemons](../features/2026-07-04_daemons.md) run the project's dev server, the rendered app is *right there* on a
loopback port — but invisible to the coding agent, which only ever sees source. This idea closes
that loop from the human side: a floaty button opens a full-screen dialog with an **iframe of the
daemon-served app**, plus a **DOM picker** — hover an element, click it, and its HTML lands in a
**prompt-context cache** that the existing prompt-entry flows draw from. "This button is
misaligned" stops being a description and becomes the actual `<button class="…">` handed to the
agent.

Two decisions shape this revision of the idea:

1. **The reverse proxy is a requirement, not a fallback.** Daemon ports are never individually
   exposed; the browser reaches every daemon **through the qits origin** via an in-process Vert.x
   proxy mounted on the Quarkus router. One port (qits' own) serves everything — no per-daemon
   firewall/forwarding, and remote access to qits transparently includes its daemons.
2. **No source edits, no injection.** The previous draft had the app load a cooperating picker
   script (manual `<script>` tag, postMessage back to qits). That entire apparatus is deleted by a
   side effect of decision 1: a path-prefix proxy makes the framed app **same-origin** with the
   qits UI, so the qits frontend can read `iframe.contentDocument` directly. The picker becomes
   plain Angular code in qits — nothing is injected anywhere, and the proxy never rewrites a byte.

The "we own both sides" realisation from the first draft survives, but applied at the right layer:
instead of adding our script to the user's app, qits injects a **base-path environment variable**
at daemon launch and the app's start script passes it to its dev server — so the app natively
serves itself under the proxied prefix and the proxy stays a dumb passthrough.

Related/dependent plans:

- Hard dependency on [daemons](../features/2026-07-04_daemons.md): the thing being framed is a daemon instance (a
  `CommandKind.DAEMON` registry command). This idea adds one field to the daemon definition
  (`httpPort`), uses the daemon environment-injection slot (the same one observability uses for
  `OTEL_EXPORTER_OTLP_*`) for `QITS_PUBLIC_BASE`, and leans on the singleton-per-(workspace,
  daemon) rule — the proxy route key requires that pair to be unambiguous.
- The captured HTML feeds the agent through the same door the
  [coding-agent harness](../features/2026-07-01_coding-agent-harness.md) and
  [stream-json chat](../features/2026-07-01_stream-json-chat.md) already use: the
  `speak-to-prompt` flow's `initialContext` (launch a new agent) and the command-chat `draft`
  (message a running one). The picker is an *input source* for prompts, not a new agent channel.
- Complements the [workspace chat dialog](../features/2026-07-04_workspace-chat-dialog.md):
  "pick this element" and "ask the agent about it" want to sit next to each other.
- Orthogonal to [observability](../features/2026-07-04_observability.md), but the same shape of idea — qits obtaining a
  view into a running app the source alone can't give. Neither requires the other.
- Parked follow-up:
  [daemon-proxy-cross-origin-mode](../backlog-ideas/daemon-proxy-cross-origin-mode.md) extends
  the proxy built here with a cross-origin subdomain mode + injected picker for base-incapable
  or untrusted apps.

## Architecture overview

```
browser ── qits:8080 /daemon/{workspaceId}/{daemonId}/*  (same origin as the qits UI)
              │  Vert.x HttpProxy (in-process, verbatim passthrough, WS included)
              ▼
          127.0.0.1:{httpPort}   dev server, launched with QITS_PUBLIC_BASE=/daemon/{…}/
                                 → emits every asset URL and its HMR websocket under the prefix
```

- The **proxy** forwards paths verbatim — no prefix stripping, no HTML rewriting, no header
  surgery. It can do that because the dev server itself serves under the prefix (base-path
  contract below).
- The **iframe** in the qits UI points at the *relative* path `/daemon/{…}/` — same origin, so the
  qits parent has full DOM access to the framed document.
- The **picker** is an Angular service/directive in qits operating directly on
  `iframe.contentDocument`. No script in the app, no postMessage protocol.

## Proxy routing shape: path-prefix + base-aligned passthrough

**Chosen: path-prefix `/daemon/{workspaceId}/{daemonDefinitionId}/*` on the qits origin.** The
same-origin property is what deletes the injection machinery, and a single origin/port works
unchanged for remote access (LAN, tunnel) — no DNS tricks.

Path-prefix proxying has one classic problem: dev servers emit root-absolute URLs (`/main.js`,
`/@vite/client`) that escape the prefix. The fix is the **base-path env contract** — the correct
application of "we control both sides":

- At launch, the daemon supervisor injects **`QITS_PUBLIC_BASE=/daemon/{workspaceId}/{daemonId}/`**
  into the process environment (same injection slot daemons.md plans for OTLP vars).
- The project's `startScript` opts in — a documented convention per stack, not per-framework magic
  in qits:
  - **Vite:** `vite --base "$QITS_PUBLIC_BASE"`. Verified: `base` applies in dev, and the HMR
    websocket path is derived from it (Vite's `clientInjections.ts` injects `hmrBase = devBase`),
    so assets *and* HMR stay inside the prefix.
  - **Angular:** `ng serve --serve-path "$QITS_PUBLIC_BASE" --base-href "$QITS_PUBLIC_BASE"`.
    Both flags: `--serve-path` alone doesn't set `<base href>` (angular-cli #7782); note the
    19.1.x regression where HMR requests ignored `--serve-path` (angular-cli #29395).
  - **webpack:** `devServer` / `output.publicPath` from the env var.
- The dev server then mounts everything — assets, SPA routes, HMR websocket — under the prefix,
  and the proxy forwards bytes untouched (compression and chunked transfer pass through dumb).

Alternatives considered:

- **Strip-prefix + HTML rewriting** (proxy strips `/daemon/{key}`, app thinks it's at `/`, proxy
  rewrites responses): rejected. Root-absolute and JS-constructed URLs escape the prefix *in the
  browser* — no proxy-side rewriting fixes what the browser requests — and the un-based HMR client
  opens its websocket at the qits root. Additionally, vertx-http-proxy 4.5.x interceptors don't
  run on WebSocket upgrades at all, so even the handshake path couldn't be rewritten.
- **Wildcard subdomain per daemon** (`{key}.qits.localhost:8080`): perfect fidelity with zero app
  config, but the frame becomes cross-origin again (the injected-script + postMessage picker
  returns), `*.localhost` only resolves on the local machine, and remote access needs wildcard
  DNS. Kept as the **deferred fallback** for apps that cannot serve under a base path.

## Proxy mechanics (verified against Quarkus 3 / Vert.x 4.5.x)

- **Dependency:** `io.vertx:vertx-http-proxy` — managed by the Quarkus platform BOM (4.5.26 under
  quarkus-bom 3.34.6), added version-less to `service/pom.xml`.
- **Mount:** the documented Quarkus pattern `void init(@Observes Router router)` (Vert.x reference
  guide); `router.route("/daemon/*").handler(rc -> proxy.handle(rc.request()))`, with the shared
  `HttpClient` created from the managed `Vertx`. Deliberately *not* under `/api` — it isn't REST.
  Add `/daemon` to `quarkus.quinoa.ignored-path-prefixes` (currently `/api,/mcp`).
- **Target resolution:** `HttpProxy.origin(OriginRequestProvider)` resolves the target per
  request: parse `{workspaceId}/{daemonId}` from the path → look up the running instance in the
  registry → `127.0.0.1:{httpPort}`. Unknown key → 404 without connecting anywhere; known but not
  running/`READY` → qits-branded 502.
- **WebSockets (HMR):** vertx-http-proxy forwards WebSocket upgrades **by default** ("The proxy
  supports WebSocket by default"); the inbound `Host` is replaced with the origin's on the
  handshake. Note `SameOriginUpgradeCheck` guards only websockets-next endpoints — this raw router
  route bypasses it (good: HMR upgrades aren't blocked; see Security for the flip side).
- **Host header:** rewrite the outbound authority to `127.0.0.1:{port}` on the HTTP leg too, so
  Vite's post-CVE-2025-24010 host checking never sees a foreign hostname even when qits itself is
  accessed remotely.
- **Niceties:** 302 from `/daemon/{workspaceId}/{daemonId}` to the trailing-slash form so relative
  URLs resolve correctly inside the frame.

## Route key and lifecycle

The route key is **`(workspaceId, daemonDefinitionId)` — not commandId.** The supervisor's restart
loop creates a *new `Command` row per relaunch* (daemons.md), so a commandId-keyed base path would
change on every crash-restart — invalidating the `QITS_PUBLIC_BASE` baked into the dev server's
emitted URLs at launch and breaking any open iframe. The (workspace, daemon) pair is stable across
restarts, known *before* launch (required — the base must be in the environment at spawn time),
and is exactly the pair daemons.md already leans toward making a singleton. The proxy strengthens
that lean: it needs the pair to be unambiguous.

The **port mapping lives in registry/supervisor runtime state**, next to the
`CommandSession`/`DaemonStatus` — consistent with the "registry is the only stateful singleton"
rule. The `OriginRequestProvider` resolves through the registry, never the definition directly, so
the deferred port-auto-allocation feature later changes only the supervisor, never the proxy.

## The picker: parent-side, no injection

Because the frame is same-origin, the picker is ordinary qits frontend code with full DOM access
to the framed document:

- **Mode toggle:** when pick mode is on, attach **capture-phase** `mousemove`/`click` listeners on
  `iframe.contentDocument`.
- **Hover overlay:** one absolutely-positioned `div` (high z-index, `pointer-events:none`,
  outline) repositioned via `target.getBoundingClientRect()` — placed inside the framed document
  or in the parent with the iframe's offset added. No per-element mutation, cheap.
- **Click capture:** capture-phase `click` → `preventDefault()` + `stopPropagation()` so the app
  doesn't react, then build the pick: `{outerHTML, selector, url, tag, textPreview}`, where
  `selector` is an nth-child chain up to the nearest `id`/`data-testid` and `url` is the framed
  document's `location.href`. When `element.shadowRoot` exists (open roots), include
  `shadowRoot.innerHTML` alongside the shallow `outerHTML`.
- **Lifecycle (the crux):** SPA navigations inside the frame keep the same `document`, so
  listeners survive. Full reloads (F5 in the frame, Vite full-reload HMR, `location` navigations)
  replace the document — the parent listens to the **iframe `load` event and re-attaches**. That
  single re-attach hook is the entire robustness story.
- **Failure mode:** if the frame navigates to a foreign origin (external link),
  `contentDocument` access throws — catch it and show "picker unavailable on external pages".
- **No `sandbox` attribute, by explicit decision:** without `allow-same-origin` the frame gets an
  opaque origin, killing both `contentDocument` (the picker) and the app's own storage; with
  `allow-same-origin` + `allow-scripts` on same-origin content the sandbox is neutralized anyway.

Retired from the first draft: `__qits_picker.js`, the `data-qits-origin` trust handshake, and the
whole postMessage protocol — all made redundant by same-origin access. Proxy-side `<head>` script
injection was also considered and is only ever needed for the *cross-origin* subdomain fallback;
it lives there (see Explicitly deferred), not in the primary path.

## Frontend (`service/src/main/webui/src/app/…`)

- **Floaty button** in `layout/main-layout/main-layout.component.ts` — the only always-mounted
  chrome — fixed bottom-right, `@ng-icons/lucide` (e.g. `lucideScan`). Rendered only when a
  running, web-viewable daemon exists for the context (a TanStack query; `@if` gate).
- **Full-screen dialog** via `ZardDialogService`. The ZardUI dialog is CDK-overlay based and
  centered by default (`dialog.variants.ts` hard-codes `left-[50%] top-[50%] translate-*`). Add a
  `fullscreen` size to the variant (`inset-0 h-full w-full max-w-none rounded-none` overriding the
  centering) through the ZardUI variant mechanism — not an ad-hoc component edit. The body hosts
  an `<iframe [src]="daemonBasePath()">` pointing at the **relative** `/daemon/{…}/` path — no
  daemon origin composition, no `httpPort` in the frontend at all — plus the pick-mode toggle, the
  picker attach/re-attach logic, and a thin snippet tray.
- **Prompt-context store** — new root `signalStore` at `shared/state/prompt-context.store.ts` (the
  repo's first `signalStore`; today only `signalState` is used in `branch-list`). Holds
  `PickedSnippet[]` (`{id, html, selector, url, tag, textPreview, capturedAt}`) with
  `add/remove/clear`. Root-scoped so the cache **outlives the dialog** — pick elements, close the
  frame, then use them. The store is the product; the consumers are thin:
  - `pattern/speech/speak-to-prompt.component.ts` — concatenate selected snippets into
    `initialContext` (prompt text + fenced ```html blocks) before launching the agent.
  - `pattern/command/command-chat.component.ts` — insert snippet HTML into the `draft` signal to
    message a running agent.

## Backend / daemon coupling

- Extend `AbstractDaemonDefinition` (mirrors
  `domain/…/featureflow/entity/AbstractActionDefinition.java` — public Panache fields) with a
  nullable **`Integer httpPort`** (+ optional `httpPath` later). Nullable cleanly means
  "web-viewable": the floaty button only lights up when it's set.
- The daemon supervisor injects **`QITS_PUBLIC_BASE`** into the environment at spawn and records
  `httpPort` in its runtime state for the proxy's origin resolver.
- The daemon/command DTO exposes a web-viewable flag and the **proxied base path**
  (`/daemon/{workspaceId}/{daemonId}/`), gated on the registry showing a running (`READY`)
  `CommandKind.DAEMON` instance — not a composed localhost URL.

## Security

1. **Same-origin means the daemon app's JS runs on the qits origin.** It can read qits
   `localStorage`/cookies and call `/api` with ambient credentials. Honest framing: qits already
   *executes these apps as processes with the user's full privileges* — browser-side origin
   sharing adds no new trust boundary for the user's own code. But it forecloses "frame an app you
   don't trust" forever on this path; an untrusted app would need the subdomain fallback.
2. **`sandbox` can't help here** (see the picker section) — omitted by explicit decision.
3. **SSRF shape.** The proxy is "qits fetches loopback URLs on behalf of the browser". Constrain
   it structurally: the origin resolver maps only registered, running daemon instances; the port
   comes from the registry, never from any request component; targets are hard-pinned to
   `127.0.0.1`; unknown keys 404 without connecting.
4. **Exposure surface.** Every daemon app becomes reachable to anyone who can reach qits:8080 —
   the same trust boundary as qits itself, but it now includes dev servers with their own dev
   endpoints (Vite's `/@fs/` can serve files outside the project when `server.fs` is
   misconfigured; CVE-2025-30208-class issues). One more reason the proxy routes only to *known*
   daemons. Also: `/daemon/*` bypasses `SameOriginUpgradeCheck` — if qits is ever networked with
   auth, this route needs the same guard as the rest.

## Risks and failure modes

1. **Web components / shadow DOM (highest).** `outerHTML` of a custom element is a shallow tag —
   useless for exactly the component-heavy apps this targets (Lit/Stencil). Mitigation: include
   `shadowRoot.innerHTML` for open roots (closed roots stay closed — true for every approach), and
   frame the feature as *"point the agent at this element,"* not *"clone this UI."*
2. **Hand-written root-absolute runtime URLs.** `base`/`serve-path` covers build-tool-emitted
   URLs, not app code doing `fetch('/api/users')` — that escapes the prefix and hits *qits'* own
   `/api`. Apps need relative URLs or a dev-proxy config; otherwise they're a case for the
   subdomain fallback.
3. **Base-incapable apps.** A dev server that can't serve under a sub-path (or a stack with a
   `--serve-path`-class bug like angular-cli #29395) breaks the base-aligned scheme → subdomain
   fallback.
4. **Foreign-origin navigation inside the frame** kills `contentDocument` access — degrade
   gracefully, don't crash the dialog.
5. **`outerHTML` fidelity.** Captured HTML carries dev-time hydration attributes and no scoped
   CSS/computed styles — it's a *structural pointer* for the agent, not a reproduction. A UI-copy
   framing to set, not a bug to fix.
6. **Selector brittleness.** nth-child chains drift across HMR re-renders; a `data-testid`-first
   path plus a text preview softens this, but a pick is a moment-in-time capture.

## Explicitly deferred

- **Wildcard-subdomain proxy mode** for apps that can't serve under a base path (or shouldn't
  share the qits origin) — full asset fidelity with zero app config, at the cost of a
  cross-origin frame and the retired injection/postMessage machinery. Written up as a change to
  this feature's implemented code in
  [backlog-ideas/daemon-proxy-cross-origin-mode](../backlog-ideas/daemon-proxy-cross-origin-mode.md).
- **Port collisions** — inherited limitation from the daemons feature; `httpPort` is hardcoded
  in the definition, so parallel workspaces running the same daemon collide. Planned resolution:
  [workspace containers](../features/2026-07-04_workspace-containers.md) — per-container network namespaces make the
  hardcoded port correct for every workspace, and the proxy's origin resolver (which already
  resolves through the registry precisely so this lands without touching it) targets the
  container's address instead of `127.0.0.1`.
- **In-page screenshots** attached to a pick — a CDP-side screenshot is the right later shape.
- **Backend snippet channel / MCP feed** — picks could reach the agent's MCP tools directly;
  the in-browser prompt-context store is enough for iteration one.

## Open questions

- **Key encoding** — raw UUIDs in the path (`/daemon/{workspaceId}/{daemonId}/`) are ugly but
  unambiguous; a short slug needs a uniqueness story. Lean: raw IDs first.
- **`STARTING` behavior** — proxy 502s until `READY`, or serve a qits-branded loading splash that
  auto-refreshes? Lean: splash — dev servers take seconds to boot and a blank 502 in the iframe
  is a bad first impression.
- **Vite host checking under remote access** — is rewriting the outbound authority to
  `127.0.0.1:{port}` sufficient everywhere, or should qits also inject an allowed-hosts env var
  (`--allowed-hosts "$QITS_ALLOWED_HOSTS"`) as part of the contract?
- **`httpPath` vs port only** — do any of our dev servers serve the app under their own sub-path
  on top of the base? Lean: port-only first, add `httpPath` when a case appears.

## Testing sketch

- **Proxy (`@QuarkusTest`):** spin up a trivial local HTTP server on a loopback port, register a
  fake running daemon instance for a (workspace, daemon) pair → requests to
  `/daemon/{w}/{d}/whatever` reach it verbatim (path unstripped) and stream back; unknown key →
  404 with no outbound connection; known-but-not-READY → 502; the target is never derivable from
  client input; a WebSocket echo through the proxy round-trips (HMR path).
- **Picker (frontend, or via the `playwright`/`chrome-devtools` MCP):** a fixture page in an
  iframe served same-origin; enter pick mode → hover shows the overlay, click yields the right
  `outerHTML`/`selector` and doesn't trigger the app's own handlers; full-reload the frame →
  picker re-attaches via the `load` event and still works; shadow-DOM fixture yields
  `shadowRoot.innerHTML`.
- **Store:** `add`/`remove`/`clear`; a snippet flows into `speak-to-prompt`'s `initialContext` and
  into `command-chat`'s `draft`.
- **Backend (`@QuarkusTest`):** a daemon definition with `httpPort` set surfaces the web-viewable
  flag + proxied base path on its DTO; without it, not web-viewable; the flag also requires a
  running `READY` `DAEMON` command in the registry; the spawned environment contains
  `QITS_PUBLIC_BASE` with the stable key.
- **Manual:** seed a repo with a web-viewable daemon running Vite via
  `vite --base "$QITS_PUBLIC_BASE"`; floaty button → dialog → iframe renders the live app through
  the proxy with working HMR → toggle pick → click a component → snippet in the tray → insert into
  a prompt → launch the agent and confirm `initialContext` carries the HTML.
