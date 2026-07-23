# Daemon-run bootstrap chain — deferred follow-ups from code review

## Introduction

Code-review follow-ups on [daemon-run-bootstrap-chain](../epics/qits-workspace-daemon/features/2026-07-23_daemon-run-bootstrap-chain.md)
(Part 3 of the [qits-workspace-daemon](../epics/qits-workspace-daemon/epic.md) provisioning-inversion
track). A high-effort review surfaced ten findings; three were fixed in the same change
(`Bootstrapped` cap-exemption in `ControlSocket.send`, the host chain-await default raised to 6h so a
multi-step chain no longer trips it, and a try/catch guard around the bootstrap `StepSink` dispatch so
a `recordOutcome` failure can't tear down the control socket). The rest are documented here for
careful follow-up — they are correctness/observability gaps, not blockers.

Related: this whole surface is reshaped by [config-as-single-source-of-truth](../epics/qits-workspace-daemon/feature-ideas/config-as-single-source-of-truth.md)
(Part 5), which removes the repo-scoped DB `BootstrapCommand` store and its create API — that
subsumes items 1–2 below.

## 1. Manual re-run of a torn-down workspace double-executes the chain (correctness, high)

**Observed:** `WorkspaceBootstrapRunner.runChainAsync`/`runSingleAsync` call
`workspaceService.ensureContainer(...)` and then unconditionally send the daemon a `RunBootstrap`. When
the container was torn down (e.g. host restart), `ensureContainer` **fresh-provisions** it, so the
daemon runs the whole chain **autonomously on boot** (`ControlSocket.runBootstrapOnBoot`, freshClone).
The subsequent `RunBootstrap` then runs it **again** — two `mvn install`/seed runs in the same
`/workspace`, possibly concurrently. The old host-side `runChain` executed exactly once. (When the
container already exists — the common re-run case — there is no autonomous run, so only the
`RunBootstrap` fires; correct.)

**Suspected cause / fix direction:** the manual path can't tell a fresh provision (daemon already ran)
from a restart/existing container (daemon did not). `ensureContainer` returns `void`. Thread the
fresh-provision signal out (an `ensureContainer` variant returning whether it fresh-provisioned), and
in the manual path **await** the autonomous run (`driver.awaitBootstrap`) when fresh, only send
`RunBootstrap` when the container already existed. A registry-side "is a boot run in progress"
check is racy (the first `BootstrapStep` may not have arrived when the host decides), so the
freshProvision boolean is the reliable discriminator.

## 2. Single re-run of a UI-created command is a silent no-op (correctness, medium)

**Observed:** a bootstrap command created via `POST /api/repositories/{id}/bootstrap-commands`
(`BootstrapCommandController.create`, DB-only, no `@qits-config` suffix) is **not** in the checkout's
`.qits-config.yml`. Clicking "Run" → `runSingleAsync` → `RunBootstrap(baseName)`; the daemon
(`BootstrapRunner.run`) iterates only its in-container config, finds no step of that name, runs
nothing, and emits `Bootstrapped{ok:true}`. No outcome is recorded, no error surfaces — the user
believes their command ran.

**Suspected cause / fix direction:** the daemon is authoritative on the file, the DB row isn't in it.
Either (a) make a single-run whose requested step produced **no** `BootstrapOutcome` surface a loud
failure (`RecordingSink` can track whether the requested name yielded an outcome), or (b) hide the
run/create affordance for non-config-origin commands. Largely mooted once Part 5 removes the DB store
+ create API, but reachable today.

## 3. A dead/stalled daemon hangs the await for the full chain timeout (robustness, medium)

**Observed:** if the daemon connects and then dies (crash, wedged socket) without emitting a terminal
`Bootstrapped`, `WorkspaceDaemonRegistry.awaitBootstrapFuture` blocks on `future.get(chainTimeout)`
(now 6h) before returning `Result(false)`; daemon auto-start is withheld and the Start stream hangs
that whole time. Partly **inherent** to the reconnect-survival design — the pending slot deliberately
outlives a socket bounce (a long `mvn install` reconnects mid-chain), so a single `unregister` can't
be treated as "dead" without breaking that.

**Suspected cause / fix direction:** a liveness-grace in the await loop — instead of one blocking
`get`, poll: complete on the future, else if the daemon has been **continuously disconnected for
longer than the reconnect-backoff max** (a grace window > 30s), fail early; otherwise keep waiting to
`chainTimeout`. Distinguishes a brief bounce from a real death while preserving reconnect survival.

## 4. Steps after a mid-chain failure aren't surfaced in the process view (observability, low)

**Observed:** on fail-fast the daemon emits no `BootstrapStep`/`BootstrapOutcome` for aborted steps, so
`RecordingSink` never opens/settles their `bootstrap:<name>` segments — they are silently absent from
the workspace Start process view (the failed step is shown; later steps just vanish). The old runner
appended "Skipped — an earlier bootstrap command failed." and settled each remaining segment failed.

**Fix direction:** on `Bootstrapped{ok:false}`, have `RecordingSink` settle the ordered DB-chain
segments (`bootstrapCommandService.resolveAll`) that were never opened as failed/aborted, for parity
with the old "abort loudly" behaviour.

## 5. Bootstrap tab "view command log" link is now always dead (frontend, low)

**Observed:** `RecordingSink.onOutcome` always records `commandId=null` (steps run in-container, no host
`Command` row — the intended behaviour change), so `BootstrapRunDto.commandId` is permanently null and
the Bootstrap tab's `@if (lastRun.commandId)` routerLink to `/commands/<id>`
(`workspace-bootstrap.component.ts`) never renders. The live output moved to the `bootstrap:<name>`
`TechnicalProcess` segment.

**Fix direction (frontend):** drop the dead command-log link, or point the per-step affordance at the
workspace Start process's `bootstrap:<name>` segment instead.

## 6. Minor / accepted

- **Timed-out step records exit `124`, not `null`** (`RecordingSink.onOutcome`). The old code used
  `null` to mark "timed out, no real exit"; the daemon now reports `124` (the conventional timeout
  code). Arguably an improvement (more informative), but indistinguishable from a script that genuinely
  exits `124`. **Accepted** unless the distinct "timed out" state is needed — then emit a sentinel
  from the daemon (`BootstrapRunner.runStreaming`) and null it host-side.
- **Duplicate process-output pump** — `BootstrapRunner.runStreaming`/`pump` re-implements
  `Provisioner.runStreaming`/`pump` (and `CommandExecutor.pump`) in the same module (three copies). A
  shared streaming helper (correlationId + optional timeout as params) would consolidate them; a
  future fix to the pump (e.g. a UTF-8 multibyte split across reads) otherwise has to be applied three
  times. **Tech debt**, native-image-safe as-is.
