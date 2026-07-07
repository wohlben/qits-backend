# ensure-container no-ops on an exited container — daemon start 500s after a host/docker restart

## Introduction

Found while walking a fresh starter through the
[integration guide](../feature-ideas/quarkus-angular-integration-guide.md) (Tier 5), after a
WSL2/docker restart mid-walk. Related plans:
[workspace containers](../features/2026-07-04_workspace-containers.md) (owns
`ensureContainer`/`ContainerRuntime`), [daemons](../features/2026-07-04_daemons.md) (the launch
path that hits the failure), [disposable workspace containers](../features/2026-07-04_disposable-workspace-containers.md)
(the recreate semantics the fix should reuse).

## Observed repro

1. Have a workspace with a provisioned container (daemon optional). Restart the docker host
   (here: WSL2 restart) — all qits containers show `Exited (255)` in `docker ps -a`.
2. `POST /api/repositories/{repoId}/workspaces/{ws}/ensure-container` → **200**, but the
   container stays `Exited`; the workspace's `runtimeStatus` is stamped `RUNNING`.
3. `POST …/daemons/{id}/start` → **500** `ArcUndeclaredThrowableException` rooted in
   `JdbcSQLIntegrityConstraintViolationException: NULL not allowed for column "COMMIT_HASH"`
   (the `command` insert in `CommandLifecycleService.createRunning`, via
   `CommandService.prepare` → `beginDaemonRun`).

## Cause

`WorkspaceService.ensureContainer` (`WorkspaceService.java:599`) short-circuits on
`containers.exists(container)` — and `DockerExecutor.exists` (`DockerExecutor.java:152`) is
`docker container inspect`, which succeeds for **exited** containers too. An exited container
therefore counts as "already running — nothing to provision" (the code comment says the intent
is a *live*-container guard), the workspace is stamped `RUNNING`, and nothing restarts it.

Downstream, the daemon launch probes the workspace HEAD with a `docker exec` git call against
the dead container; the probe fails, the commit hash comes back null, and the `command` row
insert violates the `NOT NULL` constraint — surfacing as an opaque 500 far from the real cause.

## Suggested fix direction

Make the guard state-aware: `exists` → an `isRunning` check
(`docker container inspect -f '{{.State.Running}}'`), with an exited-but-present container
either `docker start`ed (cheap, keeps the clone + caches) or removed and re-provisioned (the
disposable-container philosophy; loses nothing that wasn't pushed, but also silently discards
uncommitted work — prefer `docker start` for that reason). Also worth hardening the daemon
launch path to fail with a clear "workspace container is not running" error instead of the
commit-hash constraint violation.

## Workaround

`POST …/stop-container` (removes the dead container) then `POST …/ensure-container`
(re-provisions from the branch) — i.e. the recreate flow; note it re-clones, so in-container
uncommitted state is lost (it already was, in effect).

## Resolution (2026-07-07)

Made the `ensureContainer` guard **state-aware**, per the suggested direction — resolved in
`WorkspaceService`, `ContainerRuntime`, `DockerExecutor`, and the three `FakeContainerRuntime`
copies:

- **New runtime capability.** `ContainerRuntime` gains `isRunning(container)` (docker
  `container inspect -f '{{.State.Running}}'` — true only for a *live* container, unlike `exists`'s
  bare `inspect`) and `start(container)` (docker `start`, throws on failure). `DockerExecutor`
  implements both; the fakes model an `Exited` container with a `stopped` set (`run`/`start` clear
  it, `rm` drops it, a `markExited` test hook adds to it).
- **Guard fix.** `WorkspaceService.ensureContainer` now short-circuits on `isRunning`, not
  `exists`. A present-but-stopped container (the host/docker-restart `Exited` case) takes a new
  middle branch: `docker start` it **in place** — lossless, keeps the `/workspace` clone and any
  unpushed commits — rather than treating it as already-provisioned (the bug) or re-cloning. The
  branch-gone abandonment path is unchanged and now only reached when the container is truly absent.

This makes the daemon-launch 500 disappear at the root: after `ensure-container` the container is
actually running, so the HEAD probe returns a real commit hash and the `command` insert no longer
violates `COMMIT_HASH NOT NULL`.

Regression test: `WorkspaceContainerLifecycleServiceTest`
`ensureContainerRestartsAnExitedContainerInPlaceKeepingUnpushedWork` — commits unpushed work in the
container, `markExited`s it, then asserts `ensureContainer` brings it back `RUNNING` with the
unpushed commit still at HEAD (proving start-in-place, not re-clone). Full `domain`/`service`/`cli`
suites green.

### Deferred

The issue's secondary "also worth" — hardening the daemon-launch path itself to fail with a clear
"workspace container is not running" error instead of the opaque `COMMIT_HASH` constraint
violation — is **not** done here (the guard fix removes the trigger). Left as defense-in-depth for
any *other* path that could probe a dead container; parked rather than built, since no current
caller reaches `beginDaemonRun` against a non-running container after this fix.
