# `.qits-config.yml` as the single source of truth (workspace-scoped, no host DB store)

> **Implemented 2026-07-24.** The host's repo-scoped DB config store and everything that fed or
> read it is **removed**: `QitsConfigReconciler` + its clone/pull/push triggers + the
> `POST /repositories/{id}/config/reload` endpoint; the `RepositoryDaemon` and `BootstrapCommand`
> stacks (entities/services/repositories/mappers/CRUD controllers); the repo scope of
> `ActionConfiguration` (global-only now); the repo-scoped MCP tools; the feature-flow config-action
> binding guard; and the whole `@qits-config` name-suffix machinery — all dropped by Flyway
> **`V43__drop_repo_config_store.sql`** (existing repo-scoped rows deleted, not migrated). The
> committed `.qits-config.yml`, read **in-container per workspace** (Part 2's
> `WorkspaceConfigReader`/`ConfigView`), is the single source of truth. A new **workspace-scoped
> actions surface** (`GET/POST /repositories/{repoId}/workspaces/{workspaceId}/actions[/…/run]`)
> runs config actions over the control socket **reusing the existing `RunCommand` verb** — no new
> `DaemonMessage`. See [`docs/implementation-plan.md`](../../../implementation-plan.md) Part 5.

> **Relocated 2026-07-26.** The default committed location is now **`.config/qits/repository.yml`**;
> the original root-level `.qits-config.yml` stays supported as a **fallback**, read only when the
> new path is absent (in-container by the daemon's `ConfigReader`, host-side by
> `QitsConfigParser.readConfig` — which tries `CONFIG_PATH` then `LEGACY_CONFIG_PATH`). Mentions of
> `.qits-config.yml` in this doc predate the move; everything else about the model is unchanged.

## Introduction

Part 5 of the **provisioning-inversion** track of [qits-workspace-daemon](../epic.md) (see the
[overview](../feature-ideas/daemon-self-provisioning-and-file-only-config.md)). The **host-side
inversion of the config model**. With the daemon reading config
[in-container from the checkout](2026-07-23_in-container-config-discovery.md) and self-running
[bootstrap](2026-07-23_daemon-run-bootstrap-chain.md) + [services](2026-07-24_daemon-supervised-dev-daemons.md)
from it, the host's DB config store had no remaining reader — so this part removed it. The
committed `.qits-config.yml` is now authoritative and **workspace-scoped** (each workspace sees its
own branch's file); there is no UI-only config and no DB-persisted config that outlives the file.

### Related / dependent plans

- **Reverses [`.qits-config` in-repo configuration](../../qits-project-repositories/features/2026-07-18_qits-config-in-repo-configuration.md)**
  on three of its resolved decisions: the read moved **in-container** (from the checkout, not the
  bare origin — [Part 2](2026-07-23_in-container-config-discovery.md)), the file became
  **authoritative** (not an input to DB rows), and the DB config store was **removed** (not kept
  coexisting). Its deferred "branch-divergent config" non-goal is resolved for free by the
  in-container read; write-back becomes the model in
  [Part 6](../feature-ideas/config-write-back-from-ui.md). A dated reversal note now heads that doc.
- **Hard dependency** — [Part 2](2026-07-23_in-container-config-discovery.md) (the in-container read
  had to be the live source before the DB store could be dropped),
  [Part 3](2026-07-23_daemon-run-bootstrap-chain.md) and
  [Part 4](2026-07-24_daemon-supervised-dev-daemons.md) (the runners already read from the
  checkout, not DB rows).
- **Touches [qits-feature-flows](../../qits-feature-flows/epic.md)** — feature-flow support is gone
  from `.qits-config`; flows bind only code-based actions.
- **Defers config-action MCP** — the removed `listActions`/`runAction` re-home into a future
  **workspace-daemon MCP** (mega-doc Non-goal #1), not here.

## What was removed (host-side)

- **`QitsConfigReconciler`** and its triggers in `RepositoryService.cloneOne`/`pull`/`push`, plus
  the `POST /repositories/{id}/config/reload` endpoint and the repo-detail config-warning banner +
  "Reload config" button (the `Repository.config_warning` column went with them).
- **`RepositoryDaemon` and `BootstrapCommand` stacks** — entities, services, repositories, mappers,
  CRUD controllers, the repo-detail Daemons/Bootstrap UI pages/routes/forms/cards.
- **Repo scope of `ActionConfiguration`** — the `repository_id` column (V27) is dropped; the table
  is global-only again. The only repository/global-scope actions are code-based: the code-seeded
  global **`Bash`** (`ActionConfigurationSeeder`) and the **coding agent** path (not an
  `ActionConfiguration`).
- **MCP**: `RepositoryMcpTools.listActions`/`runAction`, the five repository tools of
  `ActionConfigurationMcpTools`, and their `RepositoryScope`/`RepositoryActionToolFilter` helpers.
- **Feature-flow binding to config actions**: the project-scoped guard in
  `FeatureFlowPhaseActionService.create` — only code-based actions are bindable, which deletes the
  stable-id FK problem outright.
- **The `@qits-config` name-suffix machinery** — `QitsConfig.configName`/`isConfigName`/`baseName`/
  `Origin`/`originOf`, the reserved-name guards, and the frontend `config-origin.ts`.

Flyway **`V43__drop_repo_config_store.sql`** drops the tables/columns (`repository_daemon(+env/
healthcheck)`, `bootstrap_command(+env)`, `ActionConfiguration.repository_id`,
`Repository.config_warning`). Existing repo-scoped rows are **deleted, not migrated** (pre-release;
re-declare in `.qits-config.yml`). `workspace_bootstrap_run` **stays** — it is a string-keyed
snapshot with no FK to `bootstrap_command`.

## What shipped in its place

- **Config is workspace-scoped, file-only, read in-container.** Service definitions resolve from
  the Part-2 `WorkspaceConfigReader`: `ServiceSupervisor`/`ServiceLifecycleCoupler`, the web-view
  proxy and health checks all run from `ServiceDefinitionDto` (**replaces `RepositoryDaemonDto`**),
  and **service identity is the config `id:` string** (was a DB UUID). The workspace bootstrap list
  likewise comes from the ConfigView as `BootstrapStepDto`; `BootstrapRun` snapshot rows stay,
  keyed by step name.
- **Explicit string `id:` per declared entry** (actions/services/bootstrap) — optional; it
  **defaults to the entry's `name`** until the fixtures' two-level submodule round-trip declares
  them (the same stopgap pattern as the `daemons:`→`services:` `@JsonAlias`). This replaces the
  `@qits-config` name-namespacing / id-preservation machinery the reconciler needed; a duplicate id
  is a user error, allowed to collide.
- **New workspace-scoped actions surface** (`WorkspaceActionsController`):
  - `GET /api/repositories/{repoId}/workspaces/{workspaceId}/actions` — the union of the code-based
    globals and the workspace's config actions, as
    `{id, name, description, origin: CODE|CONFIG, interactive, runnable}`.
  - `POST …/actions/{actionId}/run` — runs a config action **over the control socket reusing the
    existing `RunCommand` verb** (`bash -lc <execute>`, cwd `/workspace`, the entry's env; bounded
    by `qits.workspace-actions.run-timeout-ms`, default 10 min). No daemon live ⇒ 409; id absent
    from a readable config ⇒ 404; interactive ⇒ 400.
- **UI**: the repo-detail config/Daemons/Bootstrap surfaces are deleted; the workspace **Actions
  tab** reads the new endpoint (CODE/CONFIG badges, config actions run via the socket with an
  inline result panel); the workspace **Services/Bootstrap** tabs read the ConfigView-sourced DTOs.
- **Seeds**: `seed` no longer creates a demo daemon (services come from `.qits-config.yml`);
  `seed-webapp` no longer relies on clone-time ingestion — the fixture's config is read
  in-container per workspace, and its "Build & Verify" flow binds the code-seeded global `Bash`
  action in each step (the parallel lint pair collapsed to one binding). `cleanupStaleSeedGlobals`
  retained.
- **Kept**: `QitsConfigParser` (still serves `DetectionService`'s `frameworks` hint and the test
  fakes) and the `QitsConfig` record tree as the wire schema (`ConfigView.configJson`).

## Settled decisions (user calls during planning)

- **Config actions run over the control socket reusing `RunCommand`.** No new `DaemonMessage` was
  added: a config-action run is a plain `bash -lc <script>` in `/workspace` — exactly the verb the
  command substrate already speaks. The realization that made this work: `RunCommand` is already
  script-agnostic (cwd + env + streamed chunks + exit), so the run path needed only a controller,
  not a protocol change.
- **Runs are not recorded as `Command` rows.** In the interim (until the workspace-daemon MCP
  re-homes config actions) there is deliberately **no run history and no re-attach** for config
  actions; the run result returns inline to the UI. **Interactive config actions are listed but not
  runnable** — the pipe-mode `RunCommand` is non-interactive.

## Deviations from the plan

- **Bootstrap `runSingleAsync` 404 semantics.** The single re-run resolves the config `id:` to the
  step name against the workspace's ConfigView: **404 only when the config is readable and the id
  is absent**; when no daemon is live yet to read it (a cold workspace — the manual run itself
  provisions) the id **passes through** (ids default to names, so it is usually already the step
  name, and the daemon errors on a genuine mismatch).
- **V43's extra `action_configuration_env` delete.** Beyond the documented table drops, the
  migration first deletes the **env rows of repo-scoped actions** (the V4 FK) before deleting the
  actions themselves and dropping `repository_id` — a plain DROP would have orphaned them.
- **Shell-escaped reap marker.** Service identity becoming a **user-declared config string** (was a
  server-generated UUID) made the host `ServiceSupervisor`'s straggler-reap marker unsafe to embed
  in its shell scan verbatim; the marker value is now shell-escaped
  (`id.replace("'", "'\\''")` in `ServiceSupervisor.reapStragglers`).

## Non-goals

- Write-back from the UI — [Part 6](../feature-ideas/config-write-back-from-ui.md).
- Re-adding config-action MCP — a separate workspace-daemon-MCP idea.
- Richer feature-flow ↔ config interplay — flows keep code-based actions only.

## Testing

- **Removal regressions** — the repo Actions list shows only code-based actions; the feature-flow
  picker has no config actions; the removed endpoints/MCP tools are gone (404/absent); V43 applies
  cleanly on a seeded DB.
- **Workspace actions surface** — controller tests for the CODE/CONFIG union, the `RunCommand` run
  path (409 no-daemon / 404 unknown id / 400 interactive / inline result), and the
  `resolveStepName` 404-vs-pass-through split.
- **`seed-webapp`** — no reconcile step; the Build & Verify flow binds the code-seeded `Bash`
  action; the fixture's `.qits-config.yml` is read in-container per workspace.
- **OpenAPI + UI** — both committed `openapi.yml` copies (`docs/` + `service/src/main/webui/`)
  regenerated after the controller removals; the UI build stays green.
