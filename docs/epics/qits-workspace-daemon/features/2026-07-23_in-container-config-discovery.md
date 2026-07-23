# In-container config discovery — `.qits-config.yml` read from the checkout

> **Implemented 2026-07-23.** The daemon reads/parses `.qits-config.yml` from its own checkout and
> answers an id-correlated `DescribeConfig`→`ConfigView` (config as `QitsConfig`-shaped JSON); the
> backend exposes it via a framework-free `WorkspaceConfigReader` SPI (capability only — the UI/read
> path rewire is Part 5). **Parser home = daemon-local (Option A):** no shared module; the daemon owns
> a SnakeYAML parse (`ConfigParser` + `DaemonQitsConfig`), `domain`'s `QitsConfig`/`QitsConfigParser`
> stay put until Part 5. This change **also retired the host provisioning fallback** (see *Workstream
> B* at the end) — the daemon is now the sole provisioner. See `docs/implementation-plan.md` Part 2.

## Introduction

Part 2 of the **provisioning-inversion** track of [qits-workspace-daemon](../epic.md) (see the
[overview](daemon-self-provisioning-and-file-only-config.md)). Once the daemon has
[self-cloned `/workspace`](autonomous-self-clone-on-boot.md), it can do what the host never could:
**read `.qits-config.yml` from the actual checkout it just made** — the workspace's own branch — not
from the bare origin at `mainBranch`.

Today the config read is host-side and `mainBranch`-only: `QitsConfigParser.readConfig`
(`domain/.../repository/control/QitsConfigParser.java`) calls `GitExecutor.showFile(bareOrigin,
repo.mainBranch, ".qits-config.yml")` and `QitsConfigReconciler` upserts the result into DB rows.
Because it reads one branch from the bare origin, every workspace sees the same config regardless of
its branch — the "branch-divergent config" the `.qits-config` feature explicitly deferred
([Non-Goal #2](../../qits-project-repositories/features/2026-07-18_qits-config-in-repo-configuration.md)).

**Moving the read in-container flips that for free:** each daemon reads its own checkout, so a
workspace's config is its *branch's* config. A feature branch that edits `.qits-config.yml` (via the
coding agent or a human) changes that workspace's actions/daemons/bootstrap with no merge/precedence
machinery. This is the pivot that makes config **workspace-scoped** and enables
[file-as-single-source-of-truth](config-as-single-source-of-truth.md).

### Autonomous control model (option 1)

Config discovery is a step in the daemon's own startup sequence (clone → **config-read** →
bootstrap → daemons), self-initiated after the clone completes. qits is not in the read loop.

### Related / dependent plans

- **Hard dependency — [autonomous-self-clone-on-boot](autonomous-self-clone-on-boot.md)** — a
  checkout must exist to read from.
- **Reuses the parse shape from
  [`.qits-config` in-repo configuration](../../qits-project-repositories/features/2026-07-18_qits-config-in-repo-configuration.md)**
  — the YAML schema (`version: 1`, `actions`/`daemons`/`bootstrap`/`frameworks`/`repository`) and the
  `QitsConfig` record tree are unchanged as a *format*. What changes is *where* it is read (checkout,
  not bare origin) and that it is **no longer reconciled into DB rows** (that removal is
  [Part 5](config-as-single-source-of-truth.md)).
- **Feeds [daemon-run-bootstrap-chain](daemon-run-bootstrap-chain.md) and
  [daemon-supervised-dev-daemons](daemon-supervised-dev-daemons.md)** — the in-container config is
  the source those two steps run from.
- **Enables [config-as-single-source-of-truth](config-as-single-source-of-truth.md)** — the read
  moving in-container is precisely what lets the host drop its DB config store.

## What this defines

- **Where the daemon parses the file.** The `workspace-daemon` module has **no `domain` dependency**
  (deliberately, to keep the native image lean — it can't reuse `QitsConfigParser`/`QitsConfig`,
  which live in `domain` and pull SnakeYAML + entity enums). Options: (a) a tiny SnakeYAML parse in
  the daemon producing a framework-free config record it owns; (b) move the framework-free
  `QitsConfig` record tree + parser into a small shared module (like `workspace-daemon-protocol`) both
  `domain` and `workspace-daemon` depend on. **Leaning (b)** — one schema, no drift — but it must stay
  framework-free (the enum references `RepositoryArchetype`/`LogObserverKind`/… would need to move
  or degrade to strings). Decide during Part 2.
- **What is reported to qits.** The daemon runs bootstrap/daemons from the config in-container
  (parts 3/4), so qits may need **none** of it. But the UI still renders a workspace's actions/
  daemons/bootstrap list; that list now comes from the daemon reading its checkout, surfaced over the
  socket on request (a `Describe`-style `ConfigView` reply) rather than from DB rows. Define a
  `ConfigDiscovered`/`ConfigView` message carrying the parsed entries for display + on-demand run.
- **Absent/invalid file = empty config** (today's "degrade loudly, never block"): a config-free
  branch behaves exactly as an empty chain; a structurally invalid file surfaces a workspace-level
  warning over the socket, and provisioning still completes.

## Non-goals

- Removing the host DB config store — [Part 5](config-as-single-source-of-truth.md).
- Running bootstrap/daemons — [parts 3](daemon-run-bootstrap-chain.md) /
  [4](daemon-supervised-dev-daemons.md).
- Write-back from the UI — [Part 6](config-write-back-from-ui.md).
- Changing the YAML schema — the format is unchanged.

## Testing

- **Parse parity** — the in-container parser produces the same record tree as `QitsConfigParser` for
  the shared fixtures (`testing-repo-quarkus-angular`'s committed `.qits-config.yml`).
- **Branch divergence** — a workspace on a branch that edits `.qits-config.yml` reports the *edited*
  config; a sibling workspace on `main` reports the original — the branch-divergent property the old
  model couldn't express.
- **Empty / invalid** — a config-free branch and a malformed file both leave provisioning green with
  the expected empty/warning outcome.

## Code map (as shipped)

- **Protocol** (`workspace-daemon-protocol/.../protocol/`): `DescribeConfig` (qits → daemon) +
  `ConfigView{workspaceId, correlationId, configJson, warning}` (daemon → qits); `DaemonProtocol`
  `CONFIG_VIEW`/`DESCRIBE_CONFIG` types + `CONFIG_JSON`/`WARNING` fields; `DaemonCodec` arms; both
  added to the sealed `DaemonMessage`. `configJson` is a JSON string whose keys match `QitsConfig`, so
  `DaemonCodec` stays flat-string-only.
- **Daemon** (`workspace-daemon/`): `DaemonQitsConfig` (framework-free record tree mirroring
  `QitsConfig`, enum-ish fields as strings), `ConfigParser` (SnakeYAML `SafeConstructor`, ported from
  `QitsConfigParser.parse`), `ConfigJson` (record → `JsonObject` with `QitsConfig` keys + non-null
  collection defaults, hand-built — no Jackson databind in the native image), `ConfigReader` (file IO
  + degrade-to-warning). `ControlSocket` reads the config right after the clone (`configState`), and
  answers `DescribeConfig` on the worker pool. `snakeyaml` added to `workspace-daemon/pom.xml`.
- **Backend** (`service/.../workspacedaemonhost/`): `WorkspaceDaemonRegistry.describeConfig` +
  `readConfig` (implements the SPI; deserializes `configJson` → `QitsConfig`, surfaces the warning);
  id-keyed `pendingConfigs`; `qits.workspace.config.describe-timeout-ms`.
- **Domain SPI**: `WorkspaceConfigReader` + `WorkspaceConfigView(QitsConfig, warning)`.
- **Tests**: daemon `ConfigParserTest` (output-shape lock + empty/invalid), `DaemonCodecTest`
  round-trips, backend `readConfig` deserialize/warning/no-daemon in `DaemonControlSocketTest`. True
  cross-boundary parity vs `QitsConfigParser` + branch-divergence ride the extended real-docker path.

## Workstream B — the host provisioning fallback is retired

A directive accompanying this part: **provisioning is the daemon's responsibility** — so the Part-1
host-driven clone fallback is removed. `WorkspaceService.provisionContainer` now *always* awaits the
daemon; a missing provisioner or a daemon that never dials home is a provision **FAILURE** (`rm` +
`FAILED`), not a degradation to a host `docker exec git clone`.

- **Deleted** (`domain/.../WorkspaceService.java`): `hostDrivenClone`, the host `materializeSubmodules`
  walk + its `submoduleCheckedOut`/`gitlinkOnBranch`/`committedUrlIsRelative` helpers, `cloneUrl`,
  `MAX_SUBMODULE_DEPTH`, and the now-dead `RepositorySubmoduleRepository`/`QitsHostResolver`/
  `RepositoryNameResolver`/`qits-port` injections. `containerGit` stays (the on-demand fetch/merge/push
  verbs). `WorkspaceDaemonProvisioner.awaitProvision` gained a leading `repoId` (the container key —
  `workspaceId` alone repeats across repos).
- **Test seam**: `FakeWorkspaceDaemonProvisioner` (a `@Mock`, in `domain` + `service` `src/test`; cli
  never provisions) plays the daemon — clones the branch through `FakeContainerRuntime` and runs the
  daemon's bounded `.gitmodules` walk (native resolution, per-submodule skip, **no DB import-scoping**).
- **Behaviour change**: with no import-scoping, an un-imported submodule whose basename collides with a
  served sibling now materializes (the accepted Part-1 limitation, documented on
  `Provisioner.materializeSubmodules`). `WorkspaceSubmoduleProvisionTest`'s scoping test was rewritten
  to pin this (`collidingUnimportedSubmoduleMaterializesWithoutImportScoping`).
