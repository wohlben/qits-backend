# Delete a workspace's container (keep the branch) — a Shift-guarded teardown on the Start button

## Introduction

A workspace's container is a **recreatable cache of its durable branch**. Stopping a workspace
(`stopContainer`) pauses it in place with `docker stop`, so the (now exited) container — and the disk
of its `/workspace` clone — lingers until the workspace is started again or abandoned. There was no
way to reclaim that stopped container's disk **without also throwing the branch away**: the only
teardown that runs `docker rm` was discard/Abandon, which deletes the branch and soft-deletes the
workspace row.

This feature adds a **container-only delete**: on a stopped/failed workspace in the repository detail
route's branch list, holding **Shift** turns the **Start** button into a **Delete** button that
removes just the container (`docker rm`) **and its persistent `/workspace` volume**, keeping the
branch ref and the ACTIVE workspace row — the next **Start** re-creates an empty volume and re-clones
a fresh container from the branch. Because it is destructive of any uncommitted working-tree state
(and unpushed commits) left in the stopped container, it is guarded by a confirmation dialog that
requires the user to **retype the branch name** before the delete fires.

> **Contract update (persistent `/workspace` volume).** Since
> [persistent-workspace-volume](2026-07-25_persistent-workspace-volume.md) made `/workspace` a
> per-workspace named volume, an incidental **recreate** (image update, crash, prune, host restart)
> now *preserves* the checkout. That makes **delete-container the one deliberate reset**: it is the
> only lifecycle verb that removes the volume, so it is now the sole way to force a fresh checkout
> and reclaim a workspace's disk. Its "loses uncommitted changes" promise therefore holds *because*
> it drops the volume.

Related / dependent plans:

- Extends [workspace containers](2026-07-04_workspace-containers.md) (containers as the execution
  unit, `ContainerRuntime.rm` vs `stop`) and
  [lazy workspace-container provisioning](2026-07-08_lazy-workspace-container-provisioning.md)
  (`ensureContainer` as the re-materialization seam that Start uses to recreate the deleted
  container from the branch).
- Sits alongside the graceful [disposable workspace containers](2026-07-04_disposable-workspace-containers.md)
  stop/start lifecycle; this is the third container-lifecycle verb (delete) next to start and stop,
  and is **distinct from discard/Abandon**, which additionally deletes the branch and soft-deletes
  the row.

## Behaviour

- **Where.** The per-branch Start button in the repository detail route's branch list
  (`branch-row.component.ts`), shown when a workspace is not RUNNING and not PROVISIONING (i.e.
  STOPPED or FAILED).
- **Modifier.** While **Shift** is held, that button becomes a red **Delete** (label + destructive
  styling). Shift state is tracked from window key events (reset on window blur so a missed keyup
  can't strand the button), so the affordance appears without needing a prior click.
- **Confirmation.** Clicking Delete opens a "Delete container?" dialog explaining that the stopped
  container (and any uncommitted changes in it) is removed while the branch and workspace are kept.
  The confirm button stays disabled until the user types the exact branch name.
- **Effect.** Removes the container (`docker rm`) **and its persistent `/workspace` volume**
  (`docker volume rm`, after the container so docker doesn't refuse an in-use volume), leaves the
  workspace ACTIVE / `STOPPED` with no runtime error; Start re-creates an empty volume and re-clones
  from the branch (losing uncommitted working-tree state and unpushed commits). Unlike an incidental
  recreate — which now *keeps* the volume and reattaches the checkout — this is the deliberate reset.
  The branch is **never** deleted — that remains Abandon's job.

## Implementation

- **Backend.**
  - `WorkspaceService.deleteContainer(repoId, workspaceId)` — settles live daemons
    (`containerEvents.fireStopping(..., false)`), `containers.rm(containerName)`,
    `containers.removeWorkspaceVolume(workspaceId)` (the persistent-volume drop; after `rm`), and
    marks the workspace `STOPPED` with a cleared `runtimeError`. Mirrors `stopContainer` but uses
    `rm` + volume-remove instead of `stop`, and does not touch the branch or the row.
  - `WorkspaceController` — `POST /api/repositories/{repoId}/workspaces/{workspaceId}/delete-container`,
    a thin passthrough returning the refreshed `WorkspaceDto` (the counterpart to `stop-container`).
- **Frontend.**
  - `branch-row.component.ts` — window Shift tracking (`host` key listeners → a `shiftHeld` signal),
    a `deleteContainer` output, and the Shift-swapped Delete button.
  - `branch-tree.component.ts` — passes the `deleteContainer` output through.
  - `branch-list.component.ts` — the type-the-branch-name confirm dialog (`#deleteContainerTpl`,
    gated by a `deleteContainerConfirmed` computed) and the `deleteContainerMutation`.
- **Tests.** `WorkspaceContainerLifecycleServiceTest`:
  - `deleteContainerRemovesTheContainerButKeepsBranchAndWorkspace` — container gone, branch + ACTIVE
    row kept, Start recreates it.
  - `deleteContainerFiresStoppingImmediatelyBeforeRm` — one immediate (non-graceful) stopping event,
    fired while the container still exists.
  - `deleteContainerOnAnUnknownWorkspaceIs404` — unknown workspace throws `NotFoundException`.
