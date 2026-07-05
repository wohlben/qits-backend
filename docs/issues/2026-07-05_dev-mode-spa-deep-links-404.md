# Dev mode: SPA deep links 404 through :8080 (Quinoa forwarding doesn't fall back)

## Introduction

Found while browser-verifying the
[daemon web-view picker](../features/2026-07-05_daemon-webview-picker.md) — the E2E flow needed to
open `/repositories/{id}/worktrees/{id}` directly. Not caused by that feature: reproduced with the
`/daemon` route unregistered and `quarkus.quinoa.ignored-path-prefixes` reverted to
`/api,/mcp,/git`. No other plans depend on this; it only affects dev-mode deep links, and
client-side navigation from `/` works.

## Observed

With `./mvnw -pl service quarkus:dev` running (Quinoa forwarding to the Angular dev server on
:4200):

- `GET http://localhost:8080/` → 200 (index served, app works).
- `GET http://localhost:8080/projects` (any Angular route, fresh page load) → **404**, rendering
  Quarkus's dev "Resources overview" page. Same with a browser `Accept: text/html` header.
- `GET http://localhost:4200/projects` (Angular dev server directly) → 200 (its own history
  fallback works).

So refreshing the browser on any deep link in dev, or opening a deep link from a bookmark, lands
on the Quarkus 404 dev page instead of the app. `quarkus.quinoa.enable-spa-routing=true` is set
but apparently only applies to the packaged build, not to dev-mode forwarding.

## Suspected cause

Quinoa's dev-mode `ForwardedDevProcessor` forwards *unhandled* requests to :4200, but non-root
SPA paths are evidently not reaching (or not being forwarded by) that handler — Quarkus's dev 404
handler answers first. Either the forwarding handler only claims paths that look like dev-server
assets, or SPA-route paths are excluded from forwarding in this Quinoa version (Quarkus 3.34.6).

## Suggested fix direction

Check Quinoa's dev-mode SPA-routing story for this version (quarkusio/quarkus-quinoa: SPA routing
+ dev server interplay; there are long-standing issues about `enable-spa-routing` being
build-only). Possible mitigations: bump Quinoa, or configure the Angular dev server as the
entrypoint during dev (open :4200 directly — it proxies nothing, so /api calls would then need an
Angular dev proxy config), or add a catch-all Vert.x fallback in dev profile that rewrites
non-file, non-prefixed GETs to `/`.
