# Daemon-driven working-tree status — clean/dirty reported over the socket, host watcher removed

## Introduction

Two things were true before this feature:

1. qits had **no visible signal of whether a workspace had uncommitted work.** The daemon already
   computed a `dirty` flag (`WorkspaceDescriber` → `WorkspaceInfo`), but only as a Part-1
   request/reply stub consumed by nothing.
2. Working-tree **change detection ran host-side**: `WorkspaceWatchService` shelled a
   `docker exec inotifywait` into every workspace container, coalesced bursts, computed a
   `WorkingTreeMarker`, and fired the SSE `FILES` hint so `/files` + `/detection` refetch (see the
   now-superseded [live working-tree freshness](../../qits-workspaces/features/2026-07-12_detection-live-freshness-sse.md)).

Both cut against this epic's thesis — **invert reachability so the container dials home**. This
feature makes the in-container `workspace-daemon` the **sole** working-tree change detector: on boot
it reports the workspace's clean/dirty status over the existing control socket, then watches for
changes and re-reports; qits caches it and surfaces a **Clean/Dirty badge** in the branch tree. The
host-side `inotifywait` monitoring is **removed**, and the `FILES` refetch trigger is **re-homed**
onto the daemon's report.

Related / dependent plans:

- **Part of [qits-workspace-daemon](../epic.md)** — another host-driven `docker exec` path (the
  per-workspace `inotifywait`) moves onto the socket; consistent with the provisioning-inversion
  track. Reuses the daemon's `WorkspaceDescriber.parse` and the registry's SPI/hint machinery.
- **Supersedes the trigger of
  [detection live freshness](../../qits-workspaces/features/2026-07-12_detection-live-freshness-sse.md)**
  — the `FILES` hint / `files` topic / marker / generation-token design is unchanged; only *who
  fires* `FILES` moved from the host watcher to the daemon report. That doc carries a superseding
  banner.
- **Rides the SSE fan-out** ([workspace SSE live updates](../../qits-workspaces/features/2026-07-07_workspace-sse-live-updates.md)):
  adds one new topic `GIT_STATUS`/`git-status` on the **repository** channel for the badge, alongside
  the re-homed `FILES` on the workspace channel.

## What was built

### Protocol — a new unsolicited `GitStatus` (workspace-daemon-protocol)

`GitStatus{workspaceId, clean, head}` — pushed **unsolicited** (boot, every reconnect, and on each
working-tree-marker move). Deliberately **not** an overload of `WorkspaceInfo`, which is FIFO-matched
to a `Describe`: an unsolicited `WorkspaceInfo` would be dropped or wrongly satisfy a concurrent
`describe()` future. Added to `DaemonMessage` permits, `DaemonProtocol` (`Type.GIT_STATUS`,
`Field.CLEAN`), and both `DaemonCodec` arms (compiler-forced by the exhaustive switches).

### Daemon — `GitStatusMonitor` (workspace-daemon)

`GitStatusMonitor` mirrors the removed host `WorkspaceWatchSession`, but forks `inotifywait`
**directly** in-container (no `docker exec`; cwd `/workspace`, like `Provisioner`/`WorkspaceDescriber`
fork git locally):

- `start()` emits the initial (boot) report, then forks
  `inotifywait -m -r -q -e modify,create,delete,move,close_write --exclude <regex> /workspace`;
  stdout is read on a daemon thread, each line opening one coalescing window
  (`qits.workspace-daemon.git-status.coalesce-ms`, default 250ms).
- **Dedup on the full working-tree marker** — `sha256(git status --porcelain=v2 --branch -uall + " "
  + git diff)`, its own copy of the domain `WorkingTreeMarker` algorithm. A report fires only when the
  marker moves; the `clean`/`head` fields come from reusing `WorkspaceDescriber.parse`. Deduping on
  the *marker* (not the boolean) preserves the `FILES` signal on a **dirty→dirty content edit** (a
  second file touched while already dirty) that a bare boolean would swallow.
- **Catching commits without git hooks** — a `git commit` touches only `.git/index`/`HEAD`/`refs`,
  never a work-tree file, so those stay watched; the noisy `.git/objects`/`.git/logs` and the heavy
  build dirs (`node_modules`, `target`, `dist`, `build`, `.angular`, `.gradle`) are excluded. Residual
  `.git` churn is harmless because of the marker dedup. **No git hooks are installed.**
- `reportCurrent()` re-sends the last report on every socket reconnect (`ControlSocket.onConnected`,
  beside `services::reportAll`), so a qits restart that lost its cache self-heals in one round-trip.

`ControlSocket` starts the monitor at the tail of `startProvisioning` (after `runBootstrapOnBoot`,
gated on `provisioned`) and closes it in `@PreDestroy`.

### Host — cache, SPI, and the two re-homed hints (service + domain)

`WorkspaceDaemonRegistry` now `implements WorkspaceGitStatus` (a new framework-free `domain` SPI,
`Optional<Boolean> isClean(workspaceId)`), caches the flag in an in-memory `ConcurrentHashMap`
(RUNNING-only; cleared on `unregister`; re-reported on reconnect — no DB migration), and on each
`GitStatus`:

- **always** fires `WorkspaceChangeHint.Topic.FILES` on `(repoId, workspaceId)` — the re-homed host
  trigger, so `/files` + `/detection` still refetch;
- fires the new `Topic.GIT_STATUS` on `(repoId, null)` (repository channel) **only when the flag
  actually flipped**, so a dirty→dirty edit nudges `FILES` without re-invalidating the whole list.

`WorkspaceDto` gains a nullable `Boolean clean` (null ⇒ unknown ⇒ no badge), set in
`WorkspaceService.listWorkspaces` only for RUNNING workspaces via an `Instance<WorkspaceGitStatus>`
(empty in cli/tests).

### Frontend (service/src/main/webui)

`repository-live.service.ts` maps the `git-status` topic → `['workspaces', repoId]`;
`branch-row.component.ts` renders a second `z-badge` (Clean/`secondary`, Dirty/`outline`) beside the
runtime badge, shown only when `wt.clean != null`. OpenAPI regenerated (both committed copies synced),
API client regenerated.

### Removed

`WorkspaceWatchService`, `WorkspaceWatchSession`, their tests
(`WorkspaceWatchServiceTest`/`WorkspaceWatchKillSwitchTest`/`WorkspaceWatchIT`), and the
`qits.workspace.watch.*` config. `WorkingTreeMarker` **stays** in `domain` (still used by
`DetectionService`/`ComponentMapService`/`WorkspaceTreeFingerprint`); the daemon holds its own copy.

## Testing

- **Protocol** — `DaemonCodecTest` round-trips `GitStatus` (both clean states).
- **Daemon** — `GitStatusMonitorTest` drives the package-private `settle(status, diff)` seam: boot
  report, clean↔dirty flips, no-op on unchanged marker, dirty→dirty content-edit still reports,
  `reportCurrent` replay.
- **Host** — `DaemonControlSocketTest` feeds a `GitStatus` frame: `isClean` caches it, `FILES` fires
  on the workspace channel every time, `GIT_STATUS` fires on the repository channel only on a flag
  change, and disconnect evicts the cache.
- **Domain** — `WorkspaceContainerLifecycleServiceTest` asserts `WorkspaceDto.clean` is populated only
  while RUNNING + reported (via a `@Mock FakeWorkspaceGitStatus`), null otherwise.
- **Frontend** — `repository-live.service.spec` maps `git-status` → `['workspaces', repoId]`;
  `branch-row.component.spec` renders Clean/Dirty and hides the badge when null.
