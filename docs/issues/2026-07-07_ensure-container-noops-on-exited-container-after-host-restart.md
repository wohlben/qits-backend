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
