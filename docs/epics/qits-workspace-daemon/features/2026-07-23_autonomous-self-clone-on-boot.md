# Autonomous self-clone on boot

> **Implemented 2026-07-23.** Fully autonomous, per the resolved control model: the daemon
> self-provisions from its boot-time env and qits sends it **nothing**; the only provisioning traffic
> is the daemon → qits `Provisioned`/`ProvisionFailed` it reports home. There is **no
> `ProvisionRequest` and no submodule-closure hand-off** — submodules are discovered in-container from
> the checkout's own `.gitmodules` (the *option (b)* below), which Part-0 name-addressing makes
> resolve natively. See `docs/implementation-plan.md` Part 1 and the code map at the end.

## Introduction

Part 1 of the **provisioning-inversion** track of [qits-workspace-daemon](../epic.md) (the
autonomous reframing of [Part 4](in-container-git-verbs-over-socket.md) — see the
[overview](daemon-self-provisioning-and-file-only-config.md)). Today, materializing a workspace is a
host-orchestrated `docker exec` sequence: `WorkspaceService.provisionContainer`
(`WorkspaceService.java:192`) runs `docker run`, then host-drives `git clone --branch` and per-level
submodule wiring through `containerGit()` (`WorkspaceService.java:122`, i.e. `docker exec git …`).

This feature moves the **initial clone + submodule wiring** into the container's own
`qits-workspace-daemon`, which already boots as PID 1's child and already receives its identity as
run-time env (`WorkspaceContainerFactory.java:182`: `QITS_WORKSPACE_DAEMON_URL`,
`…_REPOSITORY_ID`, `…_BRANCH`, `…_WORKSPACE_ID`, `…_PARENT`). **On boot, right after the `Hello`
handshake, the daemon clones `/workspace` for its own repository/branch and wires submodules —
autonomously, from its start-time env, with no host `docker exec` and no per-step instruction.** The
host's role in provisioning collapses to `docker run` (which it already composes) plus **waiting for
the daemon's `Provisioned` signal** over the control socket.

### Autonomous control model (option 1)

The daemon **self-initiates** the clone from its injected env — it is not told to clone by qits. This
is the resolved control model for the whole provisioning-inversion track (see the
[overview](daemon-self-provisioning-and-file-only-config.md#the-autonomous-decision-option-1)):
first provisioning is a property of the container's own startup. qits issues only *subsequent*
on-demand git operations (re-clone, the fetch/merge/push verbs) over the socket — those stay
[Part 4](in-container-git-verbs-over-socket.md).

### Related / dependent plans

- **Hard dependency — [Part 1](../features/2026-07-22_workspace-daemon-binary-and-control-socket.md)
  (shipped 2026-07-22).** The dial-home env, the WebSocket control socket, the `DaemonMessage`
  envelope + `DaemonCodec`, the `WorkspaceDaemonRegistry` correlated-reply seam, `CommandExecutor`
  (in-container `ProcessBuilder` streaming), and the `WorkspaceDaemonLiveness` SPI are the primitives
  this builds on. Nothing new about reachability.
- **Absorbs the clone piece of [Part 4 — in-container-git-verbs-over-socket](in-container-git-verbs-over-socket.md).**
  Part 4's "consider making the initial clone daemon-driven on boot" becomes this feature; Part 4
  keeps the *on-demand* verbs (fetch / ff-merge / push / `rev-parse HEAD` / submodule-wire),
  qits-instructed.
- **Unblocks [in-container-config-discovery](in-container-config-discovery.md)** — a checkout must
  exist before `.qits-config.yml` can be read from it. This feature is what produces that checkout.
- **Credential — deferred, references [Part 6 / scoped tokens](mcp-termination-and-token-provisioning.md).**
  No credential is needed for a first cut: the JGit git host `/git/*` is **token-free** in
  `PublicPaths` (`path.startsWith("/git/")`), exactly as the host-driven clone runs unauthenticated
  today. Hardening the self-clone with a scoped token is Part 6's concern, not this one.
- **Consistent with [lazy provisioning](../../qits-workspaces/features/2026-07-08_lazy-workspace-container-provisioning.md)**
  — creation still writes only the branch ref + `STOPPED` row; the container (and now its self-clone)
  materializes on first use.

## What moves

- **`WorkspaceService.provisionContainer` (`:192`) stops driving the clone.** It still `docker run`s
  the container (streaming the `docker-run` segment). It then **waits for the daemon's `Provisioned`
  event** (a new socket message) instead of running `git clone --branch … /workspace` +
  `wireSubmodules` via `containers.exec`.
- **The clone + submodule wiring run in-container, in the daemon.** The daemon derives the git-host
  URL from its dial-home URL host/port (`ws://qits:8080/…` → `http://qits:8080/git/<repoId>`) — no
  new env needed — and runs CLI `git` (the binary has no JGit; it forks `git`, mirroring
  `WorkspaceDescriber`). Submodule wiring reproduces `WorkspaceService.wireSubmodules` /
  `submoduleWiringCommands` semantics per level; the **imported-edge closure** the daemon must
  materialize is reported to it (see *Design questions*).

## New wire messages (as shipped)

Two verbs, **daemon → qits only** — qits never sends the daemon a provisioning message (the
autonomous model). `ProvisionRequest` was **not** added: with in-container `.gitmodules` discovery
there is nothing for the host to hand over.

- **`Provisioned { workspaceId, head }`** — sent when `/workspace` is checked out and submodules
  materialized. Carries the new HEAD sha (`git rev-parse HEAD`).
- **`ProvisionFailed { workspaceId, message }`** — the "degrade loudly" signal: the clone failed
  in-container. qits marks the workspace `FAILED` with the message and `containers.rm`s (parity with
  the old host clone's `InternalServerErrorException` + `rm`).

Each is a `DaemonMessage` record (+ `permits`), a `DaemonProtocol.Type` constant (reusing the
existing `WORKSPACE_ID`/`HEAD`/`MESSAGE` fields), and an encode/decode arm in `DaemonCodec` (both
`switch`es exhaustive — the compiler enforces both sides). Streamed clone/submodule output rides the
existing `CommandChunk`, tagged with the shared `DaemonProtocol.PROVISION_CORRELATION_ID` so the
backend routes it to the workspace's `clone` process segment. On the backend,
`WorkspaceDaemonRegistry` implements the framework-free `WorkspaceDaemonProvisioner` SPI: a
workspace-keyed pending future (survives a socket reconnect mid-clone), **complete-or-retain** so a
terminal event that beats the awaiter isn't lost.

## Degradation contract (socket-down ⇒ today's behaviour)

A container from a **stale image** (built before Part 1) has no daemon, never sends `Hello`, and
never sends `Provisioned`. `WorkspaceService.provisionContainer` must **fall back to the existing
host-driven `docker exec git clone` + `wireSubmodules`** when no client is live for the workspace
within a bounded wait (`WorkspaceDaemonLiveness.isDaemonLive` + a provisioned-await timeout). This
keeps the epic invariant: *socket down ⇒ exactly today's behaviour*. The fallback path is deleted
only when Part 4 retires the host-side git verbs entirely.

## Design questions — resolved

- **Submodule closure source → (b), in-container `.gitmodules` discovery.** The user's directive was
  emphatic: *do it on boot from env, don't contact qits for anything.* So the daemon does **not**
  receive the DB imported-edge closure; it discovers submodules from the checkout's own
  `.gitmodules` in a bounded, depth-capped walk (`Provisioner.materializeSubmodules`, mirroring the
  host's `WorkspaceService.materializeSubmodules` structure). Part-0 name-addressing makes committed
  **relative** urls resolve natively against the served project siblings; an **absolute** url is
  redirected to `<gitBase>/<projectId>/<basename>`. This drops the host's DB import-*scoping*: the
  daemon materializes what the branch's `.gitmodules` references, **skipping (with a warning) any
  submodule it can't fetch** — an un-imported submodule with no served sibling is left uninitialized,
  the same end state as the host skipping a non-imported edge, without needing the DB. (a) — a
  closure hand-off over `ProvisionRequest` — was **rejected** as it violates the autonomous model.
- **Root clone addressing.** The daemon needs the project scope to clone name-addressed
  (`/git/<projectId>/<repoName>`) so relative submodules resolve. `WorkspaceContainerFactory` now
  injects `QITS_WORKSPACE_DAEMON_PROJECT_ID`/`…_REPO_NAME` (resolved via the shared
  `RepositoryNameResolver`, the same self-name logic `cloneUrl` uses); the daemon derives the git
  host from its dial-home `ws://…` URL. Blank scope ⇒ id-addressed fallback (`/git/<repoId>`).
- **Await + timeout + fallback placement.** `provisionContainer` keeps the `docker-run` segment,
  opens the `clone` segment, then `awaitDaemonProvision`: **never-connected within a short
  connect-timeout ⇒ fall back** to the host-driven `docker exec git clone` + `materializeSubmodules`
  (byte-for-byte today's behaviour); **connected-then-failed/timeout ⇒ `containers.rm` + FAILED**
  (no fallback — the daemon may have left a half-populated `/workspace`). Streamed daemon output
  feeds the same `clone` segment.
- **Idempotency.** The daemon self-provisions **once** per process (`ControlSocket` run-once latch);
  an existing `/workspace/.git` (reconnect after a container restart) is never re-cloned — it
  re-emits `Provisioned` from the current HEAD.
- **HEAD identity.** Unchanged: the commit identity arrives as container-level `GIT_*` env
  (`gitIdentity.envMap()`), inherited by the daemon's `git` process.

## Known limitations (accepted trade-offs of the autonomous model)

- **No import-scoping of submodules.** The daemon materializes every submodule the branch's
  `.gitmodules` names (it has no DB), not just the imported edge closure. Un-imported submodules with
  no served sibling fail-to-fetch and are skipped; the sharp edge is a **basename collision** — an
  un-imported submodule whose basename coincides with a *different* served repo in the same project
  resolves to that sibling and materializes unrelated content. Re-scoping would require the host to
  hand over the imported closure (the rejected `ProvisionRequest`). Tracked here; revisit if a real
  collision is hit. (Host fallback still scopes correctly, so behaviour differs by whether a daemon
  is live.)
- **Slow-daemon fallback collision.** If a *modern* daemon connects only after the
  `provision.connect-timeout-ms` window (default 30s — pathological on qits-net), the host fallback
  and the daemon can both clone `/workspace`; the host clone into the now-non-empty dir fails cleanly
  (→ FAILED, recoverable on retry), not corrupting. The timeout is sized as the stale-image
  discriminator, not raced against.
- **`awaitLive` busy-polls** the liveness flag (100 ms, bounded by the connect timeout) on the
  provision worker thread rather than waiting on a Hello-signalled future — acceptable for Part 1
  (the thread is dedicated; tests set the timeout to 0). A signal-based wait is a possible follow-up.

## Code map

- Protocol: `workspace-daemon-protocol/.../protocol/{Provisioned,ProvisionFailed}.java`, `DaemonProtocol`
  (`PROVISIONED`/`PROVISION_FAILED` types, `PROVISION_CORRELATION_ID`), `DaemonCodec` arms.
- Daemon: `workspace-daemon/.../Provisioner.java` (clone + bounded `.gitmodules` walk, `ProcessBuilder`
  only — native-safe), `ControlSocket.java` (boot trigger on the worker pool, pre-connect outbound
  buffering, new env fields).
- Host: `domain/.../repository/control/{WorkspaceDaemonProvisioner,ProvisionResult,RepositoryNameResolver}.java`
  (new), `WorkspaceService.provisionContainer`/`awaitDaemonProvision`/`hostDrivenClone`,
  `WorkspaceContainerFactory` env injection.
- Backend: `service/.../workspacedaemonhost/WorkspaceDaemonRegistry.java` (`awaitProvision`,
  `Provisioned`/`ProvisionFailed` arms, workspace-keyed `PendingProvision`).
- Tests: `DaemonCodecTest` (round-trips), `ProvisionerTest` (url/`.gitmodules`/basename helpers),
  `WorkspaceContainerFactoryTest` (env), `DaemonControlSocketTest` (await/stream/fail/no-connect),
  `DaemonSelfCloneIT` (extended real-docker self-clone).

## Non-goals

- On-demand git verbs (fetch / merge / push / head) — stay [Part 4](in-container-git-verbs-over-socket.md).
- Reading/parsing `.qits-config.yml` — [next part](in-container-config-discovery.md).
- Bootstrap and daemon start — [parts 3](daemon-run-bootstrap-chain.md) /
  [4](daemon-supervised-dev-daemons.md).
- Scoped clone credential — [Part 6](mcp-termination-and-token-provisioning.md).

## Testing (as shipped)

- **Degradation is the default in cli/domain tests.** With no `WorkspaceDaemonProvisioner` bean
  (`Instance<>` empty), `provisionContainer` falls straight through to the host-driven clone +
  `materializeSubmodules` via `FakeContainerRuntime` — so the whole existing suite exercises the
  fallback unchanged (`WorkspaceSubmoduleProvisionTest`, `WorkspaceEnsureContainerProcessTest`). In
  `service` tests the registry bean IS present, so `qits.workspace.provision.connect-timeout-ms=0`
  keeps the fallback instant (no 30s wait — no daemon connects in the suite).
- **`DaemonControlSocketTest`** (in-JVM, fake Vert.x peer) — `awaitProvision` completes on
  `Provisioned`, streams provision output to the segment sink, fails on `ProvisionFailed`, and
  returns empty when no daemon connects (→ host fallback).
- **`ProvisionerTest`** — the daemon's pure decision helpers: `ws→http` git-base derivation,
  name-vs-id root addressing, `.gitmodules` parsing, basename normalization.
- **`DaemonCodecTest`** — `Provisioned`/`ProvisionFailed` round-trips.
- **`WorkspaceContainerFactoryTest`** — the new `QITS_WORKSPACE_DAEMON_PROJECT_ID`/`…_REPO_NAME` env
  (name-addressed when scoped, blank fallback otherwise).
- **Extended real-docker IT** (`DaemonSelfCloneIT`, `-Pextended`) — a real container self-clones
  `/workspace` on boot from a dumb-HTTP git host and reports `Provisioned{head}`, asserting the
  checkout exists with **no host `docker exec git clone`**. Single-repo (id-addressed); the depth-2
  name-addressed submodule closure over the real `GitHostRoutes` rides the full-stack acceptance
  path.
