# qits-net: one Docker network for qits and its workspaces (via a devcontainer)

> **Status: implemented 2026-07-07.**

## Introduction

The daemon web view framed a workspace's dev server by reaching its container over a **host-published
port** (`-p 127.0.0.1:0:<port>`). Because docker can only publish ports at `docker run` and the
published set was derived from the daemon `webView.port`s that happened to exist then, a port
configured after the container was created was unreachable until a container **recreation** — the
"this container does not publish port :4200 … recreate the container" error
([the bug](../issues/resolved/2026-07-07_web-view-port-frozen-at-container-creation.md)). Publishing
was also a host-port bind on every workspace container, which is undesirable in itself.

This feature removes host-port publishing entirely: **qits and every workspace container share one
Docker network (`qits-net`)**, and the web-view proxy reaches a container port by the container's
**DNS name**. Any port is reachable the moment the daemon is running, regardless of when it was
configured — no recreation, ever. To put qits on that network on Docker Desktop/WSL2 (where a host
process can't route to the bridge network), qits itself runs in a container — realized as a
**devcontainer** that reuses the `docker/workspace` toolchain image.

Related/dependent plans:

- **Fixes** [web-view port frozen at container creation](../issues/resolved/2026-07-07_web-view-port-frozen-at-container-creation.md).
- **Modifies** [workspace containers](2026-07-04_workspace-containers.md),
  [daemon web-view picker](2026-07-05_daemon-webview-picker.md), and
  [daemon web-view configuration](2026-07-06_daemon-webview-configuration.md) — specifically their
  create-time port-publishing seam (`ContainerRuntime.run` publish ports → gone) and the recreate
  affordance (removed).
- **Simplifies** [QitsHostResolver](2026-07-04_workspace-containers.md)'s container→qits addressing:
  on the shared network a container reaches qits by its alias (`git-host=qits`), retiring the WSL2
  eth0 detection for that deployment (see the resolved
  [MCP](../issues/resolved/2026-07-05_agent-mcp-unreachable-from-container.md) /
  [OTEL](../issues/resolved/2026-07-05_quarkus-otel-endpoint-not-bridged.md) networking issues).

## The two directions, unified

Both host↔container directions are now container↔container over `qits-net`:

- **qits → container** (web-view proxy): `ContainerRuntime.resolveTarget(container, port)` returns a
  `ProxyOrigin(host, port)`. In the default `network` mode it is the container's DNS name + the real
  container port; `DaemonProxyRoute` reverse-proxies to `origin(port, host)`. No `docker port`, no
  `-p`. (A `bridge-ip` mode — `docker inspect` the container IP — is kept for plain-Linux hosts where
  the bridge is host-routable.)
- **container → qits** (git clone/push, OTLP, MCP): `QitsHostResolver` returns qits' network alias
  `qits` (the devcontainer sets `qits.workspace.git-host=qits`), so the container hits
  `http://qits:8080/...` by DNS.

The web-view chain (only the boundary hop changed):

```
browser → 127.0.0.1:4200 (devcontainer Quinoa, ingress) → localhost:8080 (devcontainer Quarkus /daemon)
        ⇢ http://qits-ws-<workspaceId>-<repo>:4200  (workspace container, qits-net DNS — NO -p)
        → localhost:8080 (workspace Quarkus, its own dev-proxy)
```

## Code changes

- **`ContainerRuntime`**: `run(...)` dropped its `publishPorts` argument; `hostPort` was replaced by
  `resolveTarget(container, port) → ProxyOrigin`. `DockerExecutor` adds `--network qits-net` to every
  `docker run`, publishes nothing, and ensures the network exists at startup
  (`ensureNetwork`, inspect-then-create, mirroring the claude-volume `ensureClaudeVolume`).
  `FakeContainerRuntime` resolves to `127.0.0.1:<port>` (fake containers are host clones), so the
  whole suite stays docker-free.
- **`WorkspaceContainer`**: the `publishPort(s)` seam became `network(name)` (`--network`);
  `WorkspaceContainerFactory` seeds it from `qits.workspace.network` (default `qits-net`).
  `WorkspaceService.daemonPorts` was deleted.
- **`DaemonSupervisor`**: `Instance.hostPort` → `Instance.origin`; `resolveHostPort` → `resolveOrigin`
  (no WARNING event); `ProxyTarget(status, origin)`; `DaemonInstanceDto.needsContainerRecreate` was
  removed. `DaemonProxyRoute` drops the "does not publish port" 502.
- **Frontend**: the amber recreate banner and its stop→ensure mutation are gone from
  `workspace-daemons.component.ts`.
- **Config**: `qits.workspace.network` (default `qits-net`) and `qits.workspace.container-network`
  (`network` | `bridge-ip`, default `network`).

## The devcontainer (`.devcontainer/`)

- `Dockerfile` extends `qits/workspace:latest` (JDK 25, Node/pnpm, git — the workspace toolchain) and
  adds the **docker CLI** (docker-outside-of-docker) so qits manages sibling workspace containers via
  the mounted socket.
- `docker-compose.yml` runs qits on `qits-net` with alias `qits`; mounts the repo source (live
  reload), `/var/run/docker.sock`, and a `qits-data` volume for `~/.qits` (H2 + repos); forwards
  `127.0.0.1:8080` / `127.0.0.1:4200` for the browser (the only host publish — qits' own ingress,
  not a workspace container); sets `QITS_WORKSPACE_GIT_HOST=qits`.
- Daily dev: open the repo in the devcontainer, then `./mvnw -pl service quarkus:dev` in its terminal
  (same command, in-container). The uid the devcontainer runs as is a local tuning point (it runs as
  root by default; repo files it writes are root-owned on the host — fine for VS Code Remote, occasional
  host-side git may need sudo).

## Testing

- Unit (docker-free, `FakeContainerRuntime`): `WorkspaceContainerTest`/`WorkspaceContainerFactoryTest`
  assert `--network qits-net` and no `-p`; `DaemonSupervisorTest.webViewPortDeclaredAfterTheContainerExistsIsReachableWithNoRecreation`
  is the regression proving a late-configured port is reachable with no warning; the frontend spec no
  longer asserts the banner.
- Extended (real docker, `@Tag("extended")`): `WorkspaceContainerIT.anyContainerPortResolvesOverThe
  SharedNetworkWithNoPublishing` asserts `resolveTarget` yields the DNS-name origin for any port and
  `docker port` lists nothing.
- End-to-end: `seed-webapp` inside the devcontainer — start the daemon, **Web view** renders on
  `/greeting`; add a second web-viewable daemon on a fresh port to the existing container and confirm
  it works with no recreate.
