# Idle terminal WebSockets die: measured as auth expiry (1008), not proxy reaping

> **RESOLVED 2026-07-17, second pass.** The first fix (websockets-next keepalive,
> `auto-ping-interval=20s`) deployed and worked — a raw-socket probe against prod showed server
> pings every 20s — yet the same probe was then closed BY THE SERVER at exactly 60s with close
> code **1008** and reason "Authentication expired": websockets-next's
> `SecuritySupport.closeConnectionWhenIdentityExpired` closes every authenticated socket when the
> OIDC access token expires (no config switch exists to disable it), and this deployment's
> Keycloak realm is `master`, whose default Access Token Lifespan is **1 minute**. Idleness was
> never the trigger — time-since-token-issuance was.
>
> Real fix: `WebTerminalComponent` now auto-reconnects on abnormal closes (bounded backoff, five
> attempts; terminal reset before re-attach so the scrollback replay repaints clean). The
> re-handshake carries the `q_session` cookie and quarkus-oidc silently refreshes the token
> server-side — reconnecting IS the renewal; the SPA never holds a token (HttpOnly encrypted
> cookie), so there is nothing client-side to refresh directly. A clean close (1000: command gone
> or explicit detach) stays final — no relaunch loops. The chat socket already reconnected
> unconditionally (`command-chat.component.ts`), which is why chats never showed the symptom.
> The 20s keepalive stays — genuine proxy idle reaping remains real for quiet-but-valid sockets.
>
> Operator recommendation: raise the qits client's/realm's Access Token Lifespan in Keycloak
> (e.g. 15–30 min) — with a 60s lifespan the terminal transparently re-attaches every minute,
> which works but costs a scrollback replay + repaint each time.

## Introduction

Related/dependent plans:

- `docs/issues/2026-07-17_terminal-ws-immediate-disconnect-behind-https-proxy.md` — the
  *immediate* disconnect (same-origin default-port bug), fixed separately; this one is the
  *minutes-later* disconnect that remained after that fix shipped.
- `docs/guides/deployment.md` — the Dokploy/Traefik deployment whose responding timeouts do the
  reaping.
- `pattern/repository/web-terminal.component.ts` — a possible future complement: auto-reconnect
  on close (re-attach replays scrollback, so a transparent retry loop would also mask real
  restarts). Not needed for this fix; parked.

## Observed (prod, 2026-07-17)

A terminal left open without typing shows `[disconnected]` after a few minutes; a page refresh
re-attaches fine (the process keeps running — attach/detach is by design). Reported on
qits.wohlben.eu behind Dokploy's Traefik; also reproduced during the same-origin investigation.

## Cause

The terminal protocol sends nothing while the user doesn't type and the process is quiet, and
qits sent no protocol-level pings. To a TLS-terminating proxy the connection looks dead and its
idle/responding timeouts close it. The browser can't distinguish that from any other close →
xterm prints `[disconnected]`.

## Fix

`quarkus.websockets-next.server.auto-ping-interval=20s` — server pings every 20s (inside
Traefik's tightest 60s default), browsers answer pongs automatically, covering every
`@WebSocket` endpoint (terminal, chat, daemon attach) with no client change.
