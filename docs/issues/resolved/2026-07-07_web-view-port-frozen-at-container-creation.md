# Web view "does not publish port" — the published-port set was frozen at container creation

> **Status: resolved 2026-07-07** by
> [qits-net devcontainer unification](../../epics/qits-live-deployment/features/2026-07-07_qits-net-devcontainer-unification.md).
> Kept here as the record of the bug it removed.

## Introduction

Related/dependent plans:

- **Resolved by** [qits-net devcontainer unification](../../epics/qits-live-deployment/features/2026-07-07_qits-net-devcontainer-unification.md)
  — the feature that replaced host-port publishing with shared-network DNS addressing.
- **Bug in** [daemon web-view configuration](../../epics/qits-workspace-daemons/features/2026-07-06_daemon-webview-configuration.md) /
  [daemon web-view picker](../../epics/qits-workspace-detail/features/2026-07-05_daemon-webview-picker.md) — those shipped the
  create-time publishing model this issue was inherent to.
- Same-family networking issues:
  [agent MCP unreachable from container](2026-07-05_agent-mcp-unreachable-from-container.md),
  [quarkus OTEL endpoint not bridged](2026-07-05_quarkus-otel-endpoint-not-bridged.md).

## Observed

On the workspace detail route the web view showed:

> Web view unavailable: this container does not publish port :4200. Recreating the container stops
> all of this workspace's running processes; start the daemon again afterwards.

Repro: create a workspace, then configure (or edit) a daemon's `webView.port` — or open a workspace
whose container was created before the daemon's web-view port existed — and click **Web view**.

## Cause

The workspace container published host ports (`-p 127.0.0.1:0:<port>`) for exactly the daemon
`webView.port`s that existed **at `docker run` time** (`WorkspaceService.daemonPorts` →
`WorkspaceContainer.toRunArgv`). Docker cannot add a port to a live container, so any port introduced
after creation was unreachable until the container was recreated — surfaced as
`DaemonInstanceDto.needsContainerRecreate`, the amber banner in `workspace-daemons.component.ts`, a
WARNING event in `DaemonSupervisor.resolveHostPort`, and a 502 in `DaemonProxyRoute`. The published
set was frozen at creation; the ports actually needed were discovered later.

Host-port publishing was itself a workaround: on Docker Desktop/WSL2 a host process cannot route to
the container bridge network, so published `127.0.0.1` ports were the only host→container channel.

## Fix

qits and every workspace container now share one Docker network (`qits-net`); the daemon web-view
proxy reaches a container's port by the container's **DNS name** (`ContainerRuntime.resolveTarget` →
`ProxyOrigin`), so **no** host ports are published and there is no create-time port constraint. qits
runs on that network via the new `.devcontainer/`. A port configured after the container exists is
reachable immediately — the whole recreate surface (banner, event, 502, `needsContainerRecreate`) was
removed. Regression test: `DaemonSupervisorTest.webViewPortDeclaredAfterTheContainerExistsIsReachableWithNoRecreation`.
