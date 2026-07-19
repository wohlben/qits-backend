# Terminal WebSocket shows [disconnected] immediately behind the Dokploy HTTPS proxy

> **RESOLVED 2026-07-17** (fix in tree, pending redeploy): root cause confirmed live against
> qits.wohlben.eu — cause 3 below, with a twist. The upgrade reaches qits and authenticates fine;
> `SameOriginUpgradeCheck` then rejects it 403 because `quarkus.http.proxy.enable-forwarded-host`
> (+ Traefik's `X-Forwarded-Port: 443`) rewrites the request authority to `qits.wohlben.eu:443`,
> while the browser `Origin: https://qits.wohlben.eu` never carries the default port (RFC 6454).
> The browser can't surface the 403 (WS close code 1006) — hence "no error anywhere". Proof:
> replaying the handshake with the real session cookie returned 403; the identical handshake with
> `Origin: https://qits.wohlben.eu:443` returned **101** and streamed the live PTY. Fixed by
> default-port normalization in `SameOriginUpgradeCheck` (`sameAuthorityModuloDefaultPort`), with
> regression tests in `SameOriginUpgradeCheckTest`. Move this doc to `resolved/` once the fix is
> deployed and the terminal verified in prod. The unauthenticated-probe behavior (302 OIDC
> challenge on a WS upgrade, cause 2) remains the documented "accepted edge" for dead sessions.

## Introduction

Related/dependent plans:

- `docs/epics/qits-authentication/features/2026-07-16_build-variant-auth.md` — `QitsAuthPolicy` covers websockets-next
  upgrades; the oauth variant's `q_session` cookie is the credential that must ride along on the
  terminal/chat WS handshakes.
- `docs/guides/deployment.md` — the Dokploy deployment this was observed on (Traefik terminates
  TLS, routes to `http://qits:8080` over `dokploy-network`).
- `websocket/SameOriginUpgradeCheck` — the CSWSH guard that runs on every upgrade; in every
  environment before this deployment it passed via its *loopback* branch, so prod is the first
  real exercise of the `Origin == Host` comparison.
- Likely co-affected if proxy-level: the `/daemon/*` web-view proxy (`DaemonProxyRoute` forwards
  WS upgrades into workspace containers) and the `/api/chat/*` agent chat socket — same handshake
  path through the same proxy.
- `docs/issues/2026-07-17_docker-cli-stderr-pollutes-captured-output.md` — found while diagnosing
  this: the session-start POST returns 200 with a `commitHash` polluted by a docker CLI stderr
  warning. NOT the cause of the disconnect (that exec exited 0 — docker, the workspace container,
  and git all work in prod; the terminal's backing `docker exec -it` spawns the same way), but a
  real bug of its own, plus evidence the prod container runs with `HOME=/root`.

## Observed

Prod/dev deployments via Dokploy (HTTPS domain → Dokploy's Traefik → `http://qits:8080`).
Everything else works (REST, SPA, login), but opening a terminal session renders xterm and
immediately prints `[disconnected]` — nothing else, no browser error surfaced.

Two details narrow it to a **rejected/failed handshake**, not a server-side close:

- `WebTerminalComponent.ws.onclose` is the only thing that prints `[disconnected]`; a failed
  handshake fires `onclose` right away.
- If the upgrade had succeeded but the command were gone, `TerminalSocket.onOpen` sends a yellow
  "This command is no longer running." frame *before* closing — that line is absent.

The client itself is scheme-correct (`web-terminal.component.ts` derives `wss://` from
`location.protocol` and uses `location.host`), so "we build a ws:// URL on https pages" is ruled
out.

## Suspected causes (in likelihood order)

1. **Traefik + HTTP/2 mishandling the upgrade** (never reaches qits). Dokploy's default Traefik
   config has a known WebSocket-vs-HTTP/2 problem
   (https://github.com/Dokploy/dokploy/issues/4202): browsers negotiate h2 via ALPN and the
   classic `Upgrade` handshake doesn't exist on h2 (RFC 8441 extended CONNECT is needed instead).
   Matches "no error anywhere": qits logs nothing because the request dies at the proxy.
   Workaround per that issue: disable h2 on the Traefik entrypoint (`maxConcurrentStreams: 0`) or
   upgrade to a Traefik/Dokploy version handling RFC 8441.
2. **Auth gate 401 on the upgrade** (`QitsAuthPolicy` denies → mechanism challenge). oauth
   variant: the `q_session` cookie must be sent on the handshake — same-origin HttpOnly cookies
   normally are, but an expired session can't run the 302 code-flow challenge over a WS handshake
   (documented "accepted edge" in the auth feature doc — reconnects fail silently until the next
   XHR reloads). forwardauth variant: the forward-auth middleware must inject `Remote-User` on
   upgrade requests too, not only on regular ones.
3. **`SameOriginUpgradeCheck` 403** (Origin/Host mismatch). First real-domain exercise of the
   check. Any proxy layer that rewrites `Host` toward the backend (Traefik `passHostHeader=false`,
   a second proxy in front, a CDN) makes `Origin: https://qits.example.com` ≠ `Host: <internal>`
   and the loopback fallback doesn't apply. qits logs
   `Rejected cross-origin WebSocket upgrade (path=… origin=… host=…)` at INFO — the log line
   itself shows the mismatch.

## How to discriminate (5 minutes on the deployment)

1. Browser DevTools → Network → filter `WS` → click the `api/terminal/commands/…` request:
   - **401** → cause 2 (auth on the upgrade).
   - **403** → cause 3 (same-origin check; confirm via the qits log line).
   - **404 / no status / `ERR_HTTP2_PROTOCOL_ERROR` / "connection failed"** → cause 1 (Traefik).
2. `docker logs <qits>` grepped for `Rejected cross-origin WebSocket upgrade` — present ⇒ cause 3.
3. Handshake probe from the server host, bypassing browser h2 (expect **401** — proof the upgrade
   survives Traefik and reaches qits' auth; anything else points at the proxy):

   ```bash
   curl -i -N --http1.1 \
     -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
     -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: x3JJHMbDL1EzLkh9GBhXDw==' \
     -H 'Origin: https://<domain>' \
     https://<domain>/api/terminal/commands/any-id
   ```

4. If (3) gives 401 but the browser still fails: h2-specific ⇒ cause 1; disable h2 on the Traefik
   entrypoint and retest.

## Suggested fix direction

- Cause 1: Traefik config change only (Dokploy issue above); no qits code change.
- Cause 2 (oauth stale-session edge): the UI could catch the first WS close, hit any protected
  XHR to trigger the 499/reload dance, then retry the socket once — turns a dead terminal into a
  transparent re-login.
- Cause 3: keep the check, but when qits runs with `quarkus.http.proxy.enable-forwarded-host`,
  compare Origin against `X-Forwarded-Host` as well as `Host` (trusting it only behind the proxy
  flag), or document that the proxy must preserve `Host`.
