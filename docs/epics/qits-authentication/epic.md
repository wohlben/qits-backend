# Epic: qits-authentication — build-variant auth

## Introduction

The **authentication domain**: how qits decides who a request belongs to, selected at **build
time** by an auth variant. The always-on `QitsAuthPolicy` guards every endpoint, `PublicPaths`
lists the token-free exceptions, and `/api/auth/me` reports the resolved identity — while the
concrete mechanism (`forwardauth` trusting a proxy's headers, built-in `oidc`/Keycloak, or the
explicitly-open `local` variant) is a swappable module chosen with `-Dqits.variant`.

**The load-bearing invariant.** An **auth-scheme** variant — `forwardauth` or `oidc` — **never runs
unauthenticated under any circumstances**: once someone has chosen a scheme, it is unconditionally
enforced (a forwardauth build 401s until the proxy injects the header; an oidc build refuses to
start without its OIDC config; the forwardauth dev fallback is LaunchMode-guarded off in a packaged
build). The **only** open build is the dedicated **`local`** variant, and only when named
explicitly (`-Dqits.variant=local`): it authenticates every request as a fixed local user, for
**trusted local starts** — a workspace's own packaged qits behind the parent proxy on qits-net, or a
laptop run — and must never be internet-exposed. There is no *runtime* toggle in any variant; the
choice is made once, at build time.

**Cross-cutting epic**, not part of the projects → repositories → workspaces aggregate chain:
auth wraps the whole `service` surface. It has its **own Maven modules** (`auth/core`,
`auth/oidc`, `auth/forwardauth`, `auth/local`) — a genuinely separate concern with a hard module
boundary, which is exactly why it earns an epic even at one part today: it is the extension point
future auth work (per-repository tokens, richer policies) lands in.

Related plans (consumers of the auth decision):

- **The write-surface trust model** for [qits-artifacts](../qits-artifacts/epic.md): its
  Open questions weigh `PublicPaths` entries vs. per-repository write tokens for CI uploaders
  that hold no session — an auth-domain decision this epic will own when it lands.
- **Session-authed media/capture** — capture GETs and artifacts blob reads ride the resolved
  session (oidc cookies / forwardauth headers) under both variants.
- **Deployment** — the `oauth` variant runs against the real IdP in production; the
  `forwardauth` variant (dev/test default) trusts proxy headers.

## Parts (implemented)

- **[build-variant-auth](features/2026-07-16_build-variant-auth.md)** — the whole current auth
  story in one doc: the `auth/core` + `auth/oidc` + `auth/forwardauth` + `auth/local` module split,
  `QitsAuthPolicy`, `PublicPaths`, `/api/auth/me`, the `-Dqits.variant` build-time selection
  (flagless dev/test default `forwardauth`), and the concrete variants as dedicated sections — the
  `forwardauth` variant (trusted proxy headers), the `oauth` variant (hybrid OIDC at qits /
  Keycloak), and the `local` variant (explicitly unauthenticated, trusted local starts only). The
  variants are *not* separate feature docs; they are the build variants this single feature ships.
  The **auth-scheme variants (`forwardauth`/`oauth`) never run unauthenticated**; only `local` does,
  and only when named explicitly.

## Done when

Rolling: current when its `feature-ideas/` is empty and every auth feature since this epic's
creation has landed here.

## Status

| Part | Status |
|---|---|
| [build-variant-auth](features/2026-07-16_build-variant-auth.md) | implemented |
