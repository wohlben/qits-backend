# Persistent `/workspace` volume follow-ups: bootstrap-skip on a provisioned tree, idle volume eviction

## Introduction

[Persistent `/workspace` volume](../epics/qits-workspaces/features/2026-07-25_persistent-workspace-volume.md)
shipped: `/workspace` is now a per-workspace named Docker volume that survives container recreation,
with a startup dangling-volume GC. This parks the two non-blocking follow-ups called out in that
feature's §6 and Open-questions, phrased as changes to its **already-implemented** code
(`WorkspaceContainerFactory`/`DockerExecutor` volume verbs, the in-container `qits-workspace-daemon`
boot chain, `RepositoryDiscoveryService.reconcileWorkspaceVolumes`).

Related / dependent plans:

- `docs/epics/qits-workspaces/features/2026-07-25_persistent-workspace-volume.md` — the landed feature both items modify.
- `docs/epics/qits-workspace-daemon/features/2026-07-23_autonomous-self-clone-on-boot.md` — the daemon boot chain item 1 guards.
- `docs/epics/qits-workspaces/features/2026-07-08_lazy-workspace-container-provisioning.md` — the `ensureContainer` re-provision seam both items ride.

## 1. Skip the bootstrap chain when the tree is already provisioned

**Change**: the in-container daemon already skips its *self-clone* when `/workspace/.git` exists (the
reattached-volume reconnect path). But the **bootstrap chain** (`install`/`migrate`/`seed`) still
re-runs on every provision — now against an already-installed, persisted tree (with `node_modules` and
build output already present on the volume). Add a daemon-side "already provisioned" guard: on boot,
if `/workspace/.git` exists **and** a provisioned-marker is present (e.g. a `.qits/provisioned` stamp,
or a heuristic like an existing `node_modules`/`target`), skip the chain (or run only an incremental
step) instead of re-running it wholesale. Generally idempotent today and cheaper now that caches
persist, but a large chain re-run on every recreate is wasted work.

**Trigger**: the first workspace whose bootstrap chain is slow or non-idempotent enough that
re-running it on a recreate is visibly wrong (a re-seed that duplicates rows, or a multi-minute
`install` on every image update).

## 2. Idle-eviction of long-STOPPED workspace volumes

**Change**: per-workspace volumes accumulate — a fleet of N ACTIVE-but-idle workspaces now holds N
full checkouts on disk (the GC only reaps volumes with **no** ACTIVE row, not idle-but-live ones). Add
an opt-in idle-eviction: a maintenance tick that `removeWorkspaceVolume`s the volume of a workspace
STOPPED longer than a configurable threshold (the row stays ACTIVE; the next **Start** re-creates an
empty volume and re-clones from the branch — lossy for unpushed work, so gate on "clean/pushed" or
make it opt-in per deployment). Mirrors `deleteContainer`'s volume-drop but automated and
time-based. Wire it next to `RepositoryDiscoveryService.reconcileWorkspaceVolumes` with a
`qits.workspace.volume-idle-evict-*` config.

**Trigger**: disk pressure from accumulated ACTIVE-workspace volumes on a real multi-workspace
deployment (the GC handles orphans, but not the live-but-idle long tail).
