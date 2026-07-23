# Implementation plan — provisioning inversion + `.qits-config.yml` as single source of truth

A step-by-step build order for the **provisioning-inversion track** of the
[qits-workspace-daemon epic](epics/qits-workspace-daemon/epic.md). The design is split across six
dependency-ordered feature-ideas (overview:
[daemon-self-provisioning-and-file-only-config](epics/qits-workspace-daemon/feature-ideas/daemon-self-provisioning-and-file-only-config.md)).
Build in the order below; each part is independently reviewable and, on completion, moves its
feature-idea to `features/YYYY-MM-DD_*.md` and flips the epic Status.

## Ground rules (apply to every part)

- **Autonomous control model (option 1).** The daemon self-initiates provisioning from its injected
  `QITS_WORKSPACE_DAEMON_*` env (`WorkspaceContainerFactory.java:182`). qits does not issue per-step
  clone/bootstrap/daemon instructions for *first* provisioning; it **sends the daemon nothing** and
  awaits socket events (`Provisioned`/`ProvisionFailed`, etc.). qits issues only *subsequent*
  on-demand operations. **(Part 1 confirmed this literally: no `ProvisionRequest`, no closure
  hand-off — the daemon discovers submodules in-container from `.gitmodules`.)**
- **Degradation contract.** Socket down (stale image, no `Hello`) ⇒ **exactly today's behaviour**:
  each migrated call site keeps its `docker exec` fallback until that verb is retired. Enforce
  structurally via `WorkspaceDaemonLiveness.isDaemonLive(workspaceId)` + a bounded await.
  **Exception — the clone/provision verb is retired as of Part 2** (per the directive that
  provisioning is the daemon's responsibility): `WorkspaceService.provisionContainer` no longer falls
  back to a host-driven `docker exec git clone`. A container with no live daemon (a stale, pre-daemon
  image) now **fails to provision** (rm + `FAILED`) instead of degrading — recoverable by rebuilding
  the image so the daemon is present.
- **Protocol changes are compiler-enforced on both sides.** A new verb = a `DaemonMessage` record +
  `permits` entry + `DaemonProtocol.Type`/`Field` constant + `DaemonCodec.encode`/`decode` arm. Both
  `switch`es are exhaustive over the sealed type, so the compiler forces both the `service` (Jackson)
  and `workspace-daemon` (Vert.x `JsonObject`) sides. Files:
  `workspace-daemon-protocol/src/main/java/eu/wohlben/qits/workspacedaemon/protocol/`.
- **Backend send/await pattern.** New qits→daemon verbs mirror `WorkspaceDaemonRegistry.runCommand`
  (`service/.../workspacedaemonhost/WorkspaceDaemonRegistry.java`): generate a correlationId, register
  a pending future on the `DaemonConnection`, `sendTextAndAwait(codec.encode(msg))`, complete on the
  correlated reply arm in `onMessage`.
- **In-container work uses CLI `git`/`ProcessBuilder`, not JGit** — the `workspace-daemon` module
  deliberately excludes `domain` (native-image leanness). Build on `CommandExecutor`
  (`workspace-daemon/.../CommandExecutor.java`) and `WorkspaceDescriber` (CLI `git status`).
- **Never exit the daemon on failure** — the Part-1 invariant (`ControlSocket` reconnect/idle).
  Provisioning failures surface as socket events (`ProvisionFailed`, `Bootstrapped{ok:false}`), not
  process exit.
- **The `workspace-daemon` binary is native-compiled** (`docker/qits/Dockerfile` `workspace-daemon-build`
  stage). Any new daemon dependency must be native-image-safe; on a ≤4 GiB builder pass
  `-Dquarkus.native.additional-build-args=--parallelism=1`.

---

## Part 0 (prerequisite) — [project-scoped-name-addressed-git-serving](epics/qits-project-repository-submodules/feature-ideas/project-scoped-name-addressed-git-serving.md)

**Lands first**, in the [qits-project-repository-submodules](epics/qits-project-repository-submodules/epic.md)
epic (not this one). Serves a project's repositories as siblings under `/git/<projectId>/<name>`
(names via a repository **link table**), so committed relative submodule urls resolve **natively** and
provisioning becomes a plain clone + a **bounded, depth-capped walk over the imported edge closure**
(native for relative urls, name-addressed override only for absolute urls; bounded rather than
`--recurse-submodules` for cycle safety). It replaces the per-level id-addressed `submodule.<name>.url`
override with native/name-addressed resolution and moves import to **full-closure recursive**.

**Why it comes before Part 1:** it **shrinks** Part 1's hardest piece. Native relative resolution
removes the id→url mapping and per-level override from the daemon's job — but the daemon still needs
the **imported-edge closure** to scope the walk and redirect any absolute urls. So the
`ProvisionRequest` / "submodule closure source" design question below is **reduced, not eliminated**:
a lighter closure (imported paths + absolute-url child names) rather than a full id-map. Part 1 is:
clone-on-boot + the name-addressed submodule walk + `Provisioned` / `ProvisionFailed`. The daemon env
it needs (`QITS_WORKSPACE_DAEMON_PROJECT_ID` / `…_REPO_NAME`) is injected **with Part 1** (its only
consumer). See that feature-idea for the full design.

---

## Part 1 — [autonomous-self-clone-on-boot](epics/qits-workspace-daemon/features/2026-07-23_autonomous-self-clone-on-boot.md) ✅ implemented 2026-07-23

The daemon clones `/workspace` (+ the name-addressed submodule walk — see **Part 0**) from its env on
boot; the host stops driving the clone and awaits `Provisioned`. **As shipped, fully autonomous:** no
`ProvisionRequest`/closure hand-off — the daemon discovers submodules in-container from `.gitmodules`
(Part-0 name-addressing resolves them natively), and `WorkspaceContainerFactory` injects
`QITS_WORKSPACE_DAEMON_PROJECT_ID`/`…_REPO_NAME` so the self-clone is name-addressed. The checklist
below is retained as the record; the settled decisions live in the moved feature doc.

**Protocol**
- [ ] Add `Provisioned { workspaceId, head }` and `ProvisionFailed { workspaceId, message }`
      (daemon → qits), plus a `ProvisionRequest`/closure hand-off carrying the **imported-edge
      closure** (paths to scope the walk + child names for any absolute-url redirect). Lighter than
      the pre-Part-0 id-map, but not eliminated.
- [ ] Reuse `RunCommand`/`CommandChunk`/`CommandExit` for the in-container `git clone`, or fork `git`
      in a dedicated daemon `Provisioner` (a dedicated verb keeps clone output tagged for the `clone`
      `TechnicalProcess` segment).

**Daemon binary (`workspace-daemon/`)**
- [ ] In `ControlSocket.onConnected` (after `Hello`), off the event loop (worker pool), derive the
      git-host base from the dial-home URL host/port (`ws://qits:8080/…` → `http://qits:8080/git`),
      `git clone --branch <branch> http://qits:8080/git/<projectId>/<repoName> /workspace` (from the
      `QITS_WORKSPACE_DAEMON_PROJECT_ID` / `…_REPO_NAME` env Part 0 injects), then reproduce Part 0's
      **name-addressed submodule walk** (`WorkspaceService.materializeSubmodules`) driven by the
      handed-over imported-edge closure: relative submodules resolve **natively** (no override);
      absolute ones get a name-addressed redirect. No `repositorySubmoduleRepository` in-container —
      the closure arrives over the socket.
- [ ] Emit `Provisioned{head}` on success (`git rev-parse HEAD`), `ProvisionFailed{message}` on
      failure; stream clone output as `CommandChunk`/`DaemonLog`.

**Backend socket (`service/.../workspacedaemonhost/`)**
- [ ] `WorkspaceDaemonRegistry`: handle inbound `Provisioned`/`ProvisionFailed`, completing a
      `CompletableFuture<ProvisionResult> awaitProvisioned(workspaceId, timeout)`.

**Host wiring (`domain`)**
- [ ] `WorkspaceService.provisionContainer` (`WorkspaceService.java:192`): after `containers.run`,
      **if a client is/soon becomes live**, await `Provisioned` (feed the `clone` segment from socket
      events) instead of running the host-driven `containers.exec("git","clone",…)` + Part-0
      `materializeSubmodules`. On `ProvisionFailed`/timeout → `containers.rm` + `FAILED` (parity).
- [ ] **Fallback branch**: no live client within the await ⇒ run the Part-0 host-driven clone +
      `materializeSubmodules` unchanged.
- [ ] `WorkspaceContainerStarted` still fires after the checkout exists (now gated on `Provisioned`,
      not the host clone returning).

**Tests**
- [ ] `FakeContainerRuntime` (`domain`/`service`/`cli` `src/test`): a daemon-provisioned workspace
      still yields the checkout the suite expects; assert no host `docker exec git clone`.
- [ ] Degradation: no live client ⇒ host clone fallback, byte-for-byte argv for a submodule-free repo.
- [ ] Extended real-docker IT (`-Pextended`): a real container self-clones a depth-2 submodule closure
      (`submodule-super.git`) via native `--recurse-submodules` with no host `docker exec git`.

**Docs move** → `features/2026-…_autonomous-self-clone-on-boot.md`; epic Status.

---

## Part 2 — [in-container-config-discovery](epics/qits-workspace-daemon/features/2026-07-23_in-container-config-discovery.md) ✅ implemented 2026-07-23

The daemon reads/parses `.qits-config.yml` from the checkout (its own branch). Pivot to file-as-truth.
**Also retired the host provisioning fallback** (Workstream B — the daemon is now the sole
provisioner; per directive). See the moved feature doc for the settled design.

**Shared parser decision → daemon-local (Option A).** The daemon owns the file; no shared module.
`domain`'s `QitsConfig`/`QitsConfigParser` stay put (still used by the reconciler until Part 5). The
daemon got its own SnakeYAML parse (`ConfigParser` + framework-free `DaemonQitsConfig`, enum-ish
fields as strings) — moving the 6 config enums into a shared module would have touched ~36 files for a
schema Part 5 partly dismantles.

**Protocol**
- [x] `DescribeConfig{correlationId}` (qits → daemon) + `ConfigView{workspaceId, correlationId,
      configJson, warning}` (daemon → qits) — the parsed config as a **JSON string of `QitsConfig`'s
      shape** (single wire schema; `DaemonCodec` unchanged, all flat strings). Id-correlated (fixes the
      Part-1 FIFO `WorkspaceInfo` stub).

**Daemon binary**
- [x] After the Part-1 clone, read+parse `/workspace/.qits-config.yml` (`ConfigReader`); absent/blank
      ⇒ empty, invalid ⇒ empty + warning (never blocks). Held in-daemon (`ControlSocket.configState`)
      for parts 3/4; answers `DescribeConfig` on the worker pool.

**Backend / host**
- [x] `WorkspaceDaemonRegistry.describeConfig(workspaceId)` → `ConfigView`; new framework-free
      `WorkspaceConfigReader` SPI (`readConfig → Optional<WorkspaceConfigView(QitsConfig, warning)>`)
      the registry implements by deserializing the wire JSON into `QitsConfig`. **Capability + SPI
      only** — the UI/read-path rewire to consume it is Part 5.

**Tests**
- [x] Daemon `ConfigParserTest` (output shape lock, empty/invalid), `DaemonCodecTest` round-trips,
      backend `readConfig` deserialize + warning + no-daemon.
- [ ] Branch divergence + true cross-boundary parity vs `QitsConfigParser` on the shared fixture ride
      the extended real-docker path (a Part-3+ IT; the JVM suite pins each side).

**Workstream B — retire the host provisioning fallback**
- [x] `provisionContainer` always awaits the daemon; deleted `hostDrivenClone`,
      `materializeSubmodules` + helpers, `cloneUrl`, the `RepositorySubmoduleRepository`/`qitsHost`
      injections. `awaitProvision` gained `repoId` (unique container key). No live daemon ⇒ `FAILED`.
- [x] Test seam: `FakeWorkspaceDaemonProvisioner` (`@Mock`, domain + service) plays the daemon's
      clone + `.gitmodules` walk. `WorkspaceSubmoduleProvisionTest` updated (no import-scoping — the
      collision now materializes, the accepted Part-1 limitation).

**Docs move** → `features/2026-07-23_in-container-config-discovery.md`; epic Status.

---

## Part 3 — [daemon-run-bootstrap-chain](epics/qits-workspace-daemon/feature-ideas/daemon-run-bootstrap-chain.md)

The bootstrap chain runs inside the daemon's startup, from the in-container config; ordering by
construction.

**Protocol**
- [ ] `BootstrapStep { workspaceId, name, phase }`, `BootstrapOutcome { workspaceId, name, outcome,
      exitCode }`, `Bootstrapped { workspaceId, ok }` (daemon → qits); `RunBootstrap { correlationId,
      … }` (qits → daemon, manual re-run).

**Daemon binary**
- [ ] Run the chain in file/`orderIndex` order from the Part-2 config: per command, optional `check`
      (non-zero ⇒ SKIPPED, no run), else `execute` to completion via `CommandExecutor`; abort the rest
      on first failure; generous timeout → terminate. Emit `BootstrapStep`/`BootstrapOutcome`, then
      `Bootstrapped{ok}`. A failed chain **stops the sequence before daemons**.

**Host wiring (`domain`)**
- [ ] Retire the provision-time trigger of `WorkspaceBootstrapRunner`
      (`domain/.../bootstrap/control/WorkspaceBootstrapRunner.java` `onContainerStarted`). Keep the
      **outcome/log surface** (`BootstrapRunService.recordOutcome`, BOOTSTRAP SSE hints, the Bootstrap
      tab, `TechnicalProcess` segments) fed from the socket events instead of host `docker exec`.
- [ ] Collapse the `WorkspaceContainerStarted` → `WorkspaceReadyForDaemons` hinge: the daemon's
      `Provisioned`→`Bootstrapped` progression now carries the ordering. Keep the streamed Start
      verdict wiring.
- [ ] Manual re-run (`runChainAsync`/`runSingleAsync`) becomes a `RunBootstrap` socket instruction.

**Tests**
- [ ] Fake-client: ordered run, `check` skip, fail-fast abort, timeout-terminate, "failed chain ⇒ no
      daemons" gate.
- [ ] Ordering: daemons never start before the chain completes (the qits-in-qits build-guard
      requirement — bootstrap before anything listens on `:8080`).
- [ ] `seed-webapp` regression: the fixture's bootstrap runs; Build & Verify still works.

**Docs move** → `features/2026-…_daemon-run-bootstrap-chain.md`; epic Status. Also note the absorbed
`../qits-workspaces/features/2026-07-18_workspace-bootstrap-commands.md`.

---

## Part 4 — [daemon-supervised-dev-daemons](epics/qits-workspace-daemon/feature-ideas/daemon-supervised-dev-daemons.md)

Dev daemons start as the tail of the daemon's startup, supervised in-container. Autonomous reframing
of epic Part 5 (`daemon-supervision-handover.md`).

**Protocol** (carried from Part 5 draft)
- [ ] `StartDaemon { id, script, env }`, `SignalDaemon { id, signal }` (qits → daemon,
      manual/subsequent); `DaemonEvent { id, state, exitCode }` + daemon log chunks (daemon → qits).
      Auto-start needs no `StartDaemon` — the daemon self-starts the auto-start set from the Part-2
      config.

**Daemon binary**
- [ ] Once `Bootstrapped{ok:true}`, start each auto-start dev daemon as a supervised **child of PID 1**
      (no tmux): honour `restartPolicy`/`maxRestarts`/`stopSignal`/`readyPattern`; stream child logs
      over the socket (`CommandChunk` tagged by daemon id); push `DaemonEvent` liveness/exit;
      group-kill + reap escaped forks natively (no `/proc` scan). Re-report running daemons on
      reconnect (replaces tmux `adoptIfRunning`).

**Host wiring (`domain`)**
- [ ] `DaemonSupervisor` (`domain/.../daemon/control/DaemonSupervisor.java`) → thin coordinator: state
      machine, backoff, status/SSE events, segment settling, web-view proxy origin
      (`resolveTarget`→`ProxyOrigin`→`DaemonProxyRoute`) fed by `DaemonEvent`; **falls back to tmux
      `startDaemon`** when the socket is absent.
- [ ] `DaemonLifecycleCoupler` (`onReadyForDaemons`) no longer drives auto-start via docker; keep the
      stop coupling (`settleForWorkspace`) and `qits.daemons.*` knobs.

**Tests**
- [ ] Fake-client supervision: start/ready/crash/exit, log streaming, group-kill of a forked child.
- [ ] Extended real-docker IT: `quarkus:dev` under the daemon; forked JVM reaped on stop **without**
      `/proc`; web-view proxy resolves; adoption after a qits restart.

**Docs move** → `features/2026-…_daemon-supervised-dev-daemons.md`; retire the Part-5 draft; epic
Status.

---

## Part 5 — [config-as-single-source-of-truth](epics/qits-workspace-daemon/feature-ideas/config-as-single-source-of-truth.md)

Host-side inversion: remove the repo-scoped DB config store + its MCP/feature-flow/UI surface. Only
after parts 2–4 make the in-container read the live source.

**Remove (`domain`/`service`)**
- [ ] `QitsConfigReconciler` + its triggers in `RepositoryService.cloneOne`/`pullRepository` + the
      `POST /repositories/{id}/config/reload` endpoint (`RepositoryController`). Keep `QitsConfig`/
      `QitsConfigParser` only if reused by the shared parser (Part 2); otherwise delete the host copy.
- [ ] Repo scope of `ActionConfiguration` (`listByRepositoryId`/`listEffective` → global-only;
      `ActionResolutionService.effectiveActions` returns only code-based global actions — the seeded
      `Bash` (`ActionConfigurationSeeder.java:36`) + the agent path). `RepositoryActionsController`
      returns global-only (or is removed).
- [ ] `RepositoryDaemon` (entity + `RepositoryDaemonService` + `RepositoryDaemonController` +
      `DaemonLifecycleCoupler` repo-level query `findByRepositoryId`) and `BootstrapCommand` (entity +
      service + controller). **Flyway migration drops** those tables/columns (`domain/.../db/migration`).
- [ ] MCP: `RepositoryMcpTools.listActions/runAction` (`:251/:268`), `ActionConfigurationMcpTools`
      repository tools.
- [ ] Feature-flow binding to config actions: the project-scoped guard + `isActionBound` in
      `FeatureFlowPhaseActionService.create`. Only code-based actions remain bindable.

**Ids**
- [ ] Adopt explicit string `id:` per declared entry (replaces `@qits-config` name-namespacing);
      duplicate id = allowed user error. Update the parser + any `configName`/`baseName` usage.

**UI**
- [ ] Remove the repo-detail config-warning banner + "Reload config" button + Daemons/Bootstrap pages;
      the repo Actions list shows only code-based actions. The workspace's config list comes from the
      Part-2 `ConfigView`.

**Tests / cross-copies**
- [ ] Removal regressions (list, picker, endpoints/MCP absent); Flyway drop applies on a seeded DB.
- [ ] Regenerate **both** `docs/openapi.yml` and `service/src/main/webui/openapi.yml` (see memory
      `openapi-two-copies`) after controller removals; then `pnpm generate:api`; UI build green.
- [ ] `seed-webapp` shrinks (no reconcile); assert Build & Verify binds code-based actions.

**Docs move** → `features/2026-…_config-as-single-source-of-truth.md`; note the reversed
`../qits-project-repositories/features/2026-07-18_qits-config-in-repo-configuration.md`; epic Status.

---

## Part 6 — [config-write-back-from-ui](epics/qits-workspace-daemon/feature-ideas/config-write-back-from-ui.md)

The config UI writes edits back into `/workspace/.qits-config.yml` as a working-tree change (never an
auto-commit). **Depends on the Part-3 file transport**
([container-file-access-over-socket](epics/qits-workspace-daemon/feature-ideas/container-file-access-over-socket.md)) —
land that (or its `ReadFile`/`WriteFile` verbs) first.

**Daemon / backend**
- [ ] Use the file-access verbs to read `/workspace/.qits-config.yml` for the form and write the
      re-serialized file on save. No commit.

**UI (`service/src/main/webui`)**
- [ ] Flip the config cards/forms from read-only badge (`shared/utils/config-origin.ts`) to editable,
      under the **workspace-detail** view: `ui/components/{action-configuration,daemon,bootstrap}/…`
      cards + `pattern/{action-configuration,daemon,bootstrap}/…` forms. Serialize the form to YAML
      (stable key order, `version: 1`, explicit ids preserved).

**Tests**
- [ ] Round-trip: UI edit → file written → daemon re-reads → config view reflects it, working tree
      dirty, no commit.
- [ ] Try-before-commit: edit a daemon `start`, re-run against the live container, new definition
      takes effect pre-commit.
- [ ] Browser/screenshot coverage for the editable affordance; both `openapi.yml` copies if the API
      surface changes.

**Docs move** → `features/2026-…_config-write-back-from-ui.md`; epic Status → track done.

---

## Cross-cutting risks / reminders

- **Suite OOM (memory `quarkus-suite-oom-batching`)** — the full `domain`/`service` suites OOM
  (exit 137) under the 4 GiB cgroup. Run in package batches with capped forks; don't run the whole
  suite at once.
- **OpenAPI two copies (memory `openapi-two-copies`)** — `docs/openapi.yml` and
  `service/src/main/webui/openapi.yml` are separate committed copies; sync both (Part 5/6) before
  `pnpm generate:api`. Regenerate via `./mvnw -pl service -am test -Dtest=OpenApiSchemaExportTest`.
- **Never build the reactor while `quarkus:dev` runs** — the build guard fails at `pre-clean` if
  `:8080` listens. Stop dev first (`pkill -f quarkus:dev; pkill -f 'target/.*-dev.jar'`).
- **Native builder memory** — on ≤4 GiB, `-Dquarkus.native.additional-build-args=--parallelism=1`
  for the `workspace-daemon-build` stage.
- **Fixture round-trip is two-level** — `testing-repo-quarkus-angular`'s `.qits-config.yml` edits:
  commit in the fixture repo → bump the `webui` gitlink → bump that gitlink in qits.
- **`FakeContainerRuntime` in three modules** — keep the `domain`/`service`/`cli` `src/test` copies in
  sync when the container/daemon seam changes.
- **Extended ITs are opt-in** (`-Pextended`) and self-skip without docker + the `qits/workspace`
  image; build the image first:
  `docker build -t qits/workspace --target workspace -f docker/qits/Dockerfile .`
