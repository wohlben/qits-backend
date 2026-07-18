# OIDC expired session: SPA reloads in a nonstop flicker loop instead of reaching login

> **RESOLVED 2026-07-18.** Two-sided fix:
>
> - **Backend** — `NonNavigationRequestChecker` (auth-oidc, quarkus-oidc's
>   `JavaScriptRequestChecker` SPI; the module's first Java) widens the "answer 499, don't 302"
>   decision from marked XHRs to every request a browser can't usefully redirect: SSE
>   (`Accept: text/event-stream`), WebSocket upgrades (`Sec-WebSocket-Key`), and any
>   `Sec-Fetch-Mode` other than `navigate`. Only real navigations enter the code flow now, so
>   background transports on a dead session stop minting `q_auth` state cookies that clobber an
>   in-flight login. (Bytecode of quarkus-oidc 3.34.6 confirmed the cookie is a single
>   `q_auth<tenant-suffix>` per tenant — not per-flow — so the clobber race was structurally
>   real; it also showed the checker bean *replaces* the built-in `X-Requested-With` check, which
>   the new bean therefore re-implements.) Covered by four new `OidcAuthTest` cases.
> - **Frontend** — `auth-session-recovery.service.ts` behind the interceptor: a per-page-life
>   latch (a burst of 499s produces one navigation, not one each) plus a `sessionStorage` stamp
>   surviving reloads — a second 499 within 10s of the last reload means reloading didn't recover
>   the session, so it escapes to the app root (`appUrl('')`, base-relative) instead: a single
>   clean document navigation with no SPA traffic racing the code flow, the same thing the manual
>   close-tab-and-reopen workaround achieved. Covered by `auth-session.interceptor.spec.ts`.
>
> Not done here (still worth doing): deliberate `QueryClient` defaults and replacing the commands
> list's 5s `refetchInterval` (suggestion 3), and the Keycloak Access Token Lifespan raise
> (suggestion 4, an operator action already recommended by the websocket issue doc).

## Introduction

Related/dependent plans:

- `docs/features/2026-07-16_build-variant-auth.md` — the oauth variant whose 499-for-marked-XHR
  contract this loop rides on; its "Accepted edge" (header-less transports can't send the marker)
  is a direct contributor here.
- `docs/issues/2026-07-17_idle-websocket-reaped-behind-proxy.md` — the 60s access-token lifespan
  (Keycloak `master` realm default) diagnosed there is what makes refresh events constant; its
  operator recommendation (raise the lifespan) also shrinks this bug's trigger surface.
- `service/src/main/webui/src/app/shared/core/interceptors/auth-session.interceptor.ts` — the
  sole frontend expiry handler, and the core defect.
- `docs/features/2026-07-07_workspace-sse-live-updates.md` — the SSE channel whose auto-reconnect
  becomes an anonymous challenge generator once the session is dead.

## Observed (prod, oauth variant, 2026-07-18)

When the OIDC session expires in a way silent refresh cannot recover (refresh token gone/invalid
— e.g. after the SSO session lapses), the open SPA tab starts flickering with nonstop route
changes / full-page reloads. It never settles on the Keycloak login page. The only escape is
closing the tab and opening a fresh one on a **top-level** route, which then cleanly 302s to
Keycloak login. Reported by the operator; matches the code paths below.

## Confirmed mechanics

The SPA has **no route guards, no auth store, and no stored return-URL/restore logic**. The
entire expiry handling is one line: `auth-session.interceptor.ts:20-22` — any same-origin XHR
answered **499** (quarkus-oidc's reply to `X-Requested-With: JavaScript` +
`java-script-auto-redirect=false` when the session is dead) triggers an **unconditional
`window.location.reload()`**. There is no "reload already in flight" latch, no debounce, no
memory that the previous reload failed to recover the session, and the reload re-requests the
*current deep route*, not a known-good top-level one.

Several sources fire auth-bearing XHRs in bursts, so a dead session produces many 499s at once,
each calling `reload()`:

- `app.config.ts:20` constructs `new QueryClient()` with no `defaultOptions` — TanStack defaults
  apply: `refetchOnWindowFocus: true`, `refetchOnReconnect: true`, `retry: 3` for every mounted
  query. Tab refocus (exactly when an expired-overnight session is discovered) refetches
  everything simultaneously.
- `pattern/command/commands-list.component.ts:119` — `refetchInterval: 5000` re-arms a fresh 499
  every 5s with no user interaction.
- `pattern/workspace/workspace-live.service.ts:39-43` — every SSE `onopen` invalidates all topic
  queries at once.

Meanwhile the **header-less transports keep initiating code-flow challenges**: `EventSource`
(`workspace-live.service.ts:32`) and the WebSocket handshakes cannot carry the
`X-Requested-With` marker, so on a dead session the backend answers them with a **302 code-flow
challenge** instead of 499. `EventSource` follows redirects, fails on the Keycloak HTML, and
auto-reconnects every few seconds — each round trip starts a *new* authorization request, and
each quarkus-oidc challenge writes a fresh `q_auth` state cookie.

Also confirmed: `/api/auth/me` is on `PublicPaths`, so an expired session gets **200
`{username: null}`**, never an error — the SPA has no signal to conclude "session dead, go to
login once"; the 499→reload path is the only handler.

## Suspected cause of the *loop* (why reload never lands on login)

A single reload → 302 → Keycloak → login/return round trip should work — and does from a fresh
tab. The loop needs something that keeps aborting or invalidating that round trip. Leading
hypothesis, in line with the "race condition" suspicion:

**The document code flow races the tab's own anonymous background traffic.** While the reload's
302→Keycloak→return-with-`code+state` round trip is in flight, the still-scheduled background
requests (SSE reconnect, WS re-handshake, query retries — all anonymous now) each provoke fresh
OIDC challenges whose `q_auth` state cookies replace the one the in-flight document flow needs.
When the browser returns with `?code=&state=`, the state no longer matches → quarkus-oidc cannot
complete the exchange and **re-challenges** (302 to Keycloak again) instead of establishing the
session. If the Keycloak SSO cookie is in any half-valid state this bounces instantly; each
bounce briefly re-boots the SPA shell, which restarts the SSE/queries, which re-clobber the next
attempt — a self-sustaining flicker. Closing the tab kills all racing connections; a fresh
top-level tab runs a single, unraced code flow and reaches login — exactly the observed escape.

Secondary contributors (real regardless of which race dominates): the burst of concurrent 499s
each calling `reload()`, and `restore-path-after-redirect` (default `true`) always steering the
flow back to the same deep route that immediately re-fires the burst.

To confirm on prod: set `quarkus.log.category."io.quarkus.oidc".level=DEBUG` and reproduce —
look for "state cookie is missing"/state-mismatch or code-exchange failures during the flicker
window; a HAR of the loop would show the qits↔Keycloak bounce and the `q_auth` cookie churn.

## Suggested fix direction

1. **Loop-breaker in the interceptor** (cheap, certain, frontend-only): a module-level latch so
   the first 499 triggers exactly one navigation and subsequent 499s are swallowed. Persist a
   timestamp in `sessionStorage`; if the previous 499-reload was < ~10s ago, navigate to `/`
   (top-level) instead of reloading the deep route — codifying the manual workaround as the
   automatic fallback.
2. **Stop anonymous challenges from header-less transports**: answer SSE (`Accept:
   text/event-stream`) and WebSocket-upgrade requests with a plain 401 *before* the OIDC
   challenge fires (small `HttpSecurityPolicy`/route-order filter in `auth-core`), so background
   transports stop minting `q_auth` state cookies that race the document flow. Frontend
   complement: `workspace-live.service.ts` should stop letting `EventSource` retry forever once
   errors persist (close after N consecutive failures; the next 499 handles re-login).
3. **Calm the burst sources**: set `QueryClient` `defaultOptions` deliberately (the SSE channel
   already replaces polling — `refetchOnWindowFocus` can be scoped down) and reconsider the 5s
   `refetchInterval` on the commands list (memory: live freshness should be push, not poll).
4. **Operator**: raise the Keycloak Access Token Lifespan (already recommended in
   `2026-07-17_idle-websocket-reaped-behind-proxy.md`) — fewer refresh events, smaller trigger
   surface; does not by itself remove the loop.
5. **Tests**: `auth/oidc` has zero expired-session coverage (only anonymous-challenge and
   bearer paths). Add WireMock-driven tests for expired-but-refreshable (silent refresh, no 499)
   and refresh-failure (marked XHR → 499; unmarked SSE-style request → the chosen 401 behavior).
