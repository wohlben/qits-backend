# Daemon web-view configuration: an explicit, overrideable target + entry path

> **Status: implemented 2026-07-06.** This document was the design draft; the notes below record
> where the built feature diverged from it. Verified end-to-end against `seed-webapp` (frame opens
> on the greeting screen, `POST api/greetings` 200 through the dev proxy, recreate affordance
> round-trip).
>
> **As-built deltas (what changed during implementation):**
> - **`--base-href` does not exist on `@angular/build:dev-server`** (Angular 21's esbuild dev
>   server; only `servePath` does), so the doc's suggested `ng serve --serve-path … --base-href …`
>   is impossible as written. The fixture instead ships a tiny **runtime `<base>` rebase** in
>   `index.html`: a head script matches `location.pathname` against `^/daemon/[^/]+/[^/]+/` and
>   rewrites `<base href>` before Angular bootstraps — router and base-relative fetches stay inside
>   the prefix. Verified live (assets, SPA deep-link fallback and the dev proxy all work under
>   `--serve-path`).
> - **The doc's "mirrors how `otel` hangs off the entity" was wrong in the letter** — `otel` is a
>   plain boolean column, not an embeddable. `WebView` is the entity's **first** `@Embeddable`;
>   the "all-null reads back as absent" semantics work as designed (covered by tests).
> - **Normalization:** `entryPath`/`basePath` are stored slash-less (`"/greeting/"` → `"greeting"`);
>   blank or `/` normalizes to null; backslashes, whitespace, empty segments and `..` are rejected
>   at definition time. The served base is always `DaemonProxyPath.servedBase(w, d, basePath)` =
>   prefix + `basePath + "/"` — one composition seam for `QITS_PUBLIC_BASE` and `proxyPath`.
> - **Update semantics:** REST's nested `WebViewInput`, when present, replaces both paths wholesale
>   (a null path in the block clears) while a null `port` carries the stored one over; an omitted
>   block keeps everything; `port <= 0` clears the whole config. The MCP flat args merge per-field
>   (`''` clears a path), as leaned. The DB column was renamed (`http_port` → `web_view_port`,
>   `V25__daemon_webview_config.sql`), as leaned.
> - **`DaemonInstanceDto` gained `needsContainerRecreate`** (true iff web-viewable ∧ live ∧ the
>   container doesn't publish the configured port). The workspace daemons panel renders the amber
>   "recreate container" affordance off it, wired to the **existing**
>   `stop-container`/`ensure-container` endpoints — no new backend surface.
> - **`seed-webapp`'s `readyPattern` changed** from Quarkus' "Listening on" to the Angular dev
>   server's readiness lines (`dev server is up|Application bundle generation complete|Local:.*:4200`)
>   — the frame targets :4200, so READY must mean *that* server answers.
> - The fixture change (new `src/main/webui/proxy.conf.js`, the `start` script flags, the
>   `index.html` rebase) landed as one commit on fixture `main`; `feature/greeting` was rebased on
>   top (still a clean fast-forward) and `feature/diverged` left untouched (still conflicts).
> - `SeedService`'s Python daemon demonstrates `entryPath = "hello.txt"`.
> - The repository daemon card shows a small `web view :4200 → /greeting` chip.

## Introduction

The [daemon web-view picker](2026-07-05_daemon-webview-picker.md) shipped the whole
machine — a Vert.x path-prefix proxy at `/daemon/{workspaceId}/{daemonId}/`, per-workspace port
publishing, the `QITS_PUBLIC_BASE` base-path contract, a same-origin iframe, and the DOM picker —
but it exposes exactly **one** knob on the daemon definition: a nullable `Integer httpPort`
(`RepositoryDaemon.httpPort`). "Web-viewable" is `httpPort != null`; the frame always opens at the
proxy root (`/daemon/{w}/{d}/`); and the two facts that actually determine whether the framed app
*renders* — which server the proxy points at, and that the dev server must serve itself under
`$QITS_PUBLIC_BASE` — are a single bare port plus an env-var convention buried inside the
`startScript`. The result in practice: you click **Web view**, the dialog and DOM picker work, but
the iframe shows a blank or asset-404'd page, because the one port you could set pointed at a
server whose base path never propagated to the SPA's assets.

This idea finalizes that UX by turning the bare `httpPort` into an **explicit, structured,
overrideable web-view configuration** on the daemon — *which* port to frame (defaulting to the
**frontend dev server**, overrideable to a single-origin backend), *where within the app* the
frame should land (an entry path, e.g. `greeting`), and *what base* the dev server serves under
(surfaced as real config instead of an implicit env convention) — all editable through the daemon
form, REST, and the **repository MCP server** so the coding agent can configure it too.

> This is a **modification of already-implemented code**, not a parallel design. Everything in the
> web-view picker feature exists; this changes the daemon definition's one `httpPort` field into a
> config block, the DTO/MCP/form that carry it, and the iframe `src` composition. The proxy route,
> the publishing seam, and the picker are untouched except where noted.

Related/dependent plans:

- **Modifies the [daemon web-view picker](2026-07-05_daemon-webview-picker.md)**
  directly: its `httpPort` field, its `DaemonInstanceDto.proxyPath`, its `QITS_PUBLIC_BASE`
  injection (`CommandService`), and its iframe `src` in `daemon-webview.component.ts`. That
  feature's own **open questions** — "`httpPath` vs port only," "`STARTING` behavior,"
  Vite host-checking under remote access — are the seams this idea resolves.
- **Hard dependency on [daemons](2026-07-04_daemons.md)** and
  [workspace containers](2026-07-04_workspace-containers.md): the target is a container
  port published at create time (`WorkspaceService.daemonPorts` → `-p 127.0.0.1:0:<port>`), so the
  create-time-publishing constraint carries over unchanged — see *Recreate-container friction*.
- **Converges with [daemon-healthchecks](../feature-ideas/daemon-healthchecks.md).** That idea notes the
  mvn+Quinoa daemon stands up *two* servers (Quarkus :8080, Angular :4200) and that one `httpPort`
  "isn't enough," with a deferred "per-port web-view" that frames a *healthy* HTTP check. This
  idea is the manual counterpart: an explicit `port` you choose. If both land, the web-view target
  can default to a healthy check's port; kept independent so either can ship first.
- **Exercised by the [servable quarkus-angular fixture](2026-07-05_servable-quarkus-angular-fixture.md)**
  and its `seed-webapp` daemon (`SeedWebappService`) — the reference case whose topology (Quarkus +
  Quinoa) is exactly what forces the "which port do we frame?" decision below.
- **Orthogonal to the [cross-origin backlog idea](../backlog-ideas/daemon-proxy-cross-origin-mode.md).**
  That adds a *second proxy mode* (subdomain + injected picker) for base-incapable/untrusted apps;
  this stays entirely within the base-aligned path-prefix mode and just makes its configuration
  explicit. A daemon's `proxyMode` (if that backlog lands) sits alongside this config block.

## The problem, concretely

`seed-webapp` seeds one daemon, `Quarkus dev server`, with `httpPort = 8080` and a `startScript`
that runs `./mvnw quarkus:dev -Dquarkus.http.port=8080 -Dquarkus.http.root-path="${QITS_PUBLIC_BASE:-/}"`.
Quinoa in dev mode spawns the Angular dev server on `:4200` and the browser talks to the single
Quarkus origin on `:8080`. Four things are wrong or unfinished:

1. **The framed target is the fragile one.** Pointing the proxy at `:8080` (Quarkus) means the
   Angular *assets* are served by `ng serve` behind Quinoa, and `quarkus.http.root-path` does not
   reliably propagate a `<base href>` prefix down to those assets. So `index.html` loads under the
   proxy prefix, its `/main.js` requests escape the prefix, and the frame renders blank. The
   **frontend dev server** (`:4200`) is the one that natively honours a base (`--base` /
   `--serve-path`) for *both* assets and HMR — so it should be the default target.
2. **One bare port, no override.** There is no way to say "frame :4200, not :8080," short of
   editing the port and hoping. The choice of which server to frame is a real, per-app decision
   (frontend-dev-server vs. single-origin backend) with no field to hold it.
3. **The base is a hidden convention.** That the dev server *must* bind `0.0.0.0` and serve under
   `$QITS_PUBLIC_BASE` lives only in a form hint (`daemon-form.component.ts:101`) and inside the
   `startScript` string. Nothing surfaces it as configuration or validates it.
4. **The frame always opens at `/`.** `frameSrc = proxyPath` (`daemon-webview.component.ts:173`).
   There is no way to land the frame on the screen you care about (the fixture's `greeting` view);
   you open the app root and navigate by hand every time.

## The model: a `WebView` config block on the daemon definition

Replace `RepositoryDaemon.httpPort` (the single `Integer` column) with a nullable `@Embeddable
WebView` — present ⇒ web-viewable, absent (all-null) ⇒ not — mirroring how `otel` and the
`observers`/`sources` collections already hang off the entity:

```java
@Embeddable
public class WebView {
  /** Container-loopback port the proxy targets. Point this at your FRONTEND dev server. */
  @Column(name = "web_view_port")
  public Integer port;

  /** Route the frame opens AT, below the served base. Default "/". e.g. "greeting". */
  @Column(name = "web_view_entry_path")
  public String entryPath;

  /** Advanced: extra sub-path the app pins on top of the proxy prefix (rare). Default empty. */
  @Column(name = "web_view_base_path")
  public String basePath;
}
```

Mapped onto `RepositoryDaemon` as `@Embedded WebView webView` (nullable — Hibernate treats an
all-null embeddable as absent, so `webView.port == null` ⇒ not web-viewable, preserving today's
`httpPort != null` semantics exactly). Migration `V##__daemon_webview_config.sql` renames
`repository_daemon.http_port` → `web_view_port` and adds `web_view_entry_path` /
`web_view_base_path`. Validated at definition time by extending `DaemonDefinitionValidator`
(`requireValidHttpPort` → `requireValidWebView`): port `1..65535`; `entryPath`/`basePath` are
normalized to a leading-slashed, non-`..` path or rejected — so a broken value fails the *request*,
not the proxy.

Three orthogonal knobs, each with a sensible default and each overrideable — which is exactly the
shape asked for:

| Field | Default | Override example | Effect |
|---|---|---|---|
| `port` | *(required to be web-viewable; the form/seed suggest the frontend dev-server port)* | `4200` → `8080` | which container port the proxy forwards to |
| `entryPath` | `/` | `greeting` | the frame opens at `…/greeting` instead of the app root |
| `basePath` | *(empty)* | `app` | the dev server serves under `…/app/`; `$QITS_PUBLIC_BASE` includes it |

## Proxy target: frontend dev server (default) vs. backend origin (override)

The single decision this feature exists to make explicit. **`port` is the override; the default
guidance is the frontend dev server.** Both topologies keep the base-aligned path-prefix proxy and
the verbatim passthrough — the only difference is *what proxies the app's `/api` calls back to the
backend*.

**Frontend dev server (default, recommended).** Point `port` at the SPA dev server (`:4200`),
launched under the base (`vite --base "$QITS_PUBLIC_BASE"` or
`ng serve --serve-path "$QITS_PUBLIC_BASE" --base-href "$QITS_PUBLIC_BASE"`, both `--host 0.0.0.0`).
Assets *and* HMR natively sit under the prefix — the frame renders and hot-reloads faithfully. The
cost: the SPA's own API calls (`fetch('api/…')`) hit the dev server, so the dev server needs a
**dev proxy** forwarding the API to the backend (Vite `server.proxy`, Angular `--proxy-config`).

```
browser ── qits /daemon/{w}/{d}/*  ──▶  :4200  (vite/ng serve, --base=$QITS_PUBLIC_BASE, 0.0.0.0)
                                           └── dev-proxy /…/api ──▶ :8080 (backend)
```

**Backend origin (override).** Point `port` at a single-origin backend (`:8080`) that itself
serves the SPA (Quinoa, SSR, a static bundle). No app-side dev proxy needed. The cost is the base
propagation of point 1 — the backend must genuinely emit the SPA's `<base href>` and asset URLs
under `$QITS_PUBLIC_BASE`, which Quinoa+`root-path` does not do cleanly today. Use this only when
the backend owns the whole origin and honours the base.

```
browser ── qits /daemon/{w}/{d}/*  ──▶  :8080  (backend serves API + SPA under $QITS_PUBLIC_BASE)
```

The `OriginRequestProvider`/`DaemonSupervisor.proxyTarget` resolution is unchanged — it already
targets `127.0.0.1:{hostPort}` for *the port the config declares*; this feature only changes which
port that is and documents the two shapes. **Lean:** default and seed to the frontend dev server;
keep the backend-origin path a first-class override for single-origin apps.

## The base contract, surfaced (not buried)

`$QITS_PUBLIC_BASE` stops being an implicit convention and becomes derived, visible config:

- `QITS_PUBLIC_BASE` (injected by `CommandService`, unchanged mechanism) is always
  `DaemonProxyPath.base(w,d)` (`/daemon/{w}/{d}/`) **plus `webView.basePath`** when set. The
  invariant holds: the dev server serves under exactly the path the proxy exposes it at, so
  passthrough stays byte-verbatim.
- `DaemonInstanceDto.proxyPath` becomes that served base (prefix + `basePath`) — still the
  web-viewable flag (present iff `webView.port != null`).
- The daemon form shows the resolved `$QITS_PUBLIC_BASE` read-only next to the port field, with the
  existing "must bind 0.0.0.0 and serve under $QITS_PUBLIC_BASE" hint promoted from buried text to a
  labelled contract. `basePath` is the advanced escape hatch for an app that pins its own sub-path
  (the deferred `httpPath` from the picker's open questions) — empty for every current case.

## Entry path: land the frame on the right screen

`webView.entryPath` (default `/`) is the route the iframe opens at. The frame `src` becomes
`proxyPath + entryPath` (normalized, single-slash-joined) instead of bare `proxyPath`:

- Fixture: `entryPath = "greeting"` → the frame opens at `/daemon/{w}/{d}/greeting`, straight on the
  greeting screen the demo is about, instead of the app root.
- It is a *starting* location only — SPA navigation inside the frame is unaffected, the DOM picker
  and its re-attach-on-`load` hook are unchanged.
- Because it is same-origin under the prefix, a client-side deep link works (subject to the app's
  own router). This is the daemon-app analogue of the qits deep-link caveat
  ([Quinoa dev deep-link 404](../../CLAUDE.md)); if an app hard-404s deep links in dev, leave
  `entryPath` at `/` — hence the default.

## DTO / REST / MCP surface

- **DTO.** `RepositoryDaemonDto` swaps `Integer httpPort` for a nested `WebViewDto webView`
  (`{port, entryPath, basePath}`, nullable), mapped by `RepositoryDaemonMapper` (MapStruct — never
  hand-written). `DaemonInstanceDto` keeps `proxyPath` (now = served base) as the web-viewable
  flag; the frame URL is composed frontend-side from `proxyPath` + `daemon.webView.entryPath`.
- **REST.** No new endpoints. `RepositoryDaemonController`'s `CreateRepositoryDaemonRequest` /
  `UpdateRepositoryDaemonRequest` replace the flat `Integer httpPort` with a nested `WebViewInput`
  (sibling of `LogObserverInput`/`LogSourceInput`); `WorkspaceDaemonController`'s existing GET
  already returns `DaemonInstanceDto`. Regenerate `docs/openapi.yml` (`OpenApiSchemaExportTest`) +
  `pnpm generate:api`.
- **MCP** (`DaemonMcpTools`, repository server). `createDaemon`/`updateDaemon` replace the flat
  `httpPort` `@ToolArg` with structured web-view args — `webViewPort` (0/null clears ⇒ not
  web-viewable, matching today's semantics), `webViewEntryPath`, `webViewBasePath` — each with a
  description spelling out the frontend-dev-server default and the base contract, so the agent can
  make a daemon web-viewable *and land it on the right screen* in one call. `RepositoryMcpToolsTest`
  updates its tool-surface pin; `DaemonMcpToolsTest` covers the round-trip.

## UI: the visible part

- **Daemon form** (`repository-daemon-create-update-form.component.ts` /
  `ui/forms/daemon/daemon-form.component.ts`) gains a **Web view** section: a port field (labelled
  "Frontend dev-server port" with helper text on the frontend-vs-backend choice), an entry-path
  field, an advanced-collapsed base-path field, and the read-only resolved `$QITS_PUBLIC_BASE` +
  the 0.0.0.0/base contract hint promoted to a proper labelled note. `repository-daemon-card`
  shows a small "web view :4200 → /greeting" summary chip.
- **Web-view dialog** (`daemon-webview.component.ts`): `frameSrc` composes `proxyPath` +
  `entryPath` (still `bypassSecurityTrustResourceUrl`, still backend-provided registry state, never
  user input in the URL). Everything else — the daemon `<select>`, pick mode, the DOM picker — is
  untouched.

### Recreate-container friction (finalize the signal)

> **Superseded 2026-07-07.** This whole constraint is gone — see
> [qits-net devcontainer unification](2026-07-07_qits-net-devcontainer-unification.md). qits and the
> workspace container now share a Docker network and the proxy reaches the port by the container's
> DNS name, so there is no create-time port set: a `webView.port` configured at any time is reachable
> the moment the daemon runs. The `needsContainerRecreate` flag, the amber banner, the WARNING event
> and the 502 described below were all removed. The paragraph is kept for history.

Publishing is create-time only (`ContainerRuntime.run` takes the port set at `docker run`; docker
can't add ports live), so changing `webView.port` — or adding web-view to a daemon — after the
workspace container exists means the port isn't published until recreation. Today that surfaces
lazily as a WARNING daemon event and a 502 in the frame. Finalizing the UX: when the form/MCP sets
a port that the workspace's live container doesn't publish, surface an explicit, actionable
"recreate container to enable web view" affordance in the workspace daemons panel (the recreate
path already exists), instead of only a 502 after the fact. No change to the publish mechanism — a
change to how its one real constraint is *communicated*.

## Seed / fixture

`seed-webapp`'s `Quarkus dev server` daemon becomes the reference example of the **frontend
dev-server** default:

- `webView.port = 4200`, `webView.entryPath = "greeting"`, `basePath` empty.
- Its `startScript` runs the Angular dev server under the base with a dev proxy for the API — e.g.
  `ng serve --host 0.0.0.0 --serve-path "$QITS_PUBLIC_BASE" --base-href "$QITS_PUBLIC_BASE"
  --proxy-config proxy.conf.js` (the fixture gains a `proxy.conf.js` mapping `…/api` → `:8080`),
  alongside the Quarkus API. This is the fixture change that makes the frame actually render and its
  `POST api/greetings` reach the backend.
- `seed` (the tiny testing-repo static demo) keeps its single-port web-view but gains an explicit
  `entryPath` to demonstrate the field.

The demo payoff: `seed-webapp`, open the workspace, start the daemon, click **Web view** → the
frame opens **on the greeting screen**, HMR live, the DOM picker working — the experience the
picker feature was reaching for.

## Security

Unchanged from the picker feature — same-origin sharing, SSRF constraints (keys resolve only
through the registry, ports never from the request, targets pinned to `127.0.0.1`), and the
`/daemon/*` route bypassing `SameOriginUpgradeCheck`. This feature adds no new client-controlled
input to the proxy path: `entryPath`/`basePath` are validated definition config, composed into the
*frame src* the browser navigates to, never into the proxy's origin resolution.

## Explicitly deferred

- **Auto-detecting the frontend port.** qits can't know a daemon spawns `:4200` without being told;
  `port` stays explicitly configured. A future convergence with
  [daemon-healthchecks](../feature-ideas/daemon-healthchecks.md) could default the target to a healthy HTTP check's
  port — noted there as "per-port web-view," kept out of scope here.
- **Multiple web-views per daemon.** One `WebView` block per daemon (singular). Framing both
  Quarkus and Angular from one daemon is the healthchecks doc's per-port convergence, deferred with
  it.
- **`basePath` beyond the escape hatch.** Shipped as a field but expected empty; a real app pinning
  its own sub-path is the first case that exercises it.
- **Cross-origin mode's `proxyMode`** — the [cross-origin backlog idea](../backlog-ideas/daemon-proxy-cross-origin-mode.md)
  adds a mode field that would sit beside this config block; unbuilt until a base-incapable app
  appears.
- **Validating that the `startScript` honours `$QITS_PUBLIC_BASE`/binds 0.0.0.0** — still a
  documented contract, not machine-checked; a preflight probe (does the served base return non-404?)
  is a natural later add, overlapping healthchecks.

## Open questions

- **Flat vs. structured MCP args.** `webViewPort`/`webViewEntryPath`/`webViewBasePath` (flat,
  mirrors today's `httpPort`/`otel`) vs. a single `webView` object arg (mirrors the structured
  `observers`/`sources`). Lean: flat, since the fields are scalar and `0` already means "clear" for
  the existing `httpPort` MCP arg.
- **Keep or rename the DB column.** Rename `http_port` → `web_view_port` for clarity (a cheap
  prototype migration) vs. keep `http_port` and only add columns. Lean: rename — the embeddable
  reads best with a consistent `web_view_*` prefix.
- **`entryPath` default when the app 404s deep links.** `/` is the safe default; a per-app opt-in
  to a deep link is what `entryPath` is for. Confirm the fixture's Angular router serves
  `/greeting` as a deep link under the base before seeding it (else seed `entryPath = "/"`).
- **Frontend-default vs. Quinoa reality.** The recommended default (frame the frontend dev server)
  needs the fixture to run `ng serve` with a dev proxy rather than lean on Quinoa's reverse
  proxying. Confirm the `--proxy-config` path-rewrite works under `--serve-path` before committing
  the seed to `:4200`; fall back to documenting `:8080` as the seed if not.

## Testing sketch

- **Entity/service/validator (domain):** `WebView` round-trips through
  `RepositoryDaemonService.create`/`update` incl. `entryPath`/`basePath`; `requireValidWebView`
  rejects bad port / non-normalized path / `..`; clearing the port (0/null) drops web-viewability;
  the all-null embeddable reads back as absent.
- **`CommandServiceTest`:** `QITS_PUBLIC_BASE` equals `/daemon/{w}/{d}/` when `basePath` empty and
  `/daemon/{w}/{d}/{basePath}/` when set; absent when the daemon isn't web-viewable — extending the
  existing `QITS_PUBLIC_BASE` assertions.
- **`DaemonSupervisor`/proxy:** `proxyTarget` resolves to the configured `port`'s host port;
  `proxyPath` reflects `basePath`; unknown/not-published port still 502s with the recreate message.
- **Controller/MCP:** CRUD round-trip incl. the nested web-view (validation, cross-repo ownership);
  `DaemonMcpToolsTest` define→list→edit with web-view args; `RepositoryMcpToolsTest` surface pin;
  `OpenApiSchemaExportTest` regenerates `openapi.yml`.
- **Frontend:** `daemon-webview.component.spec.ts` — `frameSrc` composes `proxyPath + entryPath`
  (and stays `proxyPath` when `entryPath` is `/`); form spec adds/edits the web-view section.
- **Manual (packaged app, docker):** `seed-webapp` → start the daemon → **Web view** opens on
  `/greeting`, assets + HMR live, `POST api/greetings` returns 200 through the dev proxy; edit the
  port to a not-published value → recreate-container affordance appears; recreate → frame renders.
