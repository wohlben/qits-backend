# Build-variant auth: `forwardauth` / `oauth`

Authentication is a **build-time variant**, not a runtime feature: every qits build names exactly one
auth variant (`-Dqits.variant=forwardauth|oauth`), the auth code lives in dedicated Maven modules
outside `service`, and there is **no unauthenticated build and no runtime toggle**. A `forwardauth`
image trusts the identity headers a forward-auth proxy injects; an `oauth` image terminates the OIDC
authorization-code flow itself (Keycloak) and refuses to start without its OIDC config — an
OIDC-configured qits can never run unauthenticated.

This supersedes the short-lived *optional OIDC auth* design (a `qits.auth.enabled` runtime knob with
quarkus-oidc always packaged but dormant): the mechanism work carried over, the "optional feature"
shape was replaced by variants.

## Introduction

Related/dependent plans:

- `docs/guides/deployment.md` — the "Ingress / auth" section documents variant selection at install
  time (`QITS_VARIANT` for `install.sh` / the image build) and each variant's env recipe;
  `docker-compose.prod.yml` carries the matching commented env blocks.
- `docs/features/2026-07-04_workspace-containers.md`,
  `docs/features/2026-07-08_lazy-workspace-container-provisioning.md` — why workspace containers
  call qits back over `/git`, `/api/otel`, `/mcp`; those callers cannot hold a user token, which is
  what shapes the public-path list.
- `docs/features/2026-07-06_spa-observability.md`, `docs/features/2026-07-14_capture-ingest-workspace.md`
  — the cross-origin fixture-SPA traffic (`/api/otel/*` passthrough, `POST /api/capture`) that also
  stays token-free.
- `docs/features/2026-07-04_container-agent-sessions.md` — the Claude SessionStart hook that POSTs
  `/api/commands/{id}/agent-session` from inside the container.
- `websocket/SameOriginUpgradeCheck` — the origin-based CSWSH guard; unchanged, layered *under* the
  identity-based policy.
- `docs/features/2026-07-07_workspace-sse-live-updates.md` — the EventSource channel that motivated
  the oauth variant's cookie-session design (it cannot send an `Authorization` header).
- `docs/features/2026-07-05_maven-build-cache.md` — the variant profiles change `service`'s
  dependency set, so the two variants cache under distinct keys.

## Module layout

Three plain library-jar modules under `auth/` (reactor members like `domain`), each carrying a
`META-INF/jandex.idx` (jandex-maven-plugin) so the consuming app auto-discovers their beans — no
`quarkus.index-dependency` entries, which couldn't be conditional on the selected variant anyway:

| Module | Contents |
|---|---|
| `auth/core` (`auth-core`) | Shared by both variants: the global `QitsAuthPolicy` (always enforcing — no enable knob), the `PublicPaths` token-free allowlist, `AuthController` (`GET /api/auth/me` → `{variant, username}`), the optional `qits.auth.required-role` check. |
| `auth/oidc` (variant id **`oauth`**) | `quarkus-oidc` + the shipped OIDC defaults. No Java of its own — quarkus-oidc's hybrid mechanism does the work. |
| `auth/forwardauth` (variant id **`forwardauth`**) | `ForwardAuthMechanism` (proxy header → `TrustedAuthenticationRequest`) + `ForwardAuthIdentityProvider` (groups header → roles), header-name config, the LaunchMode-guarded dev/test fallback identity. |

**The variant contract** (also in `auth-core`'s `package-info`): a variant module defines
`qits.auth.variant=<id>` in its `META-INF/microprofile-config.properties`, provides exactly one
`HttpAuthenticationMechanism`, and ships its config defaults in that same file — Quarkus reads
`microprofile-config.properties` from dependency jars (ordinal 100, under the app's
`application.properties` at 250 and env at 300), unlike `application.properties`, which is only read
from the app module itself.

## Selection: one mandatory flag, enforced twice

`service/pom.xml` has two property-activated profiles (`variant-oauth` / `variant-forwardauth`);
`-Dqits.variant=…` activates the matching one, which adds the single variant-module dependency
(`auth-core` arrives transitively). `service` itself contains **zero auth code** — its only
auth-adjacent line is config (the trip-wire below).

- **maven-enforcer** (`requireProperty qits.variant`, bound to `validate` in `service`) fails any
  build — including `quarkus:dev`, whose mojo runs the early lifecycle phases — that didn't name a
  variant, with a message listing the valid values.
- **Augmentation trip-wire**: `quarkus.application.name=qits-${qits.auth.variant}` in service's
  `application.properties`. The expansion source only exists in a variant module's shipped config, so
  any build path that somehow skipped the enforcer fails fast at augmentation ("Could not expand
  value qits.auth.variant") instead of booting an unprotected qits. Because `application.name` would
  otherwise leak into the exported OpenAPI title, `quarkus.smallrye-openapi.info-title=qits API` pins
  the doc (and the generated Angular client) variant-independent.

The prod image build (`docker/qits/Dockerfile`) takes `--build-arg QITS_VARIANT=…` (no default) and
passes it through; `install.sh` requires `QITS_VARIANT` in the environment. The deleted knobs:
`qits.auth.enabled` and `quarkus.oidc.tenant-enabled` are gone — in an oauth build OIDC is
unconditionally active (missing `QUARKUS_OIDC_*` env fails startup, deliberately), in a forwardauth
build header trust is unconditionally active.

## Enforcement: one global policy (auth-core, both variants)

`QitsAuthPolicy` is a **global `HttpSecurityPolicy`** — Quarkus mounts the auth handlers on the main
Vert.x router ahead of every user route, so one bean covers the JAX-RS `/api` tree, the raw router
routes (`/git` host, `/daemon` proxy), the MCP servers, Quinoa's static/SPA serving, and
websockets-next upgrades. The public list below is permitted without touching the identity;
everything else requires a non-anonymous identity (+ the optional `qits.auth.required-role`, which
under oauth is a Keycloak realm role and under forwardauth a proxy-supplied group).

**Public** (`PublicPaths` — callers that cannot hold a user token; identical for both variants
because workspace containers reach qits directly on qits-net, bypassing any proxy):

| Path | Caller |
|---|---|
| `/git/*` | workspace containers (clone/push; repo ids are capability UUIDs) |
| `/mcp`, `/mcp/*` | the coding agent inside workspace containers |
| `/api/otel/*` | container OTLP exporters + the fixture SPA's passthrough |
| `/api/capture` | the fixture SPA in the user's browser (cross-origin; own CORS route) |
| `/api/commands/{id}/agent-session` | the Claude SessionStart hook inside containers (regex — id mid-path) |
| `/q/*` | health probes (compose healthcheck, orchestrators) |
| `/api/auth/*` | `/api/auth/me` + (oauth) the OIDC logout path, needed anonymously |

Everything else is protected — including the SPA, the SSE events channel, the terminal/chat
WebSockets, and `/daemon/*` (cookie/headers ride along, the iframe being same-origin). The policy
matches on `RoutingContext.normalizedPath()`, so dot-segment tricks (`/api/../git/x`) can't spoof
into a public prefix.

## The `forwardauth` variant: trusted proxy headers

The forward-auth proxy (Authelia, oauth2-proxy, traefik-forward-auth, …) does the login and injects
identity headers; qits believes them unconditionally — that trust boundary is the variant's whole
premise, which is why the prod compose publishes **no host port** and the proxy MUST strip
client-supplied copies of the headers.

- `qits.auth.forward.user-header` (default `Remote-User`) → the principal. Missing/blank on a
  protected path → anonymous → the policy denies → a plain **401** (no redirect; the proxy owns
  login, qits has nothing to redirect to).
- `qits.auth.forward.groups-header` (default `Remote-Groups`, comma-separated, trimmed) → roles, so
  `qits.auth.required-role` works identically to oauth token roles.
- The mechanism authenticates through the `IdentityProviderManager` with a
  `TrustedAuthenticationRequest` (rather than building the identity inline), keeping
  `SecurityIdentityAugmentor`s functional.
- **Dev/test fallback**: the module ships `%dev.`/`%test.qits.auth.forward.dev-user=dev` — with no
  proxy in front, dev mode and the test suites authenticate anonymously-but-identified as `dev`.
  Double-guarded: the config is profile-scoped AND `ForwardAuthMechanism` ignores it whenever
  `LaunchMode.current() == NORMAL`, so a prod build stays anonymous even if the property leaks in
  via env. This is what makes forwardauth the everyday dev/test variant.

Consequence to be loud about: a deployed forwardauth qits **401s every UI/API request until the
proxy injects the header** — "proxy in front, qits open behind it" is no longer a supported posture.

## The `oauth` variant: hybrid OIDC at qits (Keycloak)

Unchanged from the original design, now shipped as `auth/oidc`'s config defaults. Why hybrid
(code flow at qits + bearer), not a pure resource server: the UI has three transports that **cannot
attach an `Authorization` header** — the native `EventSource` SSE channel, the xterm WebSockets
(`/api/terminal/*`, `/api/chat/*`), and the `/daemon/*` web-view iframe. A same-origin session
cookie reaches all three for free:

- Unauthenticated browser navigation → 302 to Keycloak → back with the auth code → qits exchanges it
  server-side and stores the tokens in the encrypted, HttpOnly, auto-chunked `q_session` cookie (the
  cookie IS the session; no server-side store). The login wall covers the SPA itself.
- `Authorization: Bearer <jwt>` requests are validated resource-server style — scripts/CLI work.
- Every non-navigation request gets **499 + `WWW-Authenticate: OIDC`** instead of an unfollowable
  302 (`java-script-auto-redirect=false` + `NonNavigationRequestChecker`, auth-oidc's
  `JavaScriptRequestChecker` bean: marked XHRs `X-Requested-With: JavaScript`, SSE
  `Accept: text/event-stream`, WebSocket upgrades, any `Sec-Fetch-Mode` other than `navigate`).
  Only real navigations enter the code flow — background transports on a dead session no longer
  mint `q_auth` state cookies that would clobber an in-flight login's state (see
  `docs/issues/resolved/2026-07-18_oidc-expired-session-reload-loop.md`). The SPA interceptor
  reacts to 499 with a loop-guarded full-page reload → server-driven re-login (usually silent via
  SSO).
- Silent refresh (`token.refresh-expired=true`, `session-age-extension=30M`); RP-initiated logout at
  `/api/auth/logout` (intercepted by quarkus-oidc, no controller).
- Keycloak specifics: `roles.source=accesstoken` (realm roles live in the access token, not the
  code-flow-default ID token), `principal-claim=preferred_username` for a human-readable
  `/api/auth/me`.

CSRF posture: `q_session` is HttpOnly + SameSite=Lax; all state-changing endpoints are non-GET under
`/api`, which Lax cookies don't accompany cross-site.

## SPA integration (deliberately minimal — no keycloak-js, no token handling)

- `GET /api/auth/me` → `{variant, username}`. The sidebar's `pattern/auth/auth-status.component.ts`
  renders the user chip whenever an identity exists (under forwardauth in dev that's `dev`), and the
  sign-out anchor only when `variant === 'oauth'` — forwardauth has no qits-side logout, the proxy
  owns the session.
- `shared/core/interceptors/auth-session.interceptor.ts` — the 499 marker/reload dance above,
  delegating navigation to `auth-session-recovery.service.ts`: one navigation per incident (a burst
  of 499s reloads once), and a sessionStorage stamp detects a reload that failed to re-login — the
  next 499 then escapes to the app root instead of re-reloading the deep route (the loop-breaker
  for `docs/issues/resolved/2026-07-18_oidc-expired-session-reload-loop.md`). A harmless
  header-tagger under forwardauth.
- SSE/WebSocket reconnects can't send the marker header, but `NonNavigationRequestChecker`
  recognizes their shape server-side, so on a dead session they get the same 499 (no
  state-cookie-minting 302); they fail quietly until the next XHR triggers the recovery reload.

## Dev mode & tests

Every build names a variant — including dev and tests; the documented commands in `CLAUDE.md` carry
`-Dqits.variant=forwardauth` as the everyday choice:

```bash
./mvnw -pl service -am quarkus:dev -Dquarkus.bootstrap.workspace-discovery=true -Dqits.variant=forwardauth
# → /api/auth/me: {"variant":"forwardauth","username":"dev"} — the %dev fallback identity
./mvnw -pl service -am quarkus:dev -Dquarkus.bootstrap.workspace-discovery=true -Dqits.variant=oauth
# → Keycloak Dev Services auto-starts a Keycloak container (users alice/alice, bob/bob) → real login wall
```

- `auth/core`: `PublicPathsTest` — plain-JUnit matrix over the public/protected split.
- `auth/oidc`: `OidcAuthTest` + `OidcRequiredRoleTest` against `OidcWiremockTestResource` (WireMock
  OIDC stub, no real Keycloak), using a test-scope dummy JAX-RS resource + raw Vert.x routes as the
  stand-in for the service surface (this module can't depend on service — circular): 302 challenge,
  the 499 non-navigation contract (marked XHR, SSE accept, WS upgrade, `Sec-Fetch-Mode: cors` —
  and `navigate` still 302s), bearer accept/reject, public raw route token-free, role 403/200.
- `auth/forwardauth`: `ForwardAuthTest` (prod posture via blanked dev-user: header → identity,
  missing header → 401 incl. on raw routes), `ForwardAuthDevFallbackTest`,
  `ForwardAuthRequiredRoleTest` (groups → roles), `ForwardAuthHeaderOverrideTest`.
- `service`: `ForwardAuthVariantTest` — end-to-end on the real app (real `/daemon`, `/git`, OTLP,
  agent-session surfaces). **The service suite runs under `-Dqits.variant=forwardauth` only**: under
  oauth, `@QuarkusTest` fails startup for the missing `auth-server-url` — accepted; oauth coverage
  lives in `auth/oidc`'s own suite, and the oauth prod image builds with `-DskipTests`. All
  pre-existing service tests pass unchanged via the `%test` dev-user fallback.
