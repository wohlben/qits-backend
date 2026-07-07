# Lazy workspace-container provisioning — decouple workspace/repo creation (and seeding) from Docker + the running service

## Introduction

Today creating a workspace (or adding a repository, which creates its main workspace) **eagerly** runs
a Docker container and `git clone`s the branch into it from qits' in-process git server. That makes
`createWorkspace` require docker **and** the `service` HTTP server running — which is why `cli seed`
can't run standalone and why `.devcontainer/postcreate.sh` has to boot the service, wait for
readiness, seed, and stop it.

This plan makes container provisioning **lazy**: creation only writes the durable state (a branch ref
in the bare origin + the `Workspace` row), and the container is materialized on **first use** by the
already-existing `WorkspaceService.ensureContainer`. Seeding then becomes pure host-side data setup
(no docker, no running service), and a workspace whose container was pruned for any reason
self-heals on next access — uniformly with a never-provisioned one.

Related / dependent plans:

- Extends [workspace containers](../features/2026-07-04_workspace-containers.md) and
  [disposable workspace containers](../features/2026-07-04_disposable-workspace-containers.md): those
  established containers as the execution unit and `ensureContainer` as the re-materialization seam;
  this plan finishes the job by removing the last *eager* creation sites.
- Builds directly on the state machine hardened in
  [resolved: ensureContainer no-ops on an exited container after host restart](../issues/resolved/2026-07-07_ensure-container-noops-on-exited-container-after-host-restart.md)
  (`isRunning`/`start`/`exists` on `ContainerRuntime`).
- Removes the coupling documented in CLAUDE.md ("seeding requires the `service` running and docker
  available") and lets [devcontainer postCreate seeding](../../.devcontainer/postcreate.sh) collapse
  to a direct `cli seed` call.

## Problem

`WorkspaceService.createWorkspace` (`domain/.../repository/control/WorkspaceService.java:422-481`) and
`createMainWorkspace` (`:491-531`) both call the private `createContainerWorkspace`
(`:88-132`), which does three things in one breath:

1. create the branch ref host-side in the bare origin (`git branch`, `:97`) — **needs neither docker
   nor the service**;
2. `containers.run(...)` — `docker run` the container (`:105`) — needs **docker**;
3. `containers.exec(... "git","clone", cloneUrl(repoId), "/workspace")` (`:111-121`) — clone from
   `http://<qitsHost>:<port>/git/<repoId>`, qits' own JGit servlet — needs the **service running**.

Steps 2–3 are the coupling. They run at *creation* time even though nothing uses the container yet.

Meanwhile **the lazy path already exists and is tested.** `ensureContainer` (`:574-667`) is an
idempotent, state-aware "make the container real, recreating if needed" operation with four cases:
running → no-op; exists-but-exited → `start` in place; **absent but branch ref present →
`createContainerWorkspace(..., createBranchRef=false)`, i.e. exactly steps 2–3 on demand** (`:649-655`);
branch gone → abandon. **Every real use-site already calls it first** — `CommandService.prepare:351`,
`AgentLaunchService.launchChat:141`, `WorkspaceFilesService.validate:198`,
`fastForwardWorkspace:962`, `updateWorkspaceFromParent:1007`, the `POST .../ensure-container` endpoint,
etc. And startup discovery (`RepositoryDiscoveryService`, `:124-127`) *deliberately does not*
`docker run` — reconciliation is already lazy by design. The eager creation sites are the odd ones out.

## Design

### 1. Split creation from provisioning

Refactor `createContainerWorkspace` into two private helpers:

- `createBranchRefOnOrigin(originPath, branch, parentBranch)` — just step 1 (host-side `git branch`).
- `provisionContainer(repoId, workspaceId, branch, parentBranch)` — steps 2–3 (`docker run` + clone +
  `git config` identity). This is precisely what `ensureContainer`'s absent-branch-present case already
  invokes (via `createContainerWorkspace(..., createBranchRef=false)`), so point that case at
  `provisionContainer` too.

Then:

- **`createWorkspace`** calls only `createBranchRefOnOrigin`, persists the `Workspace` row with
  `runtimeStatus = STOPPED` (see §2), writes metadata, records `CREATED`. **No docker, no clone.**
- **`createMainWorkspace`** persists the row `STOPPED` (the main branch already exists in origin, so
  not even a branch ref to create). **No docker, no clone.**

First use → `ensureContainer` → absent-container/​branch-present case → `provisionContainer`. Unchanged
behavior, just triggered on demand.

### 2. Runtime status for a never-provisioned workspace

Persist `WorkspaceRuntimeStatus.STOPPED` at creation (instead of `RUNNING`). This reuses the existing
vocabulary exactly: `listWorkspaces` (`:186-191`) already computes runtime live from
`listWorkspaceContainers` and treats a persisted non-`RUNNING` status as "no live container";
`RepositoryDiscoveryService` already marks container-absent workspaces `STOPPED`; the UI already shows
a **Start container** button (the `ensure-container` endpoint) for non-running workspaces. So a
freshly-created workspace shows `STOPPED` with a Start button until something uses it — which is more
honest than today's optimistic `RUNNING`. (Alternative: a dedicated `NOT_PROVISIONED` state for a
clearer first-run label; deferred — `STOPPED` needs zero new plumbing and the distinction isn't
load-bearing since `ensureContainer` treats "absent" uniformly.)

### 3. Make merge's source-push container-tolerant

`mergeWorkspace` (`:746-777`) is the one creation-adjacent op that touches a container: line 770
`containerGit(repoId, workspaceId, "push", "origin", currentBranch)` pushes the **source** branch first
so an in-container commit isn't missed. The actual merge, `mergeIntoTarget` (`:882-919`), is already
**host-side** — a temp `git worktree` on the bare origin, merge, commit onto the target ref — no
container, no service.

Key invariant: **a workspace with no container has provably nothing unpushed** (nothing has ever run in
it), so its branch ref in origin is already complete. So swap line 770's throwing `containerGit` for the
existing best-effort `pushBranch` helper (`:715-725`), which **no-ops when the container is absent**
(the same helper `stopContainer` already uses). Merge then works with or without a live source
container.

### 4. Result: seeding is pure host-side data setup

With §1 + §3, **both** `SeedService` (`cli/.../SeedService.java`) and `SeedWebappService` run entirely
host-side: `createRepositoryUnderProject` → `createMainWorkspace` (branch ref + row),
`createWorkspace` (branch refs + rows), `mergeWorkspace` (host-side worktree merges on origin refs).
Crucially, the daemons they seed are **definitions only** — `repositoryDaemonService.create` just
persists a `RepositoryDaemon` row (name, command, ready-pattern, observers); neither seed *launches* a
daemon. `seed-webapp`'s `quarkus:dev` daemon starts only later, on the user's launch action (→
`DaemonSupervisor` → `ensureContainer`). So **no docker, no `docker run`, no clone, no git server, no
daemon process** at seed time. The workspaces and daemons come up on first real use (opening a
workspace, launching the daemon) via `ensureContainer` — which *then* needs docker + the service,
exactly when it's actually running.

### 5. Self-healing (the user's second ask), now uniform

Because provisioning is fully on-demand and idempotent, a container pruned "for some reason" is
recreated on next access — already true for once-provisioned workspaces via `ensureContainer`, and now
identically true for never-provisioned ones. There is a single code path to a live container from any
starting state (never-created / stopped / exited / pruned), so nothing crashes on a missing container;
it's just re-materialized.

## Files to change

- `domain/.../repository/control/WorkspaceService.java` — split `createContainerWorkspace`;
  `createWorkspace`/`createMainWorkspace` stop provisioning + persist `STOPPED`; point `ensureContainer`
  at `provisionContainer`; swap `mergeWorkspace`'s `containerGit` push → `pushBranch`.
- Tests: `domain/.../repository/control/WorkspaceContainerLifecycleServiceTest.java` — add
  "createWorkspace does not run a container; first use provisions it".
- `FakeContainerRuntime` (all three copies: `domain`/`service`/`cli` `src/test`) — mirror real docker
  semantics so `exec`/`execArgv` against an unknown (never-`run`) container **fails cleanly** rather
  than silently rewriting to a literal `/workspace` (explorer flagged this fall-through). This makes
  tests catch any use-site that forgot to `ensureContainer`.
- `cli` seed tests — should now pass without any "service running" precondition (already use
  `FakeContainerRuntime` + on-disk origin); assert seeding creates rows/branches without provisioning.
- CLAUDE.md — drop the "seeding requires the `service` running" caveat; note seeding is host-side.
- `.devcontainer/postcreate.sh` — collapse the boot-service/wait/seed/stop dance to a direct
  `./mvnw -pl cli quarkus:run -Dcli.args=seed` (+ `seed-webapp`). Downstream cleanup, do last.

## Build sequence

1. Split `createContainerWorkspace` into `createBranchRefOnOrigin` + `provisionContainer`; repoint
   `ensureContainer`. Green (pure refactor, behavior identical).
2. Flip `createWorkspace`/`createMainWorkspace` to non-provisioning + `STOPPED`. Update/inspect tests
   that assumed a container exists right after creation (they should already `ensureContainer` before
   use).
3. Container-tolerant `mergeWorkspace` push (`containerGit` → `pushBranch`).
4. Harden `FakeContainerRuntime` for the unknown-container case; add the lazy-creation test.
5. Verify `cli seed`/`seed-webapp` run with the service **down** (unit test + manual).
6. Simplify `postcreate.sh`; update CLAUDE.md.

## Open questions / risks

- **A use-site that execs without `ensureContainer`.** The explorer's map says all real ones ensure
  first, but the hardened `FakeContainerRuntime` (step 4) is what actually proves it — any miss turns
  from a silent bad rewrite into a test failure. Audit the §3-listed sites in that pass.
- **~~`seed-webapp`'s daemon~~ (non-issue — verified).** Both seeds only *create daemon definitions*
  (`repositoryDaemonService.create` = persist a row); neither launches a daemon. So `seed-webapp`
  decouples as fully as `seed` — its `quarkus:dev` daemon already starts on-demand, not at seed time.
- **Dedicated `NOT_PROVISIONED` status?** Only if the UI wants to distinguish "never started" from
  "stopped". Not required for correctness.
