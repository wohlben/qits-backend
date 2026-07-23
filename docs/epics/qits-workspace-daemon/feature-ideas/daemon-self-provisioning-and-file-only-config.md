# Overview: daemon-driven self-provisioning + `.qits-config.yml` as the single source of truth

## Introduction

This is the **overview / index** for the **provisioning-inversion track** of
[qits-workspace-daemon](../epic.md): the in-container `qits-workspace-daemon` (shipped dark in
[Part 1](../features/2026-07-22_workspace-daemon-binary-and-control-socket.md)) **provisions and
configures the workspace itself, on boot, from its start-time env** — clone, config-read, bootstrap,
dev-daemon start — and `.qits-config.yml` becomes the authoritative, workspace-scoped configuration
store rather than a declarative input reconciled into DB rows.

> This document was originally a single all-in-one draft. It grew too large for one feature, so it
> was **split into six dependency-ordered feature-ideas** (below). This file keeps the vision, the
> resolved control-model decision, and the settled config scope-decisions; the mechanics live in the
> parts. (A flat draft growing a second document is the project's signal to promote it — here into a
> track of parts under the existing epic.)

## The vision: a container that provisions and configures itself

```
docker run  (host: the ONLY host→container action)
  └─ env: QITS_WORKSPACE_DAEMON_{URL, REPOSITORY_ID, BRANCH, WORKSPACE_ID, PARENT}
       │
       ▼
qits-workspace-daemon  (PID 1's child under tini, in-container — the daemon's own startup)
  1. dial home, establish the control socket          (Part 1, already shipped)
  2. git clone  <git-host>/<REPOSITORY_ID>  --branch <BRANCH>  →  /workspace
     + per-level submodule wiring                      → autonomous-self-clone-on-boot
  3. read /workspace/.qits-config.yml  (from the checkout, NOT the bare origin)
                                                        → in-container-config-discovery
  4. run the bootstrap chain in order  (install / migrate / seed)
                                                        → daemon-run-bootstrap-chain
  5. start the declared dev-server daemons             → daemon-supervised-dev-daemons
  6. stream logs / report state / config over the control socket
```

The host's role collapses to `docker run` with the right env (it already composes all of it today)
plus reading the socket. Steps 2–5 all happen **in-container, driven by the daemon, after startup**.

## The split (dependency order = build order)

1. **[autonomous-self-clone-on-boot](autonomous-self-clone-on-boot.md)** — the daemon self-clones
   `/workspace` + wires submodules from its env; `provisionContainer` stops driving the clone and
   awaits a `Provisioned` event; socket-down ⇒ host-clone fallback. Absorbs the clone piece of
   [Part 4](in-container-git-verbs-over-socket.md).
2. **[in-container-config-discovery](in-container-config-discovery.md)** — the daemon reads/parses
   `.qits-config.yml` from the checkout (its own branch), making config workspace/branch-scoped. The
   pivot enabling file-as-truth.
3. **[daemon-run-bootstrap-chain](daemon-run-bootstrap-chain.md)** — the bootstrap chain runs inside
   the daemon's startup, from the in-container config; ordering preserved by construction. Re-homes
   `WorkspaceBootstrapRunner`; absorbs [workspace-bootstrap-commands](../../qits-workspaces/features/2026-07-18_workspace-bootstrap-commands.md).
4. **[daemon-supervised-dev-daemons](daemon-supervised-dev-daemons.md)** — dev daemons start as the
   tail of the daemon's startup and are supervised in-container; `DaemonSupervisor` shrinks to a thin
   coordinator. The autonomous reframing of [Part 5](daemon-supervision-handover.md).
5. **[config-as-single-source-of-truth](config-as-single-source-of-truth.md)** — the host-side
   inversion: remove `QitsConfigReconciler`→DB, the repo-scoped
   `ActionConfiguration`/`RepositoryDaemon`/`BootstrapCommand` store + its MCP tools + feature-flow
   binding; config is workspace-only; only code-based actions (agent + `Bash`) stay at repo/global
   scope. Reverses [`.qits-config` in-repo configuration](../../qits-project-repositories/features/2026-07-18_qits-config-in-repo-configuration.md).
6. **[config-write-back-from-ui](config-write-back-from-ui.md)** — the config UI writes edits back to
   `/workspace/.qits-config.yml` as a working-tree change (never an auto-commit), so a definition can
   be tried against the live container before committing. Uses the
   [Part 3 file transport](container-file-access-over-socket.md).

See **[`docs/implementation-plan.md`](../../../implementation-plan.md)** for the step-by-step build
order across all six.

## The autonomous decision (option 1)

The epic's later parts were originally staged as **qits-instructs-over-socket, verb by verb**
(Part 4: qits *tells* the daemon to clone; Part 5: qits *tells* it to start a daemon). This track
chooses **daemon autonomy at startup**: the daemon self-initiates clone → config → bootstrap →
daemon-start from its env, without per-step instruction. The socket still exists — for logs, state,
on-demand actions, and *subsequent* operations (re-clone, manual daemon restart) — but **first
provisioning is autonomous**. This reframes the epic's Parts 4/5 (see
[epic.md](../epic.md#parts-implementation-order)) rather than adding parts beside them. The request
("done automatically by the client after starting up") is exactly option 1.

**Degradation contract (unchanged from the epic):** socket down ⇒ exactly today's behaviour. A stale
image with no daemon never sends `Hello`/`Provisioned`, so each migrated call site **falls back to
`docker exec`** until that verb is retired.

## The config-model shift (settled 2026-07-23)

The **file** is authoritative and **workspace-scoped**; there is no UI-only config and no DB store
that is the source of truth. The scope decisions (detailed in
[config-as-single-source-of-truth](config-as-single-source-of-truth.md)):

- Config is **workspace-scoped**, read in-container from the checkout — not projected to repo-level
  DB rows. It no longer appears in the repository/global Actions list or the feature-flow picker.
- The only repository/global-scope actions are **code-based**: the coding agent, and the seeded
  global `Bash`. Feature-flow support is removed from `.qits-config` (deleting the project-scoped FK
  problem).
- **Ids are explicit, deterministic, string** in the file (replacing the `@qits-config`
  name-namespacing). A duplicate id is an allowed user error.
- Config-action **MCP is removed here and re-added by a separate workspace-daemon-MCP idea**; interim
  is UI-only.
- Daemons/bootstrap follow actions into workspace-scope. Existing repo-scoped rows are **dropped, not
  migrated** (pre-release).
- Config edits are **working-tree writes, never auto-commits** (try-before-commit) —
  [Part 6](config-write-back-from-ui.md).

## Non-goals (track-wide)

1. **Re-adding a workspace-daemon MCP for config actions** — a separate follow-up idea; interim is
   UI-only.
2. **Richer feature-flow ↔ config interplay** — flows keep code-based actions only; re-introducing
   config-driven binding is a later idea.
3. **Changing what a workspace is** — still a branch ref + a container, still lazy-provisioned. Only
   *who runs the setup* and *where config lives* change.
4. **Global/app config** — `qits.workspace.image`, network, runtime stay global application config.
5. **Project-scoped objects** — feature-flow blueprints hang off `Project`, not a repo file.
6. **Scoped clone credential** — the self-clone runs against the token-free `/git` host today;
   hardening ties to [Part 6 — mcp-termination-and-token-provisioning](mcp-termination-and-token-provisioning.md).

## Open questions (self-provisioning half; config-model half is settled)

- **Credential for the self-clone** — no credential needed today (`/git` is token-free); a scoped
  token is a Part-6 hardening.
- **Failure surfacing** — a self-clone/bootstrap failure happens inside the daemon's startup; the
  socket carries explicit `ProvisionFailed`/`Bootstrapped{ok:false}` signals (the "degrade loudly"
  posture, re-homed onto the socket).
- **Shared config parser location** — whether the framework-free `QitsConfig` record tree + parser
  move into a shared module both `domain` and `workspace-daemon` depend on (see
  [in-container-config-discovery](in-container-config-discovery.md)).
