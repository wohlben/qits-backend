# Stopping a workspace deletes the container and its persistence (loses unpushed changes)

**Status:** Fixed (2026-07-22)
**Observed:** 2026-07-22
**Area:** workspaces / container lifecycle (`domain` — `WorkspaceService`, `ContainerRuntime`)

## Introduction

Related / dependent plans:

- `docs/epics/qits-workspaces/features/2026-07-04_workspace-containers.md` — the per-workspace container execution model.
- `docs/epics/qits-workspaces/features/2026-07-08_lazy-workspace-container-provisioning.md` — `ensureContainer` re-materialization; the code path that re-clones after a stop.
- `WorkspaceCheckpointService` — the committed-work durability layer that partly masks this bug for *committed* changes.

## Summary

"Stopping" a workspace should **pause** it — stop the running container while keeping the
container and its `/workspace` filesystem intact — so it can be resumed exactly where it was left.
Instead, `WorkspaceService.stopContainer` **force-removes** the container (`docker rm -f`). On next
access the workspace is re-provisioned by a **fresh `git clone`** into a brand-new container, so the
old `/workspace` filesystem is thrown away. Any working-tree state that is not a pushed commit is
lost:

- uncommitted modifications, staged changes, and **untracked files**;
- committed-but-unpushed work, whenever the best-effort pre-stop push fails (its failure is
  swallowed).

The method's own Javadoc claims it is "the one path that guarantees unpushed commits are preserved,"
but that guarantee only holds for *committed* work that the best-effort push happens to land — it
says nothing about the uncommitted working tree, which is unconditionally destroyed.

## Repro (observed behavior)

1. Start a workspace (container materializes, `/workspace` clone present).
2. Make a change in `/workspace` that is not a pushed commit — e.g. create an untracked file, or
   `git add` without committing, or commit without pushing.
3. Stop the workspace (`POST` → `WorkspaceController.stopContainer`, UI "stop").
4. Access the workspace again → `ensureContainer` re-provisions.
5. The change is gone: untracked/uncommitted work is absent; unpushed commits are absent if the
   pre-stop push failed.

## Suspected cause (code pointers)

- `domain/.../repository/control/WorkspaceService.java:1094` — `stopContainer(...)`:
  - `pushBranch(...)` at `:1100` is **best-effort and swallows failures**
    (`WorkspaceService.java:1080` — `catch (RuntimeException ignored)`), and only moves *committed*
    work anyway.
  - `containers.rm(containers.containerName(...))` at `:1105` is `docker rm -f`
    (`ContainerRuntime.rm` / `DockerExecutor`), which **deletes the container and its writable
    layer / `/workspace` clone**, not just stops it.
- `ContainerRuntime` (`domain/.../repository/control/ContainerRuntime.java`) has **no `docker stop`
  verb** — the teardown primitive is only `rm` (`docker rm -f`). `start(container)` (`:115`) already
  resumes a *present-but-stopped* container in place, keeping `/workspace`.
- `ensureContainer` (`WorkspaceService.java:924-958`) **already implements the lossless resume**: if
  `containers.exists(container)` it calls `containers.start(container)` and logs "Started the
  existing container in place (its /workspace clone is preserved)." This is exactly the behavior
  stop should feed into — but `stopContainer`'s `docker rm -f` removes the container, so
  `exists()` returns false and this branch is skipped, forcing the lossy re-clone.

So the losing and winning halves already both exist; stop is simply wired to the wrong one.

## Suggested fix direction

Make stop a genuine pause and let the existing resume path do the rest:

1. Add a `stop(String container)` verb to `ContainerRuntime` = `docker stop` (graceful SIGTERM +
   grace, no `--force`, no remove), implemented in `DockerExecutor` and emulated in
   `FakeContainerRuntime` (test doubles in each module's `src/test`).
2. Change `WorkspaceService.stopContainer` to call `containers.stop(...)` instead of
   `containers.rm(...)`. Keep the best-effort `pushBranch` as a durability backstop (belt-and-braces),
   but it is no longer the only thing standing between the user and data loss.
3. On next access, `ensureContainer`'s `exists()` → `start()` branch resumes the *same* container
   with `/workspace` intact — nothing else changes.

Leave the **discard** path (`WorkspaceService.java:1453`) on `rm` — that removal is intentionally
lossy (the branch is deleted right after; see the comment at `:1447`).

## Impact

Silent data loss on an operation whose name ("stop") strongly implies reversibility. Users lose
untracked files and any work they hadn't committed *and* pushed. Higher-severity than a crash-loss
because it happens on the deliberate, everyday "stop" action, not on an unexpected death.

## Fix applied (2026-07-22)

Implemented exactly the direction above — stop is now a genuine pause, and a second, latent bug it
uncovered was fixed too:

1. **New `stop` verb.** `ContainerRuntime.stop(container)` = `docker stop` (graceful, no remove),
   implemented in `DockerExecutor` and emulated in all three `FakeContainerRuntime` doubles (mark
   present-but-Exited, keep the `/workspace` dir).
2. **`WorkspaceService.stopContainer` calls `containers.stop(...)`** instead of `containers.rm(...)`.
   The best-effort `pushBranch` stays as a durability backstop. On next access,
   `ensureContainer`'s existing `exists()` → `start()` branch resumes the *same* container in place —
   nothing else changed there. The discard path keeps `rm` (intentionally lossy).
3. **Latent runtime-status bug fixed.** `listWorkspaces` derived `RUNNING` from
   `listWorkspaceContainers`, which uses `docker ps -a` and so lists *stopped* containers too — a
   paused (or out-of-band Exited) container would have read as `RUNNING`. Added a `running` flag to
   `ContainerRuntime.ContainerInfo` (from `{{.State}}` in `DockerExecutor`, from the `stopped` set in
   the fakes) and `listWorkspaces` now filters `runningIds` on it. This pre-existed for the
   host-restart case; the stop change would have made it fire on every stop.

## Regression tests

- `WorkspaceContainerLifecycleServiceTest.stopContainerPausesInPlaceKeepingTheWorkspaceActive` — after
  stop the container still `exists()` but is not running, status is `STOPPED`, and `ensureContainer`
  resumes it in place (`isRunning`).
- `WorkspaceContainerLifecycleServiceTest.stopContainerPreservesUncommittedWorkingTreeChanges` — an
  **untracked** file written into `/workspace` survives stop → resume (the exact loss this issue
  reported).
- `DaemonLifecycleCouplerSettleTest.stopContainerDoesNotResurrectItsSettledDaemon` — updated: "not
  resurrected" now means present-but-not-running (the paused container is kept, never restarted by
  the liveness poll).
- `WorkspaceContainerIT` (real docker, extended) — asserts a freshly-run container reads back
  `running() == true`, exercising the `{{.State}}` parse.
