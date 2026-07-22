# Epic: qits-ingress — qits as the central request hub that receives and delegates

## Introduction

qits already **is** the thing every request arrives at, but it dispatches them through a
**distributed, unnamed entry surface**: one global auth gate (`QitsAuthPolicy`) sits ahead of
everything, and behind it dispatch is scattered across the JAX-RS `/api` tree, three MCP roots
(`/mcp/*`), two raw Vert.x routes (`/git/*`, `/daemon/*`), and Quinoa's SPA/static serving. The
list of backend prefixes is duplicated in three unrelated places (`PublicPaths.isPublic`,
`quarkus.quinoa.ignored-path-prefixes`, `quarkus.otel.traces.suppress-application-uris`), and the
only two things qits can *reach into* a workspace for are a daemon's web view (`DaemonProxyRoute`)
and nothing else.

This epic makes the hub **explicit and central**: qits becomes the single addressable front door
that **receives all inbound traffic and delegates to the right internal component** — whether that
component is an in-process handler, a workspace container on `qits-net`, or a future split-out
sibling server (artifacts, telemetry). The thesis is that **qits fundamentally orchestrates
communication across its components**, so the routing hub belongs *inside* qits, built from
machinery it already runs, rather than bolted on as an external reverse proxy (Traefik/nginx)
configured statically or dynamically. Every new component we add otherwise grows the tech stack;
an internal ingress keeps the front door in the app that already owns the addressing model
(`QitsHostResolver`, `qits-net`, `ContainerRuntime.resolveTarget`).

### This is a generalization, not a new component

qits **already receives-and-relays in two places** — the whole point of doing this in-app is that
the mechanism exists and is proven:

- **Reverse proxy into containers** — `DaemonProxyRoute`
  (`service/src/main/java/eu/wohlben/qits/daemonproxy/DaemonProxyRoute.java`) owns `/daemon/*`, a
  raw Vert.x route registered via `@Observes Router`. It resolves the target **only** from
  supervisor state (`DaemonSupervisor.proxyTarget` → `ProxyOrigin`, never from the request — an
  SSRF guard), then `HttpProxy.reverseProxy(...).origin(port, host)` streams verbatim to the
  container's DNS name on `qits-net`, rewriting only the `Host` header. This is exactly the
  "receive on a qits path, resolve a target, proxy" shape the whole hub generalizes.
- **Byte-verbatim telemetry forwarding** — `OtelForwarder`
  (`service/src/main/java/eu/wohlben/qits/domain/telemetry/api/OtelForwarder.java`): the OTLP
  receiver ingests a signal and **tees it byte-verbatim to a parent qits** (`OTEL_EXPORTER_OTLP_ENDPOINT`,
  fire-and-forget, gzip/Content-Type passed through) when qits runs as a managed daemon. qits is
  already a telemetry relay across the stack — this epic names that pattern and extends it.

The addressing substrate is also already built: `QitsHostResolver.qitsHost()` (how containers dial
qits — `qits` alias on `qits-net`, else `host.docker.internal`/WSL2 LAN IP) and its sibling
`ContainerRuntime.resolveTarget` → `ProxyOrigin` (how qits reaches a container — DNS name + real
port, no host publishing). The hub is the missing *inbound* half of a resolver pair whose
*outbound* half exists.

### Builds on / cross-cutting concerns

- **Builds on [qits-workspaces](../qits-workspaces/epic.md)** — the container model, lazy
  provisioning, the `ContainerRuntime` seam, the shared `qits-net`, and DNS-name addressing with no
  host-port publishing are what the hub routes *to*. "Workspaces need to become addressable anyway"
  (this epic's Part 2) is the direct extension of the container reachability model already in place.
- **Generalizes [qits-workspace-daemons](../qits-workspace-daemons/epic.md) / the daemon web view** —
  `DaemonProxyRoute` is the one existing container-reverse-proxy and the template for generalized
  workspace addressability. Its SSRF-safe supervisor-only origin resolution is the security model
  the hub keeps.
- **Complements — does not contradict — the standalone-service splits**
  ([standalone-artifacts-service](../qits-artifacts/feature-ideas/standalone-artifacts-service.md),
  [standalone-telemetry-service](../qits-observability/feature-ideas/standalone-telemetry-service.md)):
  those epics pull artifacts/telemetry out of `service` into **their own processes**, and each
  raises the same open questions — *"one deployable or two?"*, *cross-origin CORS for the SPA/diff
  UI*, *a public surface with no `QitsAuthPolicy`*. **An internal ingress is the answer to all
  three**: external clients keep hitting **one origin** (the qits front door), which fans
  `/api/artifacts` and `/api/otel` to the split-out siblings on `qits-net` internally. The split
  becomes a **deployment-topology change invisible to callers** — no new host:port for the SPA to
  reach cross-origin, no per-service auth story exposed to the edge. Part 3 below is precisely this.
- **Subsumes the edge from [build-variant-auth](../qits-authentication/features/2026-07-16_build-variant-auth.md)** —
  the `forwardauth` variant assumes an **external** reverse proxy in front of qits that terminates
  TLS, performs auth, and injects trusted headers. **This epic decides qits-ingress subsumes that
  edge** (Part 4): qits becomes the public front door itself — it terminates TLS and performs the
  authentication the external proxy used to, so a standard deployment needs **no** external reverse
  proxy at all. The consequence is real and named below: the `forwardauth` variant's whole premise
  ("trust an upstream proxy") inverts — it degrades to a *compatibility* mode for deployments that
  still choose to front qits, while the default posture becomes **qits owns the edge**.
- **Relates to [qits-tokens](../qits-tokens/feature-ideas/scoped-tokens.md)** — a central hub is the
  natural chokepoint to mint/scope the per-caller tokens that today are a single shared secret
  (`qits.artifacts.token`) and the `PublicPaths` allowlist.

## Motivation

**One front door beats an external proxy we'd have to configure.** The alternative to an in-app hub
is an external reverse proxy (Traefik/nginx) configured either statically (a config file we
maintain in lockstep with every route qits adds) or dynamically (a control loop that watches qits
and rewrites proxy config as workspaces come and go). Both add a component to the stack, and the
dynamic one **re-implements state qits already holds** — which workspace/daemon exists, what its
container DNS name and port are (`DaemonSupervisor` + `ContainerRuntime.resolveTarget`), whether
it's `READY`. qits is the source of truth for its own topology; the router that consumes that truth
should not be a second process that has to be told about it.

**Workspaces have to become addressable regardless.** Right now only a daemon's web view is
reachable from outside the container, and only through the one hard-coded `/daemon/*` shape. As the
product grows (per-workspace services, multiple ports, direct API reach into a running app), "reach
workspace W's port P" becomes a first-class need. Building that as a general, SSRF-safe addressing
scheme *through qits* — rather than N more one-off routes or N published host ports — is cheaper the
earlier it's named, and it reuses `DaemonProxyRoute`'s exact security model.

**The dispatch surface is already distributed and duplicated — naming it prevents drift.** The
canonical backend-prefix list lives in three places that must be kept in sync by hand
(`PublicPaths.java`, `application.properties:201` Quinoa ignores, `application.properties:151` OTel
suppress). Every new backend prefix is three edits and a chance to forget one (a missed Quinoa
ignore serves the SPA over a backend route; a missed OTel suppress spams traces). A single ingress
registry is the source of truth those three consume.

**It de-risks the splits without committing to them.** The artifacts/telemetry split epics are
gated on triggers that may or may not fire. An ingress that can front an internal sibling means the
day a split lands, it's a config re-point, not an external-surface redesign — and the "one
deployable or two" tension dissolves, because from outside it's always one.

## Deliverable & staging

Like [qits-workspace-daemon](../qits-workspace-daemon/epic.md), this is **deliberately staged** and
mostly **not in scope yet** — the first part is a behavior-preserving "name the thing," and each
later part is its own feature-idea. Parts 1–3 preserve the wire contract for existing clients; Part
4 (edge subsumption) is the one deliberate behavior change and lands last.

### Part 1 — Name and unify the dispatch surface *(behavior-preserving)*

Make the implicit ingress explicit. Introduce a single **route/prefix registry** (the source of
truth for the backend prefixes `/api`, `/mcp/*`, `/git/*`, `/daemon/*`, and the SPA fallthrough)
that `PublicPaths`, `quarkus.quinoa.ignored-path-prefixes`, and the OTel suppress list all derive
from instead of re-declaring. Document the router-order map (capture-CORS 500, Quinoa dev proxy
1100, REST 1500, SPA fallback 9000, static 10000) as *the* ingress model, with `QitsAuthPolicy` as
the one global gate every route passes. No new routes, no behavior change — this is the prep that
makes Parts 2–3 safe.

### Part 2 — Generalized, SSRF-safe workspace addressability

Lift `DaemonProxyRoute` from "daemon web views only" to a general **"reach workspace W's service"**
scheme: a predictable path (e.g. `/ws/{workspaceId}/{port|named-service}/*`) or subdomain, resolving
the origin **only** from qits-held state (the `DaemonSupervisor`/`ContainerRuntime` addressing pair,
never the request — keeping the SSRF guard), reusing the existing `HttpProxy` reverse-proxy plumbing
and `Host`-rewrite interceptor. Workspaces become addressable through the hub without publishing a
single host port. Auth for these paths goes through `QitsAuthPolicy` (they are **not** on the
container-only `PublicPaths` allowlist).

### Part 3 — Front the split-out siblings

When (if) artifacts and/or telemetry split into their own processes, the hub **fans their public
paths to the internal sibling** on `qits-net` (`/api/artifacts` → `qits-artifacts:<port>`,
`/api/otel` → `qits-telemetry:<port>`) instead of external clients reaching new host:ports. Resolves
the cross-origin/CORS and "one deployable or two" open questions in both split docs — the external
origin stays singular. Depends on at least one split actually landing; until then this part is a
design placeholder that keeps the two split epics honest about their edge story.

### Part 4 — Subsume the edge (qits owns the public front door)

Fold the external reverse proxy inward so qits *is* the edge, not something sitting behind one:

- **TLS termination in-app.** qits' own HTTP server terminates TLS (`quarkus.http.ssl.*`), with a
  cert-provisioning story (mounted certs and/or ACME) documented in the deployment guide. This is
  **new operational surface** for the app and the single biggest cost of the subsume decision — named
  honestly in the open questions.
- **Edge authentication folds in.** The authentication the external forward-auth proxy performed
  moves into qits behind the one global gate that already fronts every route, `QitsAuthPolicy`
  (`auth/core/.../QitsAuthPolicy.java`). In practice this means the **`oidc` variant becomes the
  edge-auth path** (qits does the OIDC/login itself), and the `forwardauth` variant degrades to a
  compatibility mode for installs that still choose to front qits with a trusted proxy. The
  `PublicPaths` allowlist (the container-only, token-free surfaces reached directly on `qits-net`)
  is unchanged — those are *internal* callers on the shared network, not the public edge.
- **Deployment simplification.** `docker-compose.prod.yml` / the Dokploy overlay drop the external
  reverse-proxy service; qits is the sole published listener. The deployment guide's edge section is
  rewritten around qits-owns-the-edge, with the fronted-proxy topology kept as the documented
  compatibility path.

This part is a **behavior change at the edge** and the most opinionated slice — it is the payoff of
the "one central hub for all requests" framing, but it also inverts an existing variant's premise,
so it lands last and deliberately.

### Status

Draft — **no parts implemented**. Part 1 is the natural first slice (pure consolidation, unblocks
the rest). Parts 2 and 3 are independent of each other; Part 3 is gated on a split epic firing.
Part 4 (edge subsumption) is the largest and most opinionated, lands last, and is what makes qits
the *complete* front door rather than only the internal dispatcher.

## Open questions

- **Name: `qits-ingress` vs `qits-proxy`.** Chosen `qits-ingress` — the deliverable is the single
  *front door that receives and routes*; proxying is one mechanism it uses (alongside in-process
  dispatch and the OTLP tee). `qits-proxy` undersells the in-process-dispatch and registry halves.
  Rename the dir if you prefer the other framing.
- **~~Behind vs subsume the edge~~ → DECIDED: subsume (Part 4).** qits owns the whole front door —
  terminates TLS, performs edge auth, no external reverse proxy in a standard deploy. The
  consequences this creates, now the open questions:
  - **TLS/cert lifecycle in-app.** Terminating TLS makes qits responsible for certs — mounted PEMs
    vs built-in ACME (`quarkus-tls-registry` / Let's Encrypt), renewal, and the HTTP→HTTPS redirect.
    This is the real cost of subsuming; an external proxy did it for free. Confirm Quarkus' TLS
    story is enough or whether a thin ACME sidecar creeps the stack back (which would partly defeat
    the "no new component" thesis for TLS specifically).
  - **`forwardauth` variant's inverted premise.** Its reason to exist ("trust an upstream proxy's
    headers") no longer describes the default topology. Does it stay as a documented compatibility
    mode, or does subsuming the edge make `oidc` the only first-class variant and `forwardauth`
    legacy? Decide before Part 4 so the variant matrix and its enforcer messaging stay coherent.
  - **Does subsuming the edge contradict "no new components"?** The thesis is about not adding a
    *routing/dispatch* component. TLS + edge auth is arguably edge infrastructure qits now *absorbs*
    rather than adds — but if it drags in ACME tooling or a session store, re-test the thesis against
    that specific surface rather than assuming it holds.
- **Addressing scheme for Part 2: path prefix vs subdomain.** `/ws/{id}/{port}/*` is simplest and
  matches `/daemon/*`, but path-based proxying breaks apps with absolute-root asset URLs (the reason
  `DaemonProxyRoute` rewrites `Host` and 302s bare paths to trailing-slash). Per-workspace subdomains
  (`{id}.ws.qits…`) sidestep that but need wildcard DNS/TLS at the edge — which reopens the
  external-edge question. Lean: path-based first (reuses the proven `DaemonProxyRoute` handling),
  revisit subdomains if absolute-URL apps make it painful.
- **Does this contradict the split epics?** No — it's the counterweight that makes them safe (see
  cross-cutting). But it does mean the splits should *assume* an internal ingress rather than plan
  their own cross-origin CORS. If this epic is adopted, the "CORS / same-origin" open questions in
  both split docs are answered here instead of there — note that in those docs when this lands.
- **`max-body-size` still shared in-process.** Fronting a split artifacts/telemetry via the hub means
  the **proxy leg** in `service` still receives the large body before streaming it on — so qits'
  global `quarkus.http.limits.max-body-size` ceiling still applies on the way through unless the hub
  streams without buffering and is exempted. This interacts with
  [the shared-max-body-size DoS issue](../../issues/2026-07-19_artifacts-global-max-body-size-widens-public-ingest-dos.md):
  a naive proxy-through does **not** free `service` from the large-body path the way a true separate
  external host:port would. Confirm the reverse-proxy leg streams (it does for `/daemon/*`) and
  whether per-route body limits are reachable, or the split's body-size payoff is undercut.
- **Trigger.** Part 1 (consolidation) is cheap and worth doing the next time the three-place prefix
  duplication causes a bug. Part 2 waits for the first concrete "reach into a workspace beyond a
  daemon web view" need. Part 3 waits for a split epic to fire. The epic exists now so those three,
  when they land, share one addressing/dispatch model instead of three more one-offs.
