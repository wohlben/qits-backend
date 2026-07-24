# Daemon-run bootstrap chain

> **Implemented 2026-07-23.** The daemon runs the bootstrap chain (install/migrate/seed) itself,
> from its in-container `.qits-config.yml` (Part 2), between the self-clone and daemon start — the
> host no longer `docker exec`s each command. Each step runs its optional `check` (non-zero ⇒
> SKIPPED) then `execute`; the chain fail-fast-aborts and ends with a terminal `Bootstrapped{ok}`
> the host awaits. `WorkspaceBootstrapRunner` became a thin **awaiter**: it records outcomes, settles
> the `bootstrap:<name>` process segments, and gates daemon auto-start on `ok` (still the only firer
> of `WorkspaceReadyForDaemons`). **Bootstrap steps run in-container now, so they leave no host
> `Command` audit rows** — their live output is the process segment. See the code map at the end and
> `docs/implementation-plan.md` Part 3.

## Introduction

Part 3 of the **provisioning-inversion** track of [qits-workspace-daemon](../epic.md) (see the
[overview](daemon-self-provisioning-and-file-only-config.md)). With the daemon
[self-cloned](autonomous-self-clone-on-boot.md) and its
[config read in-container](in-container-config-discovery.md), the **bootstrap chain (install /
migrate / seed) runs inside the daemon's own startup sequence** — between clone and daemon-start —
driven from the in-container config, not host-driven over `docker exec`.

Today the chain is a host-side observer: `WorkspaceBootstrapRunner`
(`domain/.../bootstrap/control/WorkspaceBootstrapRunner.java`) observes `WorkspaceContainerStarted`
(`@ObservesAsync`), resolves `BootstrapCommandService.resolveAll(repoId)` from DB rows, and runs each
command via `CommandService.launchScriptAndAwait` → `docker exec bash -lc`. It is the **only firer of
`WorkspaceReadyForDaemons`**, which is how bootstrap-before-daemons is made structural across two
async CDI observers (`WorkspaceContainerStarted` → bootstrap → `WorkspaceReadyForDaemons` → daemon
auto-start).

**Under this feature the ordering guarantee is preserved by construction** — clone, bootstrap, and
daemon-start are one linear sequence in one process (the daemon). No two-event CDI dance is needed
in-container; the host-side event chain is simplified accordingly.

### Autonomous control model (option 1)

The bootstrap chain is a step in the daemon's startup, self-run from the in-container config after
config discovery, before daemon start. qits does not instruct it per command.

### Related / dependent plans

- **Hard dependency** — [in-container-config-discovery](in-container-config-discovery.md) (the chain
  is read from the in-container config) and [autonomous-self-clone-on-boot](autonomous-self-clone-on-boot.md).
- **Absorbs [workspace bootstrap commands](../../qits-workspaces/features/2026-07-18_workspace-bootstrap-commands.md)**
  — the `install`/`seed` chain, its `check`-then-`execute` per-command contract, the
  generous-timeout-then-terminate policy, SKIPPED/SUCCEEDED/FAILED outcomes, and the fail-fast abort
  (a failed chain skips daemon auto-start, because a dev server on an unbootstrapped checkout would
  crash-loop and qits-in-qits' build guard would fail once `:8080` listens) all move into the
  daemon's sequence. The qits-in-qits ordering requirement is *why* this must run before daemons.
- **Precedes [daemon-supervised-dev-daemons](daemon-supervised-dev-daemons.md)** — a successful chain
  is the gate to daemon start; a failed chain stops the sequence there.
- **Reuses `CommandExecutor`** (`workspace-daemon/.../CommandExecutor.java`) — the in-container
  `ProcessBuilder` streaming primitive is exactly what each `check`/`execute` script runs on
  (streamed as `CommandChunk`/`DaemonLog`, terminal `CommandExit`).

## What moves

- **The chain runs in the daemon**, in `orderIndex`/file order, from the
  [in-container config](in-container-config-discovery.md)'s `bootstrap` entries. Each command: run
  the optional `check` (non-zero ⇒ SKIPPED, no run), else `execute` to completion; abort the rest on
  the first failure.
- **`WorkspaceBootstrapRunner`'s provision-time trigger is retired.** The host no longer observes
  `WorkspaceContainerStarted` to run the chain over `docker exec`. What remains host-side (if
  anything): the **outcome/log surface** (the Bootstrap tab, `BootstrapRunService.recordOutcome`,
  the BOOTSTRAP SSE hints) fed by the daemon streaming per-command progress + outcomes over the
  socket (a `BootstrapStep`/`BootstrapOutcome` message), and the **manual re-run** trigger (which
  becomes a socket instruction to the daemon rather than a host `docker exec`).
- **The host event chain collapses.** With bootstrap in the daemon, `WorkspaceContainerStarted` →
  `WorkspaceReadyForDaemons` no longer needs `WorkspaceBootstrapRunner` as the sequencing hinge; the
  daemon's `Provisioned`-then-`Bootstrapped` progression carries the ordering. Define the host-side
  simplification during build (keep the SSE-tracked `TechnicalProcess` segments fed from socket
  events).

## New wire messages

- **`BootstrapStep { workspaceId, name, phase(CHECK|EXECUTE|SKIP), ... }`** and **`BootstrapOutcome
  { workspaceId, name, outcome(SUCCEEDED|FAILED|SKIPPED), exitCode }`** — daemon → qits, feeding the
  Bootstrap tab + the streamed Start verdict.
- **`Bootstrapped { workspaceId, ok }`** — the chain-complete signal; `ok=false` means the sequence
  stops before daemons (parity with today's "failed chain never fires ready").
- **`RunBootstrap { correlationId, ... }`** *(qits → daemon)* — the manual re-run trigger.

## Failure surfacing ("degrade loudly", re-homed onto the socket)

A bootstrap failure now happens inside the daemon's startup, not in a host-observed `docker exec`.
The socket must carry a clear failed signal (the messages above) so the Bootstrap tab and the
streamed Start's `done` verdict settle exactly as today. The workspace stays usable; daemons are not
started.

## Non-goals

- Daemon start — [next part](daemon-supervised-dev-daemons.md).
- Removing the DB `BootstrapCommand` rows / repo-scope — [Part 5](2026-07-24_config-as-single-source-of-truth.md)
  (this part re-homes the *runner*; Part 5 removes the *store*).
- Write-back — [Part 6](config-write-back-from-ui.md).

## Testing

- **Fake-client chain** — ordered run, `check` skip, fail-fast abort, timeout-then-terminate, and the
  "failed chain ⇒ no daemons" gate, all against the fake control client (real host processes, so
  termination stays end-to-end testable).
- **Ordering** — clone → bootstrap → daemons is one sequence; assert daemons never start before the
  chain completes (the qits-in-qits guarantee).
- **`seed-webapp` regression** — the fixture's declared bootstrap still runs and the Build & Verify
  flow still works end-to-end.

## Code map (as shipped)

- **Protocol** (`workspace-daemon-protocol/.../protocol/`): `BootstrapStep{workspaceId, name,
  phase(CHECK|EXECUTE|SKIP)}`, `BootstrapOutcome{workspaceId, name, outcome(SKIPPED|SUCCEEDED|FAILED),
  exitCode}`, `Bootstrapped{workspaceId, ok}` (daemon → qits), `RunBootstrap{correlationId, name}`
  (qits → daemon, manual re-run); `DaemonProtocol` `BOOTSTRAP_STEP`/`BOOTSTRAP_OUTCOME`/
  `BOOTSTRAPPED`/`RUN_BOOTSTRAP` types + `NAME`/`PHASE`/`OUTCOME`/`OK` fields +
  `BOOTSTRAP_CORRELATION_PREFIX` (`bootstrap:<name>` tags a step's streamed `CommandChunk`s); all four
  added to the sealed `DaemonMessage` + `DaemonCodec` arms. `DaemonCodecTest` round-trips.
- **Daemon** (`workspace-daemon/`): new `BootstrapRunner` (framework-free, forks `bash -lc` per step,
  check→skip / execute, fail-fast, per-step timeout→terminate, streams `bootstrap:<name>` chunks +
  emits the step/outcome/terminal messages). `ConfigReader.State` now retains the parsed
  `DaemonQitsConfig` (not just its JSON) so the chain reads from it. `ControlSocket.startProvisioning`
  runs the chain after config-read — **fresh clone only**, gated by
  `QITS_WORKSPACE_DAEMON_BOOTSTRAP_AUTORUN`; `onFrame` handles `RunBootstrap`. `Provisioner.provision`
  now returns a boolean so the daemon skips bootstrap on a failed provision. `BootstrapRunnerTest`
  (real processes) locks order/skip/fail-fast/timeout/empty/single.
- **Backend** (`service/.../workspacedaemonhost/`): `WorkspaceDaemonRegistry` implements a new
  `WorkspaceBootstrapDriver` SPI — `awaitBootstrap` (the autonomous boot path) + `runBootstrap`
  (manual). A registry-keyed `PendingBootstrap` **buffers step events + retains the terminal**, since
  the autonomous chain can finish before the host's async observer registers its await;
  `awaitProvision` clears any stale slot per cycle. `onMessage` routes
  `BootstrapStep`/`BootstrapOutcome`/`Bootstrapped` + `bootstrap:*` chunks. New backend socket tests.
- **Host domain** (`domain/`): new framework-free `WorkspaceBootstrapDriver` SPI (`Result`,
  `StepSink`). `WorkspaceBootstrapRunner` rewired from host `docker exec`/`launchScriptAndAwait` to
  awaiting the driver — a `RecordingSink` opens/settles `bootstrap:<name>` segments, records outcomes
  (name↔DB-row by base name; `commandId` now null), fires BOOTSTRAP hints, and still owns firing
  `WorkspaceReadyForDaemons` (gated on `ok`). `WorkspaceContainerFactory` injects the autorun env.
- **Tests**: `FakeWorkspaceBootstrapDriver` (`@Mock`, domain + service `src/test`) plays the daemon's
  chain through `FakeContainerRuntime`; the host `WorkspaceBootstrapRunnerTest`/controller tests keep
  order/skip/fail-fast/gate/manual coverage (audit-row assertions dropped). Extended real-docker
  `DaemonBootstrapIT` (`-Pextended`) boots a real container that runs its committed `.qits-config.yml`
  chain in-daemon (one run, one check-skip) with no host `docker exec bash -lc`.
