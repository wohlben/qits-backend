# Agent MCP server unreachable from the container — MCP URL uses `localhost`, not the resolved git host

> **Resolved 2026-07-05.** `AgentLaunchService` no longer defaults the MCP base URLs to
> `http://localhost:8080`. The `qits.actions-mcp.url` / `qits.repository-mcp.url` config properties
> are now optional explicit overrides; when unset (the default) the URL is derived from
> `QitsHostResolver.qitsHost()` + `qits.workspace.qits-port` as
> `http://<resolved-host>:<port>/mcp/<server>` — the same container-reachable host the git clone and
> the OTLP endpoint already use (`WorktreeService`, `OtelEnvironment`). Regression test:
> `AgentLaunchServiceTest#mcpUrlsUseTheContainerReachableGitHostNotLocalhost`.

## Introduction

Related / dependent plans:

- `docs/features/2026-07-01_coding-agent-harness.md` — the coding agent + its scoped MCP servers (repository / actions / telemetry tools).
- `docs/features/2026-07-04_workspace-containers.md` — the container execution model and how a container reaches the qits host.
- `docs/issues/resolved/2026-07-05_chat-hangs-setsid-tears-down-stdin.md` — the chat-hang fix; this MCP bug was visible in the same stream (`mcp=['repository:failed']`) once the chat responded.
- Memory: WSL2 git-host resolves to the distro's eth0 IP (`host.docker.internal` isn't container-reachable on this Docker Desktop / WSL2 box).

## Symptom

The coding-agent chat connects to its MCP server and it comes up `failed`
(`{"type":"system","subtype":"init",…,"mcp_servers":[{"name":"repository","status":"failed"}]}`). The
chat still works, but the agent has **none of its qits tools** (repository listing, actions,
telemetry), so "Configure … with Claude" can't actually inspect or configure anything.

## Root cause

The MCP server URLs are hardcoded to `localhost`:

- `AgentLaunchService`: `qits.actions-mcp.url` default `http://localhost:8080/mcp/actions`,
  `qits.repository-mcp.url` default `http://localhost:8080/mcp/repository` (lines ~83–89), used to
  build the `--mcp-config` the agent connects to.

From **inside the worktree container**, `localhost:8080` is the container's own loopback, not the qits
host. Meanwhile git clone/fetch works because it uses `qits.workspace.git-host=auto`, which resolves
per environment to a container-reachable address. Verified live from a worktree container:

- git origin URL = `http://192.168.152.4:8080/git/<repoId>` (the WSL2 eth0 IP) — reachable (`/q/health`
  → 200 at that IP).
- `http://localhost:8080/q/health` → fails (000).
- `http://host.docker.internal:8080/q/health` → fails (000) on this Docker Desktop / WSL2 box.

So the MCP URL host is the one place that still assumes `localhost`, and it is exactly the address the
container cannot reach.

## Suggested fix direction

Resolve the MCP URL host the same way the git host is resolved, instead of hardcoding `localhost`:

- Reuse the existing host resolution (`QitsHostResolver` / whatever backs `qits.workspace.git-host=auto`)
  to produce the container-reachable host, and build the MCP URLs from it + `qits-port` rather than
  from a `localhost` default. i.e. the agent's `--mcp-config` URL should be
  `http://<resolved-host>:<port>/mcp/<server>?…`, matching how the container already reaches qits for
  git.
- Keep the `qits.*-mcp.url` config as an explicit override, but make the **default** derive from the
  resolved host, not `localhost`.

## Repro / verification when fixed

Launch an agent chat in a worktree and observe the init event: `mcp_servers[].status` should be
`connected` (not `failed`), and a tool call like `mcp__repository__listBranches` should return data.
Cross-check reachability from the container:
`docker exec <wt-container> curl -s -o /dev/null -w '%{http_code}' http://<resolved-host>:8080/mcp/repository`
should be 405/200 (reachable), not 000.

## Notes

This is environment-general (the container is always a separate network namespace from the host), not
WSL2-specific — `localhost` inside the container never reaches the qits host. WSL2/Docker-Desktop just
makes it unavoidable because `host.docker.internal` also fails there.
