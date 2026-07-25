# Persistent `/workspace` volume — survive container recreation on a named, label-tracked volume

> **Status: implemented (2026-07-25).** Shipped largely as designed below, with these settled
> choices:
> - **Name = `qits_workspace_<workspaceId>`** (the stable `workspace.workspace_id` column — the same
>   key the container name and `qits.workspace` label use), with project/repo/branch/parent in labels
>   (§2's recommended id-based scheme).
> - **`qits.project` ships in v1** on both the volume *and* the container. It is resolved inside
>   `WorkspaceContainerFactory` via the already-injected `RepositoryNameResolver` (which maps
>   `repoId → projectId`), so **no `projectId` threading through `run`/`forWorkspace` was needed** —
>   the signature-churn concern in §2/Open-questions is moot.
> - **`ensureWorkspaceVolume` is called from `DockerExecutor.run`** (§3), just before the container
>   mounts the volume, gated on `qits.workspace.persist-workspace`. Interface signatures as shipped:
>   `ensureWorkspaceVolume(repoId, workspaceId, branch, parent)`, `removeWorkspaceVolume(workspaceId)`,
>   `listWorkspaceVolumes() → List<VolumeInfo(name, projectId, repoId, workspaceId, branch)>`,
>   `workspaceVolumeName(workspaceId)`. The label set lives in `WorkspaceContainerFactory.workspaceVolumeLabels(...)`.
> - **Removal wiring** landed exactly at the §4 matrix's remove rows: `deleteContainer`, `doDiscard`,
>   the branch-gone abandon in `ensureContainer`, and `RepositoryService.delete` (which also sweeps
>   containerless volumes for the repo). The dangling-volume GC (§5) runs in `RepositoryDiscoveryService.discover()`.
> - **Test doubles:** `FakeContainerRuntime` (all 3 copies) emulates the volume as a persisted host
>   dir that survives an incidental `rm`; `FakeWorkspaceDaemonProvisioner` gained the daemon's
>   skip-clone-when-`/workspace/.git`-exists idempotency so recreation is lossless. Coverage in
>   `WorkspaceContainerLifecycleServiceTest` (recreate-preserves, delete-removes, discard-removes, GC
>   reap/spare) and the extended real-docker `WorkspaceContainerIT`.
> - **Manual acceptance** walk (real docker, packaged app): `docs/manual-acceptance-tests/workspace/persistent-workspace-volume/plan.md`.
> - **Follow-ups parked** in `docs/backlog-ideas/2026-07-25_persistent-workspace-volume-followups.md`
>   (daemon bootstrap-skip on an already-provisioned tree; idle-eviction of long-STOPPED volumes).

## Introduction

Today a workspace's checkout lives in the **container's ephemeral writable layer**: `/workspace` is
not a volume, so it dies whenever the container is `docker rm`'d — image-update recreation, a pruned
container, or the Shift-guarded "delete container" verb. The durable branch ref in the bare origin
survives, but any commit made in the container and not yet pushed (and every uncommitted working-tree
change) is lost with the layer. This feature makes `/workspace` a **named Docker volume**, created
per-workspace with a deterministic name + rich labels, so the checkout **persists across container
recreation** and is reattached on the next provision — while giving us a handle to detect and reap
**dangling volumes** whose workspace is gone.

Related / dependent plans:

- Closes the **"`/workspace` volume (anonymous today)"** open question carried forward in
  [workspace containers](../features/2026-07-04_workspace-containers.md#open-questions-carried-forward)
  (the writable-layer clone; "Commits made in a container but never pushed die with it").
- Builds on [lazy workspace-container provisioning](../features/2026-07-08_lazy-workspace-container-provisioning.md):
  provisioning is on-demand and idempotent via `ensureContainer` → `provisionContainer`. The volume
  is created/attached at that same seam, so a never-provisioned workspace and a re-provisioned one
  take the identical path.
- Rides the enabler in [autonomous self-clone on boot](../../qits-workspace-daemon/features/2026-07-23_autonomous-self-clone-on-boot.md):
  the in-container `qits-workspace-daemon` **self-provisions once and never re-clones when
  `/workspace/.git` already exists** (that feature's Idempotency note). So a persistent, already-populated
  `/workspace` volume is exactly what the daemon's reconnect path already expects — no host-side change
  to the clone is needed for recreation to reattach an existing checkout.
- Changes the contract of [delete a workspace's container](../features/2026-07-25_delete-workspace-container.md):
  that verb's documented promise ("removes the stopped container **and any uncommitted changes**;
  Start re-clones fresh") only holds if it now **also removes the volume**. This plan makes that the
  one explicitly-destructive path (see the lifecycle matrix below).
- Complements [periodic checkpoint push](../features/2026-07-05_periodic-checkpoint-push.md): checkpoint
  push shrinks the unpushed-loss window by pushing live containers; a persistent volume shrinks it
  further by surviving recreation itself. They stack.
- Follows the existing shared-volume pattern already in the code: `qits_shared_dot_claude`,
  `qits_shared_m2`, `qits_shared_pnpm` are named volumes created once at startup via
  `DockerExecutor.onStart` → `ensureVolume` and mounted by `WorkspaceContainerFactory.forWorkspace`.
  This plan generalizes that machinery to a **per-workspace, lifecycle-managed** volume.

## Problem

- `WorkspaceContainerFactory.forWorkspace` mounts only the three shared cache volumes
  (`WorkspaceContainer.volume(...)` → `-v name:mount`); `/workspace` gets no `-v`, so it is the
  container's writable layer.
- `provisionContainer` (`WorkspaceService.java:242-279`) `docker run`s the container and the daemon
  clones `/workspace` from the git host. On `containers.rm` (recreate/discard/delete/abandon/repo-delete)
  the clone is gone; the next provision re-clones from origin — **origin state only**.
- There is **no per-workspace volume** and therefore **no way to reap orphaned per-workspace disk**:
  the only volumes are the three shared ones, which are never removed.

## Design

### 1. `/workspace` becomes a per-workspace named volume

In `WorkspaceContainerFactory.forWorkspace`, add one mount alongside the shared caches:

```
container.volume(workspaceVolumeName(repoId, workspaceId), "/workspace")   // -v qits_workspace_<id>:/workspace
```

The volume masks the image's `/workspace` dir. **First mount populates the empty volume from the
image** (Docker copies the image directory's contents *and permissions* into a fresh named volume),
so the world-writable `/workspace` baked into `docker/qits/Dockerfile` carries over — the same reason
the shared cache volumes work under the arbitrary-uid container user. No permission change needed.

### 2. Naming scheme + labels — the dangling-detection handle

The user's proposal is `qits_workspace_<projectId>_<repoId>_<branchName>`. Encoding the **branch name
in the volume name is hazardous**: Docker volume names must match `[a-zA-Z0-9][a-zA-Z0-9_.-]*`, but
branch names routinely contain `/` (`feature/greeting`) and other illegal chars, so the name would
need lossy sanitization (collision-prone: `feature/x` and `feature-x` collapse), and a branch rename
would strand the old volume. **Recommendation — deterministic id-based name + rich labels:**

- **Name:** `qits_workspace_<workspaceId>` (the `workspaceId` UUID is stable, volume-safe, and 1:1 with
  the branch — it survives branch renames, and it mirrors the container name `qits-ws-<workspaceId>-<shortRepo>`).
- **Labels** (set at `docker volume create`, mirroring the container's `qits.*` labels exactly):
  `qits.managed=workspace-volume`, `qits.repository=<repoId>`, `qits.workspace=<workspaceId>`,
  `qits.branch=<branch>`, `qits.project=<projectId>` (if plumbed — see below), `qits.parent=<parent>`.

Labels — not the name — are what makes dangling detection robust and human-readable:
`docker volume ls --filter label=qits.managed=workspace-volume` lists exactly the managed volumes with
their repo/workspace/branch/project readable via `docker volume inspect`, with no charset/rename
fragility. (`qits.project` requires threading `projectId` into `run`/`forWorkspace`, which don't carry
it today — optional; repo→project is 1:1 recoverable at reconcile time, so v1 can label with
repo/workspace/branch to match the container labels and add project later.)

### 3. Manually create the volume (with labels) before `docker run`

`docker run -v name:/workspace` auto-creates the volume **but cannot set labels on it**. Because the
whole dangling-detection story depends on labels, the volume must be created explicitly first —
exactly the "manually create them first and then mount them in" the user described. Reuse the existing
pattern: a new `ensureWorkspaceVolume(repoId, workspaceId, branch, parent[, projectId])` on
`ContainerRuntime`, impl in `DockerExecutor` as `docker volume create --label ... <name>` (idempotent:
`volume create` on an existing name is a no-op that returns the name), called from `DockerExecutor.run`
just before assembling argv (it already has `repoId/workspaceId/branch/parent` in scope) — sibling to
the existing `ensureVolume`/`ensureNetwork` in `onStart`.

### 4. Volume lifecycle — the keep / remove matrix

The volume is created lazily on first provision and reattached on every subsequent one. The decision
is **only about removal**, at each `containers.rm`/teardown site in `WorkspaceService`:

| Lifecycle op | container | **volume** | rationale |
|---|---|---|---|
| `provisionContainer` / `ensureContainer` (first + re-provision) | run/create | **create-if-absent, attach** | the checkout lives here |
| `stopContainer` (`docker stop`) | stop | **keep** | pause in place |
| `start` (exited → start) | start | **keep** (already attached) | resume |
| `beginRecreateContainer` (image update, crash, prune, host-restart) | rm → run | **keep** | **the core win** — recreation now preserves the working tree; daemon skips re-clone on the populated volume |
| `deleteContainer` (Shift-guarded reclaim, keep branch) | rm | **remove** | the one explicit "clean slate / reclaim disk" verb — preserves its documented "loses uncommitted changes" contract; Start re-creates an empty volume + re-clones |
| `doDiscard` / `cleanupBranch` (delete branch, soft-delete row) | rm | **remove** | branch is gone |
| branch-gone abandon inside `ensureContainer` | (none) | **remove** | orphaned |
| `RepositoryService.delete` | rm all | **remove all** for the repo | repo gone |
| `mergeWorkspace` / `integrateBranch` / `mergeIntoTarget` | (host-side, no container) | **no-op** | integration touches the bare origin, not a container/volume |

**Removal ordering:** a volume cannot be removed while any container (even a stopped one) references it,
so every removal must `containers.rm(container)` **first**, then `removeWorkspaceVolume(...)`. All the
remove-rows above already `rm` the container, so it's a follow-on call, best-effort (log-and-continue
if the volume is missing or still busy).

**Recreate stays non-destructive by default; `deleteContainer` is the escape hatch.** This split is the
crux: incidental recreations (new image, crash recovery, host restart, self-heal after a prune) now
**preserve** work, while the user still has one deliberate, confirmed verb to force a fresh checkout.
An optional `--fresh` recreate (drop-then-recreate the volume) can be added later if a "recreate on new
image *and* reset the tree" need appears.

### 5. Dangling-volume reconciliation (GC)

Mirror `RepositoryDiscoveryService`'s container↔row reconcile with a volume sweep at startup (and/or a
maintenance tick): list `docker volume ls --filter label=qits.managed=workspace-volume`, and for each,
if there is **no ACTIVE `Workspace` row** for its `qits.workspace` label (and no live container holding
it), `docker volume rm` it. This reaps volumes left by crashes, manual `docker rm`, or older builds.
New `ContainerRuntime` methods: `listWorkspaceVolumes()` → `List<VolumeInfo(name, workspaceId, repoId, branch)>`
and `removeWorkspaceVolume(repoId, workspaceId)`. Guard: never remove a volume that a running container
references (the reconcile already knows the live-container set); log every reap.

### 6. Daemon / bootstrap interaction (mostly free)

The daemon's self-clone is **already idempotent**: it skips clone when `/workspace/.git` exists
(reconnect after restart). So on a reattached volume the daemon proceeds straight to config-read →
bootstrap → daemon-start against the existing checkout, and on a fresh volume it clones as today —
**no host-side clone change**. One thing to watch (follow-up, not blocking): the bootstrap chain
(`install`/`migrate`/`seed`) re-runs on each provision; with a persisted tree it re-runs against an
already-installed workspace. That's the daemon's concern and generally idempotent (and cheaper now that
`node_modules`/build output persist), but a "skip bootstrap if the tree is already provisioned" guard
may be worth a separate daemon-side note.

### 7. Config

- `qits.workspace.workspace-volume-prefix` (default `qits_workspace_`) — volume name prefix.
- `qits.workspace.persist-workspace` (default `true`) — feature flag; `false` restores the current
  ephemeral-layer behavior (no `-v /workspace`, no per-workspace volume lifecycle), so the change is
  reversible per-deployment while it beds in.

Both in `service/src/main/resources/application.properties` and the `cli` copy, read in
`WorkspaceContainerFactory` / `DockerExecutor` next to the existing `qits.workspace.*` volume props.

## Files to change

- `domain/.../repository/control/ContainerRuntime.java` — add `ensureWorkspaceVolume`,
  `removeWorkspaceVolume`, `listWorkspaceVolumes`, `workspaceVolumeName`, `VolumeInfo`.
- `domain/.../repository/control/DockerExecutor.java` — impl the above (`docker volume create --label`,
  `docker volume ls --filter label=`, `docker volume rm`); call `ensureWorkspaceVolume` in `run`
  before argv assembly; read the new config.
- `domain/.../repository/control/WorkspaceContainerFactory.java` — `container.volume(workspaceVolumeName(...), "/workspace")`
  in `forWorkspace`, gated by `persist-workspace`.
- `domain/.../repository/control/WorkspaceService.java` — call `removeWorkspaceVolume` at the remove
  rows of the matrix (`deleteContainer`, `doDiscard`, branch-gone abandon in `ensureContainer`);
  **do not** remove in `beginRecreateContainer`/`stopContainer`.
- `domain/.../repository/control/RepositoryService.java` — `delete` sweeps the repo's workspace volumes
  after removing containers.
- `domain/.../repository/control/RepositoryDiscoveryService.java` (or a small new reconciler) — the
  dangling-volume GC in §5.
- `service` + `cli` `application.properties` — the two new `qits.workspace.*` props.
- **Tests** — `FakeContainerRuntime` (all three copies: `domain`/`service`/`cli` `src/test`): emulate a
  volume as a host directory keyed by name (create/list/remove; reattach = reuse the dir so
  `/workspace` content survives a fake `rm`+re-`run`). Add to `WorkspaceContainerLifecycleServiceTest`:
  a commit-in-container → `beginRecreateContainer` → **checkout survives** (volume kept); `deleteContainer`
  → volume removed, Start re-creates empty; `doDiscard` → volume removed; a dangling-volume reconcile
  test (volume with no row is reaped, one with a running container is spared).
- **Extended IT** — `service` `WorkspaceContainerIT` (real docker): `docker volume` create/label/mount
  round-trip, persistence across a real `rm`+re-`run`, and `volume rm` on delete.
- **Docs** — update the workspace-containers "open questions carried forward" entry (no longer
  anonymous/ephemeral) and the delete-workspace-container feature's contract note (now also removes the
  volume). Move this file to `../features/YYYY-MM-DD_persistent-workspace-volume.md` on landing and
  tick the epic.

## Build sequence

1. `ContainerRuntime`/`DockerExecutor` volume verbs + `FakeContainerRuntime` emulation (no behavior
   change yet). Green.
2. Mount `/workspace` from the per-workspace volume in `forWorkspace` (flag-gated), create-with-labels
   in `run`. Provision now attaches a labeled volume; recreate reattaches it (verify the daemon's
   skip-re-clone path). Add the "recreate preserves checkout" test.
3. Wire removals into the matrix's remove rows (`deleteContainer`, `doDiscard`, abandon,
   `RepositoryService.delete`); assert keep-on-recreate/stop.
4. Dangling-volume GC in reconcile + test.
5. Real-docker IT; docs + epic update; config defaults.

## Open questions / risks

- **Name vs. the user's `..._projectid_repoid_branchname` scheme.** Recommendation above uses the stable
  `workspaceId` in the name and puts project/repo/branch in **labels** (robust to `/` and renames). If a
  human-readable *name* is still wanted, add a sanitized, collision-checked branch suffix — but labels
  should remain the reconcile key.
- **Persistence changes the disposability contract.** Containers were "recreatable caches"; `/workspace`
  is now durable across recreation. `deleteContainer` becoming the sole tree-reset verb must be
  reflected in its dialog copy and the manual-acceptance plan.
- **`deleteContainer` volume removal is destructive** and gated only by the existing type-the-branch
  confirm — verify that guard is deemed sufficient for also dropping the persisted tree.
- **Volume leak on abrupt qits death** between `containers.rm` and `removeWorkspaceVolume`: covered by
  the §5 GC, but the reconcile must run early enough to reap before disk pressure.
- **`projectId` plumbing** into `run`/`forWorkspace` for the `qits.project` label — optional for v1;
  decide whether to thread it now or resolve project at reconcile time from `qits.repository`.
- **Disk growth.** Per-workspace volumes accumulate; the GC handles orphans, but a large fleet of ACTIVE
  workspaces now holds N full checkouts on disk. A future idle-eviction (remove the volume of a
  long-STOPPED workspace, re-clone on next Start) may be worth a backlog note.
</content>
</invoke>
