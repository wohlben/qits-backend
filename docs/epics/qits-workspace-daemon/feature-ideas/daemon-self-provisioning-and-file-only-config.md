# Daemon-driven self-provisioning + `.qits-config.yml` as the single source of truth

## Introduction

Today, bringing a workspace to life is a **host-orchestrated sequence** that reaches *into* the
container step by step: `WorkspaceService.provisionContainer` (`WorkspaceService.java:192`) runs
`docker run`, then host-drives `git clone --branch` and per-level submodule wiring through
`containerGit()` (`:122`, i.e. `docker exec git …`); then the [bootstrap
chain](../../qits-workspaces/features/2026-07-18_workspace-bootstrap-commands.md) runs its
one-shot install/seed commands (again host-driven, through the command machinery's `docker exec`
seams); then the host-side `DaemonSupervisor` auto-starts the dev-server daemons. Three separate
host→container drive paths, each shelling docker, each ordered by host-side event chains.

Meanwhile the [workspace-daemon epic](../epic.md) has already inverted the *reachability* model:
Part 1 (shipped 2026-07-22) makes `qits-workspace-daemon` the container's PID 1, has it **dial
home** over a control socket, and — critically for this idea — **already injects the identity the
container needs as run-time env** (`WorkspaceContainerFactory.java:182`):
`QITS_WORKSPACE_DAEMON_REPOSITORY_ID`, `QITS_WORKSPACE_DAEMON_BRANCH`,
`QITS_WORKSPACE_DAEMON_WORKSPACE_ID`, `QITS_WORKSPACE_DAEMON_PARENT`, and the dial-home
`QITS_WORKSPACE_DAEMON_URL`. The container knows *who it is* the moment it boots — it just doesn't
yet *do* anything with that beyond holding the socket open.

This feature closes that gap in the most direct way: **the daemon provisions and configures the
workspace itself, from its start-time env, right after it boots** — no host-driven clone, no
host-driven bootstrap chain, no host-driven daemon launch. On startup the daemon reads its
`QITS_*` env, clones `/workspace` for the named repository/branch from the qits git host, then —
now that a checkout exists — **reads `.qits-config.yml` from the repository root** and runs the
whole convergence itself: bootstrap commands, then dev-server daemons. Provisioning becomes a
property of the container's own startup, not a script the host runs against it.

And because the daemon now discovers config **from the checkout it just made**, this idea also
flips the second half: **`.qits-config.yml` becomes the single source of truth for repository
configuration** — not a declarative *input* reconciled *into* authoritative DB rows (today's
model), but the authoritative store itself. There is no UI-only config and no DB-persisted config
that outlives the file. The configuration UI stays, but its edits **must be written back to the
file in the workspace** — configuring a repository *is* editing its committed `.qits-config.yml`.

### Related / Dependent plans

- **Consumes [workspace-daemon Part 1](../features/2026-07-22_workspace-daemon-binary-and-control-socket.md)** —
  the dial-home env (`QITS_WORKSPACE_DAEMON_*`) and the control socket this idea builds on are
  already shipped and dark. This is the first feature to give the daemon *provisioning* work to do.
- **Supersedes / merges [Part 4 — in-container-git-verbs-over-socket](in-container-git-verbs-over-socket.md)** —
  Part 4 delegates the clone to the daemon **on a qits instruction over the socket**; this idea
  has the daemon **self-initiate** the clone from its env at boot, no instruction. Same in-container
  `git`, a more autonomous trigger. The two must be reconciled (see *Tension* below).
- **Merges [Part 5 — daemon-supervision-handover](daemon-supervision-handover.md)** — the daemon
  starting the dev-server daemons as the tail of its own startup *is* Part 5's handover, arrived at
  from the provisioning side rather than the supervision side.
- **Absorbs [workspace bootstrap commands](../../qits-workspaces/features/2026-07-18_workspace-bootstrap-commands.md)** —
  the `install`/`seed` bootstrap chain (currently a host-side `WorkspaceBootstrapRunner` observing
  `WorkspaceContainerStarted`) becomes a **step inside the daemon's startup sequence**, run
  in-container, between clone and daemon-start. The ordering guarantee (bootstrap-before-daemons,
  which qits-in-qits *requires* because its build guard fails once `:8080` is listening) is
  preserved by construction — it's one linear sequence in one process now.
- **Reverses [`.qits-config` in-repo configuration](../../qits-project-repositories/features/2026-07-18_qits-config-in-repo-configuration.md)** —
  that feature's model is: read the file host-side from the **bare origin** (`GitExecutor.showFile`),
  reconcile **into DB tables** (`ActionConfiguration`/`RepositoryDaemon`/`BootstrapCommand` via
  `QitsConfigReconciler`), coexist with UI-created rows (`@qits-config` name namespacing,
  `origin` derived from the suffix), and **never write the file back** (an explicit Non-Goal). This
  idea inverts three of its resolved decisions: the read moves **in-container** (from the checkout,
  not the bare origin), the file becomes **authoritative** (not an input to DB rows), and **write-back
  becomes the model** (the UI edits the file). Its "Config scaffolding / export" follow-up becomes
  the core mechanism, not a nicety.
- **Naturally resolves that feature's "branch-divergent config" follow-up** — reading the file
  from the workspace's *own* checkout means each workspace sees its *own branch's* config for free.
  A feature branch that edits `.qits-config.yml` (via the coding agent or a human) changes that
  workspace's actions/daemons with no extra merge/precedence machinery — the exact follow-up
  `.qits-config` deferred.
- **Touches [qits-tokens](../../qits-tokens/epic.md) / MCP scoping** — if the daemon self-clones
  and self-configures, it needs a credential to pull from the git host and (later) to report the
  discovered config home. This overlaps [Part 6 — mcp-termination-and-token-provisioning](mcp-termination-and-token-provisioning.md).

## The vision: a container that provisions and configures itself

```
docker run  (host: the ONLY host→container action)
  └─ env: QITS_WORKSPACE_DAEMON_{URL, REPOSITORY_ID, BRANCH, WORKSPACE_ID, PARENT, PROJECT_ID}
       │
       ▼
qits-workspace-daemon  (PID 1, in-container — everything below is the daemon's own startup)
  1. dial home, establish the control socket          (Part 1, already shipped)
  2. git clone  <git-host>/<REPOSITORY_ID>  --branch <BRANCH>  →  /workspace
     + per-level submodule wiring
  3. read /workspace/.qits-config.yml                 (from the checkout, NOT the bare origin)
  4. run the bootstrap chain in order                 (install / migrate / seed)
  5. start the declared dev-server daemons
  6. stream logs / report state / config home over the control socket
```

The host's role collapses to `docker run` with the right env (it already composes all of it
today) plus reading the socket. Steps 2–5 — clone, config discovery, bootstrap, daemon start —
all happen **in-container, driven by the client, after startup**, which is exactly what the
request asks for.

### Start-time env

Part 1 already sets repository / branch / workspace / parent as `QITS_WORKSPACE_DAEMON_*`. This
feature needs the daemon to actually *consume* them for the clone, and adds one:

- **`QITS_WORKSPACE_DAEMON_PROJECT_ID`** (the request's `QITS_PROJECT`) — not currently injected;
  the daemon may need the project (the aggregate root) for MCP/config context. Add it to
  `WorkspaceContainerFactory.forWorkspace`.

Recommendation: **reuse the established `QITS_WORKSPACE_DAEMON_*` prefix** rather than introduce a
parallel unprefixed `QITS_REPOSITORY`/`QITS_BRANCH`/`QITS_PROJECT` set — Part 1 already wired the
prefixed names to the binary's `qits.workspace-daemon.*` config, and a second naming scheme for
the same values would be pure drift. (The request's names map 1:1:
`QITS_REPOSITORY`→`QITS_WORKSPACE_DAEMON_REPOSITORY_ID`, `QITS_BRANCH`→`…_BRANCH`,
`QITS_PROJECT`→`…_PROJECT_ID`.)

## The config-model shift: file as the single source of truth

This is the larger conceptual change and deserves its own careful design; the daemon self-clone is
the mechanism that makes it natural.

**Today** (`.qits-config` as shipped): the file is a declarative *input*. `QitsConfigReconciler`
upserts it into DB tables; those rows are authoritative for everything the host does —
`FeatureFlowPhaseAction.action_configuration_id` binds an action, `Command.actionId` snapshots one,
`DaemonSupervisor` drives `RepositoryDaemon` rows, the UI renders and (for `origin = UI` rows)
edits them. Config-origin rows are read-only in the UI; UI-origin rows have no file at all.
Write-back is an explicit Non-Goal.

**Proposed**: the **file** is authoritative. There is no UI-only configuration and no DB store that
is the source of truth. The configuration UI remains — the user still edits actions, daemons,
bootstrap steps, framework hints in a form — but **the output of that edit is the
`.qits-config.yml` written into the workspace**, not a DB row. To configure a repository is to edit
its committed file.

Earlier drafting worried the host still needs a *model* of config to render repo-level lists and
bind feature-flow phases, implying the DB tables must survive as a projection. **The scope
decisions below dissolve that worry** by removing config from repo/global scope entirely: config
is **workspace-scoped only**, read in-container from the workspace's own checkout, never projected
to a repository-level DB row. The host keeps no config model at all; the only actions at
repository/global scope are the two **code-based** ones (below), which are not config-derived.

### Scope decisions (settled 2026-07-23)

- **Config is workspace-scoped, not repository-scoped.** Declared actions/daemons/bootstrap live
  in the workspace's checkout and are read by the workspace-daemon in-container. They **no longer
  appear in the repository/global Actions list** (`RepositoryActionsController` →
  `ActionResolutionService.effectiveActions`) — that list, and the feature-flow action picker,
  keep only the code-based actions.
- **The only repository/global-scope actions are code-based:** (1) the **coding agent** (the
  `domain.agent` launch path, not an `ActionConfiguration`) and (2) **`Bash`** (the code-seeded
  global `ActionConfiguration`, `ActionConfigurationSeeder.java:36`). Everything a repo used to
  declare/UI-create at that scope is gone from it.
- **Feature-flow support is removed from `.qits-config` for this refactor.** No config-declared
  action is feature-flow-bindable, which deletes the project-scoped, stable-id FK problem
  (`FeatureFlowPhaseActionService.create:48-61`) outright. Feature flows still bind the code-based
  actions. Re-introducing richer flow/config interplay is a later, separate idea.
- **Ids are explicit, deterministic, string.** Each declared entry carries its own `id:` in the
  file (not a generated UUID, not derived from name behind the scenes). A duplicate id is a
  **user error, allowed to collide** — qits does not defend against it. This replaces the
  `@qits-config` name-namespacing / id-preservation machinery the shipped reconciler needed.
- **MCP `listActions`/`runAction` for config actions are removed here** (`RepositoryMcpTools:251/268`,
  `ActionConfigurationMcpTools:145`) and **re-added by a separate feature-idea**: the
  workspace-daemon's own MCP, which manages the workspace's actions and daemons/services from
  inside the container (where the checkout — and thus the config — lives). In the interim, config
  actions are runnable **only from the workspace-detail UI**.
- **Daemons and bootstrap commands follow actions** into workspace-scope by the same logic: the
  workspace-daemon reads and self-runs them from the checkout, so the repository-level rows, the
  host-side auto-start coupler (`DaemonLifecycleCoupler:64` → `RepositoryDaemonRepository.findByRepositoryId`),
  and the repo-detail Daemons/Bootstrap sections are removed.
- **Existing UI/seeded repo-scoped config is dropped, not migrated.** Repos with repo-scoped
  `ActionConfiguration`/`RepositoryDaemon`/`BootstrapCommand` rows and no file lose those rows;
  re-declare them in `.qits-config.yml`. Given pre-release status, no export-to-file migration tool
  is built (the code-seeded global `Bash` and the agent path are untouched).
- **Config edits are working-tree writes, never auto-commits** (see *Write-back mechanics*) — so a
  changed definition can be tried against the live container before it is committed.

The `Command.actionId`/`actionName` audit fields (`Command.java:65`) are already a **snapshot, not
a live FK**, so per-workspace/ephemeral config actions record cleanly with no change — the pattern
the rest of this model follows.

### Write-back mechanics

Writing config to the workspace means writing `/workspace/.qits-config.yml` in the container (the
daemon's file-write verb — [Part 3, container-file-access-over-socket](container-file-access-over-socket.md)
— is the transport). **Settled: a config edit is a working-tree write, never an auto-commit.** It
surfaces as a normal uncommitted change in the workspace, exactly like any other edit. The
motivation is load-bearing, not stylistic: because the workspace-daemon re-reads the file from the
working tree, **you can try a changed action/daemon definition against the live container before
committing it** — edit, run, iterate, and only commit once it works. Auto-committing would forfeit
that try-before-commit loop and pollute history with every experimental tweak.

### What this buys

- **Config travels with the branch** — the "branch-divergent config" follow-up falls out for free
  (each daemon reads its own checkout).
- **Config is reviewable/versioned by construction** — no invisible DB-only state; a config change
  is a diff.
- **The coding agent can edit its own runtime definition** — it edits `.qits-config.yml` in its
  workspace and the next daemon start picks it up. (`.qits-config` called this out as a tantalizing
  but deferred consequence of branch-divergent config; here it's the default.)
- **Re-provision round-trips fully** — clone + config-read + bootstrap + daemons are one
  deterministic in-container sequence keyed off committed content.

## Tension with the workspace-daemon epic's staging (must resolve before building)

The epic is deliberately staged as **qits-drives-over-socket, verb by verb** (Part 4: qits *tells*
the daemon to clone; Part 5: qits *tells* the daemon to start a daemon). This idea proposes
**daemon autonomy at startup** — the daemon self-initiates clone/bootstrap/daemon-start from env,
without a per-step instruction. These are two different control models for the same verbs, and the
epic can't hold both silently. Options:

1. **Reframe Parts 4+5 around this** — the socket still exists (for logs/state/on-demand actions),
   but *first provisioning* is autonomous. Parts 4/5 become "the daemon owns clone + supervision,"
   with the host issuing only *subsequent* operations (re-clone, manual daemon restart) over the
   socket. This idea likely **promotes to restructure the epic's later parts** rather than slotting
   in as one more Part.
2. **Keep the epic's instruction model** — the host still *sends* "clone" / "bootstrap" / "start
   daemons" messages right after the handshake; the daemon executes them in-container. Less
   autonomous, but preserves the epic's uniform "qits speaks, daemon acts" seam. The env then just
   seeds identity (as today) and the *sequence* stays host-orchestrated over the socket.

The request ("done automatically by the client after starting up") reads as option 1. Recommend
starting the design there and treating this doc as a candidate to **restructure the epic** (or spin
its own epic), consistent with the "a flat draft growing a second document is the signal to
promote" convention.

## Non-goals (for a first cut)

1. **Re-adding the workspace-daemon MCP for config actions.** Managing the workspace's
   actions/daemons/services from inside the container (the re-home of the removed
   `listActions`/`runAction`) is explicitly a **separate follow-up idea**, not this one. This
   feature only *removes* the repo/global config-action surface; the interim is UI-only.
2. **Richer feature-flow ↔ config interplay.** Feature-flow support is removed from `.qits-config`
   here; flows keep the code-based actions only. Re-introducing any config-driven flow binding is a
   later idea, not this one.
3. **Changing what a workspace *is*.** Still a branch ref + a container; still lazy-provisioned.
   Only *who runs the setup* and *where config lives* change.
4. **Global/app config.** `qits.workspace.image`, network, runtime stay global application config —
   `.qits-config` already scoped those out and that's unchanged.
5. **Project-scoped objects** (feature-flow blueprints hang off `Project`, not a repo file) — same
   boundary `.qits-config` drew.

## Open questions

The config-model questions are all **resolved** (see *Scope decisions* and *Write-back mechanics*):
config is workspace-only with no host projection; daemons/bootstrap follow actions into
workspace-scope; existing repo-scoped rows are dropped, not migrated; edits are working-tree
writes; and config actions are UI-only until the workspace-daemon MCP idea lands. What remains open
is the **self-provisioning half**, orthogonal to the config model:

- **Credential for the self-clone.** The daemon pulling from the git host needs auth; today the
  host-driven clone runs as qits. Ties to Part 6 / scoped tokens.
- **Failure surfacing.** A self-clone or bootstrap failure now happens *inside* the daemon's
  startup, not in a host-observed `docker exec`. The control socket must carry a clear
  provision-failed signal (the bootstrap feature's "degrade loudly" posture, re-homed onto the
  socket).
