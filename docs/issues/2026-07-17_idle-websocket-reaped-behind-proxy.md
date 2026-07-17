# Idle terminal WebSockets are reaped by the HTTPS proxy after a few minutes

> **RESOLVED 2026-07-17** (fix in tree, pending redeploy): enabled websockets-next's built-in
> keepalive — `quarkus.websockets-next.server.auto-ping-interval=20s` in `application.properties`.
> Ping/pong frames keep both directions of an untouched terminal non-idle, so the proxy never sees
> a dead stream. Move to `resolved/` once verified in prod (open a terminal, leave it untouched
> >5 min, type — no `[disconnected]`).

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
