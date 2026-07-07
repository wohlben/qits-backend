# Web view: Angular dev server rejects the host ("This host is not allowed") after the devcontainer move

**Status:** Resolved (2026-07-07).

## Introduction

A follow-on to the [qits-net devcontainer unification](../../features/2026-07-07_qits-net-devcontainer-unification.md)
and [web-view port frozen at container creation](web-view-port-frozen-at-container-creation.md):
the same move that made qits reach workspace containers by DNS name surfaced this second web-view
regression. Related: the [daemon web-view configuration](../../features/2026-07-06_daemon-webview-configuration.md)
feature and the [Quarkus+Angular integration guide](../../guides/quarkus-angular-integration.md)
(whose symptom table now lists this).

## Symptom

Opening a workspace's *Web view*, the frame shows:

> Blocked request. This host ("qits-ws-main-7b675394") is not allowed.
> To allow this host, add it to allowedHosts under the serve target in angular.json.

Seen for the first time after qits itself moved into the `.devcontainer/` on `qits-net`.

## Cause

The daemon web-view proxy (`DaemonProxyRoute`) forwards to the daemon's dev server via
`vertx-http-proxy`, which sets the outgoing `Host` header to the origin authority. Before the
devcontainer move qits ran on the host and reached the container through a published
`127.0.0.1:<port>`, so the dev server saw `Host: 127.0.0.1:<port>` — always allowed. After the move
qits reaches the container by its **DNS name** on the shared network, so the forwarded `Host`
became `qits-ws-main-<id>`. Angular 21's Vite-based `@angular/build:dev-server` rejects any Host
that isn't localhost / an IP / explicitly allow-listed.

## Fix

Rewrite the `Host`/`:authority` header at the proxy to `localhost:<port>` via a `ProxyInterceptor`
(`DaemonProxyRoute#hostRewrite`). `localhost` is always allow-listed by the dev server, and the
TCP target is unchanged (`.origin(...)` still dials the container), so this restores the exact Host
the dev server saw pre-move and needs **no per-app `allowedHosts` config** — it fixes every framed
project, not just the fixture. The alternative (a global `allowedHosts: *` env var) was rejected: it
would be per-project `ng serve --allowed-hosts` boilerplate that only fixes cooperating repos and
disables the dev server's host check.

Regression test: `DaemonProxyRouteTest#rewritesHostHeaderToLocalhostSoTheDevServerAllowsIt` asserts
the origin sees `Host: localhost:<port>`.

## Gotcha found while fixing

`io.vertx.httpproxy.ProxyInterceptor` is **not** a functional interface (two `default` methods, no
abstract method), so the interceptor must be an anonymous class. A lambda compiles under `javac`
(`./mvnw compile` stays green) but Quarkus's ECJ test/dev compiler emits a class that throws
`java.lang.Error: Unresolved compilation problems` when the route runs — every request to the route
then hangs to a 30s `SocketTimeout`, and the dead event-loop thread makes the whole test class time
out, hiding the real cause.
