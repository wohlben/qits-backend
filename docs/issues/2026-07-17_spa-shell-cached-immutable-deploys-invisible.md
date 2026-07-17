# SPA shell cached `immutable` for a day — deploys invisible until a hard refresh

> **RESOLVED 2026-07-17** (fix in tree): `SpaShellCacheFilter` (service, `eu.wohlben.qits.spa`)
> overrides `Cache-Control` to `no-cache` on every `text/html` response at headers-end; the
> content-hashed Angular bundles keep the default immutable caching (their URLs change per build).
> Move to `resolved/` once verified in prod: `curl -sI https://<host>/ -H 'Cookie: <session>'`
> shows `cache-control: no-cache`, and a plain (non-hard) reload after the NEXT redeploy picks up
> the new frontend.

## Introduction

Related/dependent plans:

- `docs/guides/quarkus-angular-integration.md` / Quinoa production static serving — the layer
  whose default header this corrects.
- `docs/issues/2026-07-17_idle-websocket-reaped-behind-proxy.md` — how it surfaced: the terminal
  auto-reconnect fix was deployed, but a user's plainly-refreshed tab kept running the old bundle
  and still showed the dead `[disconnected]`; only a cache-disabled reload fixed it.
- `docs/issues/resolved/2026-07-15_packaged-spa-not-served.md` — earlier packaged-serving contract.

## Observed (prod, 2026-07-17)

```
GET /            -> cache-control: public, immutable, max-age=86400   (the SPA shell!)
GET /main-<hash>.js -> cache-control: public, immutable, max-age=86400 (correct)
```

`immutable` means browsers don't even revalidate on a normal reload — after a redeploy users keep
the old frontend for up to 24h unless they hard-refresh with cache disabled. Also reproduced: a
browser with an expired session still *renders* the cached shell offline-style (APIs then 401),
which is confusing on its own.

## Cause

Quarkus's static-resources default (`public, immutable, max-age=86400`) is applied to everything
Quinoa serves, including `index.html` and the SPA-fallback deep links. Immutable caching is only
sound for content-addressed URLs.

## Fix

Global Vert.x filter setting `Cache-Control: no-cache` whenever the response content type is
`text/html` (the shell has no stable path — SPA fallback serves it on arbitrary deep links, so
content type is the reliable seam). `no-cache` still permits conditional requests (304 when
unchanged); it only forbids serving blind from cache.
