# Autonomous self-clone on boot

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

## New wire messages

- **`ProvisionRequest { correlationId }`** *(optional)* — only if the host must hand the daemon data
  it can't derive from env (the submodule edge closure, the git-host base URL if not derivable).
  Under the autonomous model the daemon starts the clone from env alone; this message, if kept, is a
  small "here is your submodule closure" hand-off, not a "start cloning" instruction.
- **`Provisioned { workspaceId, head }`** — daemon → qits, sent when `/workspace` is checked out and
  submodules wired. Carries the new HEAD sha (parity with the old post-clone `rev-parse`).
- **`ProvisionFailed { workspaceId, message }`** — daemon → qits, the "degrade loudly" signal: the
  clone or wiring failed in-container. qits marks the workspace `FAILED` with the message (parity
  with today's `InternalServerErrorException` + `containers.rm`).

Add each as a `DaemonMessage` record (+ `permits`), a `DaemonProtocol.Type`/`Field` constant, and an
encode/decode arm in `DaemonCodec` (both `switch`es are exhaustive — the compiler enforces both
sides). Add correlated send/await helpers on `WorkspaceDaemonRegistry` mirroring `runCommand`.

## Degradation contract (socket-down ⇒ today's behaviour)

A container from a **stale image** (built before Part 1) has no daemon, never sends `Hello`, and
never sends `Provisioned`. `WorkspaceService.provisionContainer` must **fall back to the existing
host-driven `docker exec git clone` + `wireSubmodules`** when no client is live for the workspace
within a bounded wait (`WorkspaceDaemonLiveness.isDaemonLive` + a provisioned-await timeout). This
keeps the epic invariant: *socket down ⇒ exactly today's behaviour*. The fallback path is deleted
only when Part 4 retires the host-side git verbs entirely.

## Design questions

- **Submodule closure source.** `wireSubmodules` walks the DB's IMPORTED submodule edges
  (`repositorySubmoduleRepository.findByParentId`, per level, in fresh transactions) — data the
  in-container daemon can't query. Either (a) qits serializes the edge closure into `ProvisionRequest`
  after `Hello`, or (b) the daemon discovers submodules from the checkout's `.gitmodules` + the
  id-addressed git-host URLs. (a) preserves today's "materialize exactly the imported edge closure,
  level by level" contract with least divergence; (b) is more autonomous but re-derives import
  policy in-container. **Leaning (a).**
- **Await + timeout.** How long `provisionContainer` blocks on `Provisioned` before declaring failure
  or falling back. Reuse the streaming `TechnicalProcess` `clone` segment so progress still shows in
  the UI (the daemon streams clone output as `DaemonLog`/`CommandChunk` tagged for the segment).
- **HEAD identity.** The commit identity arrives as container-level `GIT_*` env
  (`gitIdentity.envMap()`), inherited by the daemon's `git` process — so, as today, nothing is
  configured in the clone.

## Non-goals

- On-demand git verbs (fetch / merge / push / head) — stay [Part 4](in-container-git-verbs-over-socket.md).
- Reading/parsing `.qits-config.yml` — [next part](in-container-config-discovery.md).
- Bootstrap and daemon start — [parts 3](daemon-run-bootstrap-chain.md) /
  [4](daemon-supervised-dev-daemons.md).
- Scoped clone credential — [Part 6](mcp-termination-and-token-provisioning.md).

## Testing

- **`FakeContainerRuntime` unit** — the fake emulates a container as a host clone; extend it so a
  "daemon-provisioned" workspace still produces the checkout the rest of the suite expects, and
  assert the host no longer issues the `docker exec git clone`. Divergence tests still **push** so
  origin-side probes see commits.
- **Degradation** — with no live client, `provisionContainer` falls back to the host clone; assert
  byte-for-byte the historical argv for a submodule-free repo (strict no-op parity).
- **Extended real-docker IT** — a real workspace container self-clones on boot (depth-2 submodule
  closure via `submodule-super.git`), asserting `/workspace` is checked out with no host `docker exec
  git` call.
