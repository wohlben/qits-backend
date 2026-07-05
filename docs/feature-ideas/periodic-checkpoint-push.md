# Periodic checkpoint-push: bound the unpushed-work loss window

## Introduction

Follow-up to [disposable workspace containers](../features/2026-07-04_disposable-workspace-containers.md),
which made a lost container a non-event by recreating it from the durable branch — but recreation
restores **origin state only**, so commits made in a container and never pushed die with it. That
feature closes the *graceful* case (the live-container guard + `stopContainer` pushing before removal);
this idea closes the *ungraceful* case (host reboot, `docker rm`, a crash) by periodically pushing the
container's branch to origin so an unexpected death loses at most one interval of work.

Related / dependent plans:

- **Parent feature**: [disposable-workspace-containers](../features/2026-07-04_disposable-workspace-containers.md)
  — this is the "§D checkpoint-push" open question it explicitly deferred. Reuses that feature's
  `pushBranch` helper and the durable-branch-is-truth model.
- Builds on the container lifecycle from
  [workspace-containers](../features/2026-07-04_workspace-containers.md) (the `docker exec … git push`
  path over the in-process `/git` server).
- Interacts with the **ahead/behind** UI and reconciliation from
  [repository-discovery](../features/2026-05-01_repository-discovery.md): checkpoint pushes move the
  origin ref, so they change what the branch tree reports as pushed.

## The problem

`/workspace` lives only in the container. Between the moments an agent commits and the next time
something pushes (an integrate/fast-forward/graceful-stop), those commits exist **only** in the
container. If the container dies unexpectedly in that window, `ensureContainer` recreates it from
origin and the commits are gone — silently. The `canCleanupBranch` "fully pushed" invariant guards
*cleanup*, but nothing guards *unexpected* loss.

## Proposed design

A background checkpoint that periodically pushes each running container's branch to origin.

- **A scheduler** (a periodic task, cadence configurable via `qits.workspace.checkpoint-interval` —
  e.g. off by default or a few minutes) iterates running workspace containers and runs the existing
  best-effort `pushBranch(repoId, workspaceId)` for each. Best-effort: a failed checkpoint must never
  disrupt the container or the user.
- **Push only when ahead**: skip the push when the container's HEAD already matches the origin ref
  (no new commits), to avoid needless pushes and ref churn.
- **Only RUNNING containers** with a live branch; skip STOPPED/PROVISIONING/FAILED.
- Optionally scope to containers with **uncommitted-then-committed** work — i.e. only those whose HEAD
  is ahead of origin — which the ahead-check already covers.

## Open questions

- **Cadence vs. noise.** Frequent pushes bound the loss window tightly but churn origin refs and can
  make the ahead-behind UI flicker (a branch briefly shows 0-ahead right after a checkpoint). Slower
  cadence is quieter but loses more on a crash. Likely: a modest default (a few minutes) or opt-in.
- **Per-workspace vs. global schedule.** One timer sweeping all containers is simpler; per-workspace
  timers align better with activity but multiply state.
- **Push semantics.** A plain `git push origin <branch>` from the container is the obvious choice
  (same as `stopContainer`); consider whether a checkpoint should ever force-push (it should not —
  the branch only moves forward while a single container owns it).
- **Interaction with in-flight agent commits.** Pushing mid-agent-run is safe (git push is atomic
  per-ref), but a checkpoint racing a user-triggered integrate should be harmless — both just move the
  ref forward.

## Testing sketch

- **Fake runtime**: with a container ahead of origin, the checkpoint pushes and origin advances to the
  container HEAD; with a container level with origin, the checkpoint is a no-op (no push). Because
  `FakeContainerRuntime` runs real host git, the push is genuinely exercised.
- **Loss-window regression**: after a checkpoint, a `docker rm -f` + `ensureContainer` recovers the
  checkpointed commit (contrast the parent feature's `WorkspaceRecreateIT`, which asserts an
  *un*checkpointed commit is lost).
- **Noise guard**: assert no push happens when HEAD == origin ref, so idle containers don't churn refs.
