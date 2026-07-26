# Daemon disconnect evicts cached agent activity without firing an AGENT_ACTIVITY hint

## Introduction

Found while extending the agent-activity SSE fan-out to the repository and global channels (the
agent-activity bar on the repository/project detail routes, building on the
[workspace-containers](../epics/qits-workspaces/features/2026-07-04_workspace-containers.md)
daemon control socket). Concerns `WorkspaceDaemonRegistry` and every consumer of
`WorkspaceDto.agentActivity`: the workspace detail Agents-tab chip/dot, and the
`WorkspaceActivityBarComponent` mounted on the workspace, repository, and project detail routes.

## Observed

With a live agent session showing "Cooking…" in the activity bar, stop the workspace container (or
otherwise kill the in-container `workspace-daemon`, e.g. a container crash). The bar and the
Agents-tab chip keep showing the stale BUSY state until something else invalidates the
`['workspaces', repoId]` query (another workspace's hint, a window refocus, a page remount) — no
SSE hint announces the eviction.

## Suspected cause

`WorkspaceDaemonRegistry.unregister` (the `@OnClose`/replacement path) drops every cached
`ActivityEntry` for the workspace:

```java
agentActivity.values().removeIf(entry -> entry.workspaceId().equals(workspaceId));
```

but — unlike `onAgentActivity`, which fires `AGENT_ACTIVITY` on the workspace + repository +
global channels whenever the rollup flips — fires no hint at all. The rollup effectively flips
from BUSY/WAITING/IDLE to "none" (the DTO's `agentActivity` reads null once the cache is empty)
without telling any subscribed browser. Same latent gap for `gitClean.remove(workspaceId)` there
(the dirty badge can go similarly stale, though it merely disappears rather than lying).

## Suggested fix direction

In `unregister`, when `removeIf` actually removed entries (i.e. the rollup was non-null before),
fire the same three-channel `AGENT_ACTIVITY` fan-out `onAgentActivity` uses. The repoId is
available on the evicted `DaemonConnection` (`client.repoId`, set at `Hello`); guard for the
pre-`Hello` null. Optionally mirror a repository-channel `GIT_STATUS` hint for the evicted
`gitClean` flag in the same breath. Add a `DaemonControlSocketTest` case: report BUSY, close the
peer, await the disconnect hints.
