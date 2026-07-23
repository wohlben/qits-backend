# `.qits-config.yml` as the single source of truth (workspace-scoped, no host DB store)

## Introduction

Part 5 of the **provisioning-inversion** track of [qits-workspace-daemon](../epic.md) (see the
[overview](daemon-self-provisioning-and-file-only-config.md)). This is the **host-side inversion of
the config model**. With the daemon now reading config
[in-container from the checkout](in-container-config-discovery.md) and self-running
[bootstrap](daemon-run-bootstrap-chain.md) + [daemons](daemon-supervised-dev-daemons.md), the host's
DB config store has no remaining reader — so it is **removed**. The committed `.qits-config.yml`
becomes the authoritative, **workspace-scoped** configuration store; there is no UI-only config and
no DB-persisted config that outlives the file.

**Today** (`.qits-config` as shipped): the file is a declarative *input*. `QitsConfigReconciler`
upserts it into DB tables (`ActionConfiguration`/`RepositoryDaemon`/`BootstrapCommand`), namespaced
by the `@qits-config` name suffix; those rows are authoritative — `FeatureFlowPhaseAction` binds an
action by FK, `DaemonSupervisor` drives `RepositoryDaemon` rows, MCP lists/runs config actions, the
UI renders them read-only. **Proposed**: the file is authoritative and workspace-scoped; the
repo-level DB config store, its reconciler, its MCP surface, and its feature-flow binding are gone.

### Related / dependent plans

- **Reverses [`.qits-config` in-repo configuration](../../qits-project-repositories/features/2026-07-18_qits-config-in-repo-configuration.md)**
  on three resolved decisions: the read moves **in-container** (from the checkout, not the bare
  origin — [Part 2](in-container-config-discovery.md)), the file becomes **authoritative** (not an
  input to DB rows), and the DB config store is **removed** (not coexisting). Write-back becomes the
  model in [Part 6](config-write-back-from-ui.md); its deferred "branch-divergent config" follow-up
  is resolved for free by the in-container read.
- **Hard dependency** — [Part 2](in-container-config-discovery.md) (the in-container read must be the
  live source before the DB store can be dropped), [Part 3](daemon-run-bootstrap-chain.md), and
  [Part 4](daemon-supervised-dev-daemons.md) (the runners must already read from the checkout, not
  DB rows).
- **Touches [qits-feature-flows](../../qits-feature-flows/epic.md)** — feature-flow support is
  removed from `.qits-config`; flows keep only the code-based actions (below).
- **Re-adds config-action MCP separately** — the removed `listActions`/`runAction` re-home into a
  future **workspace-daemon MCP** (mega-doc Non-goal #1), not here.

## Scope decisions (settled 2026-07-23 — recorded verbatim from the overview)

- **Config is workspace-scoped, not repository-scoped.** Declared actions/daemons/bootstrap live in
  the workspace's checkout and are read by the workspace-daemon in-container. They **no longer appear
  in the repository/global Actions list** (`RepositoryActionsController` →
  `ActionResolutionService.effectiveActions`) — that list, and the feature-flow action picker, keep
  only the code-based actions.
- **The only repository/global-scope actions are code-based:** (1) the **coding agent** (the
  `domain.agent` launch path, not an `ActionConfiguration`) and (2) **`Bash`** (the code-seeded
  global `ActionConfiguration`, `ActionConfigurationSeeder.java:36`). Everything a repo used to
  declare/UI-create at that scope is gone from it.
- **Feature-flow support is removed from `.qits-config` for this refactor.** No config-declared
  action is feature-flow-bindable, which deletes the project-scoped, stable-id FK problem
  (`FeatureFlowPhaseActionService.create:56-61`) outright. Feature flows still bind the code-based
  actions.
- **Ids are explicit, deterministic, string.** Each declared entry carries its own `id:` in the file
  (not a generated UUID, not derived from name). A duplicate id is a **user error, allowed to
  collide** — qits does not defend against it. This replaces the `@qits-config` name-namespacing /
  id-preservation machinery the shipped reconciler needed.
- **MCP `listActions`/`runAction` for config actions are removed here**
  (`RepositoryMcpTools:251/268`, `ActionConfigurationMcpTools` repository tools) and **re-added by a
  separate feature-idea** (the workspace-daemon's own MCP). In the interim, config actions are
  runnable **only from the workspace-detail UI**.
- **Daemons and bootstrap commands follow actions** into workspace-scope: the repository-level
  `RepositoryDaemon`/`BootstrapCommand` rows, the host-side auto-start coupler
  (`DaemonLifecycleCoupler` → `RepositoryDaemonRepository.findByRepositoryId`), and the repo-detail
  Daemons/Bootstrap sections are removed.
- **Existing UI/seeded repo-scoped config is dropped, not migrated.** Repos with repo-scoped
  `ActionConfiguration`/`RepositoryDaemon`/`BootstrapCommand` rows lose them; re-declare in
  `.qits-config.yml`. Given pre-release status, no export-to-file migration tool is built (the
  code-seeded global `Bash` and the agent path are untouched).
- **`Command.actionId`/`actionName` (`Command.java:65`) are already a snapshot, not a live FK**, so
  per-workspace/ephemeral config actions record cleanly with no change.

## What is removed (host-side)

- **`QitsConfigReconciler`** and its wiring into `RepositoryService.cloneOne`/`pullRepository` +
  the `POST /repositories/{id}/config/reload` endpoint (the read/upsert is gone).
- **Repo-scoped rows + their surfaces**: `ActionConfiguration.repository` scope
  (`listByRepositoryId`/`listEffective` collapse to global-only), `RepositoryDaemon` (entire entity
  + service + controller + `DaemonLifecycleCoupler` repo-level auto-start), `BootstrapCommand`
  (entire entity + service + controller + the retired provision-time runner from
  [Part 3](daemon-run-bootstrap-chain.md)). A **Flyway migration drops** those tables/columns.
- **MCP**: `RepositoryMcpTools.listActions/runAction`, `ActionConfigurationMcpTools` repository
  tools.
- **Feature-flow binding to config actions**: the project-scoped guard in
  `FeatureFlowPhaseActionService.create` and `isActionBound` (config actions are no longer bindable;
  only code-based actions are).
- **UI**: the repo-detail config-warning banner + "Reload config" button, the repo-detail
  Daemons/Bootstrap pages, and the repository-effective-actions list's config entries.
  `ActionResolutionService.effectiveActions` returns only the code-based global actions.

## What stays / changes shape

- **Config actions are runnable from the workspace-detail UI** (interim, until the workspace-daemon
  MCP): the workspace's action list comes from the [in-container config](in-container-config-discovery.md)
  surfaced over the socket, and running one is a socket instruction to the daemon.
- **The `frameworks` override** (a read-path hint, never stored) either moves to the in-container read
  or stays a host detection hint — decide during build; it maps to nothing stored so it is the
  simplest piece.

## Non-goals

- Write-back from the UI — [Part 6](config-write-back-from-ui.md) (this part *removes* the DB store;
  Part 6 adds the file-write edit path).
- Re-adding config-action MCP — a separate workspace-daemon-MCP idea.
- Richer feature-flow ↔ config interplay — a later idea; flows keep code-based actions only.

## Testing

- **Removal regressions** — the repo Actions list shows only code-based actions; the feature-flow
  picker has no config actions; the removed endpoints/MCP tools 404/absent; the Flyway drop applies
  cleanly on a seeded DB.
- **`seed-webapp`** — shrinks again: no reconcile step; the fixture's `.qits-config.yml` is read
  in-container per workspace. Assert the Build & Verify flow still binds its (now code-based)
  actions.
- **OpenAPI + UI** — regenerate `docs/openapi.yml` **and** `service/src/main/webui/openapi.yml`
  (two committed copies) after the controller removals; the UI build stays green.
