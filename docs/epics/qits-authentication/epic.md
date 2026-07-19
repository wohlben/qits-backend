# Epic: qits-authentication — build-variant auth

## Introduction

The **authentication domain**: how qits decides who a request belongs to, selected at **build
time** by an auth variant. The always-on `QitsAuthPolicy` guards every endpoint, `PublicPaths`
lists the token-free exceptions, and `/api/auth/me` reports the resolved identity — while the
concrete mechanism (`forwardauth` trusting a proxy's headers, or built-in `oidc`/Keycloak) is a
swappable module chosen with `-Dqits.variant`.

**Cross-cutting epic**, not part of the projects → repositories → workspaces aggregate chain:
auth wraps the whole `service` surface. It has its **own Maven modules** (`auth/core`,
`auth/oidc`, `auth/forwardauth`) — a genuinely separate concern with a hard module boundary,
which is exactly why it earns an epic even at one part today: it is the extension point future
auth work (per-repository tokens, richer policies) lands in.

Related plans (consumers of the auth decision):

- **The write-surface trust model** for [qits-artifactory](../qits-artifactory/epic.md): its
  Open questions weigh `PublicPaths` entries vs. per-repository write tokens for CI uploaders
  that hold no session — an auth-domain decision this epic will own when it lands.
- **Session-authed media/capture** — capture GETs and artifactory blob reads ride the resolved
  session (oidc cookies / forwardauth headers) under both variants.
- **Deployment** — the `oauth` variant runs against the real IdP in production; the
  `forwardauth` variant (dev/test default) trusts proxy headers.

## Parts (implemented)

- **[build-variant-auth](features/2026-07-16_build-variant-auth.md)** — the whole current auth
  story in one doc: the `auth/core` + `auth/oidc` + `auth/forwardauth` module split,
  `QitsAuthPolicy`, `PublicPaths`, `/api/auth/me`, the `-Dqits.variant` build-time selection
  (flagless dev/test default `forwardauth`), and **both concrete variants** as dedicated
  sections — the `forwardauth` variant (trusted proxy headers) and the `oauth` variant (hybrid
  OIDC at qits / Keycloak). oidc and forwardauth are *not* separate feature docs; they are the
  two build variants this single feature ships.

## Done when

Rolling: current when its `feature-ideas/` is empty and every auth feature since this epic's
creation has landed here.

## Status

| Part | Status |
|---|---|
| [build-variant-auth](features/2026-07-16_build-variant-auth.md) | implemented |
