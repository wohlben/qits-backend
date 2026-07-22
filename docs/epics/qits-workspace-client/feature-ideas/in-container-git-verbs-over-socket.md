# In-container git verbs over the `clientd` socket

## Introduction

Part 4 of [qits-workspace-client](../epic.md). **Out of scope until
[Part 1](clientd-binary-and-control-socket.md) lands.** Delegates the workspace-local git verbs —
fetch, ff-only merge of the parent, push, `rev-parse HEAD`, submodule wiring, and the initial
clone — from host-side `docker exec git …` to `clientd`, which runs them in-container against
`/workspace` and reports results over the socket.

Related/dependent plans:

- **Hard dependency** — [Part 1](clientd-binary-and-control-socket.md) (socket + envelope).
- **Relates to** [Part 2](command-execution-over-socket.md) — some of these could ride the
  generic `RunCommand` seam, but git verbs carry structured results (ahead/behind, conflict,
  new HEAD) worth their own typed messages rather than parsing stdout on the host.
- **`GitExecutor` stays the host-side mutator of bare origins** — this part only re-homes the
  *in-container* git that today runs via `docker exec`, not the host-side bare-origin operations
  (`GitExecutor`) or the JGit git host (`GitHostRoutes`). The clone still targets
  `http://<qitsHost>:<port>/git/<repoId>`; only *where the `git` process runs* changes.

## The current surface (what moves)

- **`WorkspaceService.containerGit()` (`WorkspaceService.java:112`)** — wraps
  `containers.exec(container, "/workspace", …, "git", …)`. Callers:
  - `mergeParentIntoWorkspace` (`:1360`) — fetch + ff-only + merge/abort (raw `containers.exec`
    at `:1366-1377`).
  - checkpoint/stop push paths (`:1052`).
  - `git rev-parse HEAD` HEAD snapshots (via `CommandService.prepare` `:545` and elsewhere).
- **The initial clone** in `provisionContainer` (`:201`) — `git clone --branch <branch>
  <cloneUrl> /workspace` + `wireSubmodules` (`:255`). Once `clientd` is PID 1, the clone can
  become `clientd`'s **first job on boot** (it knows its identity + clone URL), removing the
  host-driven `docker exec git clone` step from provisioning entirely.

## Scope

- Add typed git messages: `GitFetch`, `GitMergeParent { parentBranch }` → `MergeResult
  { status: FF|MERGED|CONFLICT|UP_TO_DATE }`, `GitPush`, `GitHead` → `{ sha }`, `GitClone
  { url, branch }`, `SubmoduleWire`.
- `clientd` runs them in-container; `WorkspaceService` calls the socket when a client is live,
  **falls back to `docker exec`** otherwise.
- Consider making the initial clone `clientd`-driven on boot (provisioning writes only the
  branch ref + STOPPED row, as today; `clientd` materializes `/workspace` when it starts) — a
  natural simplification of `provisionContainer`, but gated on the degradation contract.

## Out of scope

- Host-side `GitExecutor` / bare origins / the JGit host (`GitHostRoutes`) — unchanged.
- Command execution (Part 2), file access (Part 3), daemons (Part 5), MCP (Part 6).

## Testing

- Structured merge/fetch/push results against a fake client; the divergence tests must still
  **push** so origin-side probes see commits. Regression on `mergeParentIntoWorkspace`,
  checkpoint push, and provisioning.
