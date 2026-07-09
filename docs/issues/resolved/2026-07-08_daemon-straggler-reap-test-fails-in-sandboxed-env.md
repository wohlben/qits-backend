# `DaemonSupervisorTest.relaunchReapsAStragglerThatEscapedTheProcessGroup` fails in sandboxed environments

## Introduction

Observed while implementing
[lazy workspace-container provisioning](../../features/2026-07-08_lazy-workspace-container-provisioning.md)
(the failure predates that change — it reproduces identically on a clean `main` checkout). Related:
the straggler-reap feature itself came from the orphaned forked-JVM wedge documented in the daemon
supervision work (`DaemonSupervisor.reapStragglers`, `domain/.../daemon/control/DaemonSupervisor.java`).
Sibling: [daemon attach-terminal test flaky under load](2026-07-09_daemon-attach-terminal-test-flaky-under-load.md)
— same root cause, different observation point.

## Observed

```
./mvnw -pl domain test -Dmaven.build.cache.enabled=false -Dtest=DaemonSupervisorTest
...
DaemonSupervisorTest.relaunchReapsAStragglerThatEscapedTheProcessGroup:552
  the escaped straggler is killed on relaunch by its QITS_DAEMON_ID marker ==> expected: <true> but was: <false>
Tests run: 14, Failures: 1
```

Environment: the qits Claude Code background-job sandbox (Linux 6.6 WSL2 kernel, containerized,
`pgrep`/`pkill`/`setsid`/`tmux` all present). Fails consistently on a **clean tree** — not caused by
any pending change. The other 13 `DaemonSupervisorTest` tests pass. (Beware a false "passes in
isolation" signal: the Maven build cache can restore a module's test results and skip surefire
entirely — verify with `-Dmaven.build.cache.enabled=false`.)

## Root cause (diagnosed 2026-07-09)

Not what was first suspected (a sandbox denying `/proc/<pid>/environ` reads or cross-session
`kill`). A manual probe of the exact reap script proved the primitive **works** in this sandbox:
the marked orphan is found via the environ scan and the `kill -9` lands. The orphan still read as
alive because:

1. **The sandbox's PID 1 is `sleep infinity`** — it never calls `wait()`, so it never reaps
   children reparented to it (160 permanent zombies were present at diagnosis time).
2. The test's orphan is a `setsid` **grandchild** of the JVM (spawned by the daemon script's
   shell). When its parent dies at stop, it reparents to PID 1; when the reap kills it, it becomes
   a **permanent zombie**.
3. **`ProcessHandle.isAlive()` returns `true` for zombies** (the `/proc/<pid>` entry persists), so
   the test's 15s "orphan died" poll never succeeds — even though the reap did exactly its job
   (a zombie holds no port and can't wedge the next start).

Verified empirically with a minimal Java probe: a detached descendant that exits shows
`/proc` state `Z` and `isAlive() == true` indefinitely.

## Resolution

- `FakeContainerRuntime.processRunning(pid)` (all three copies): liveness = `ProcessHandle.isAlive`
  **and not a zombie** (state field of `/proc/<pid>/stat`). `daemonAlive` now uses it — matching
  real docker semantics, where `tmux has-session` reports a killed session gone regardless of
  host-side zombie bookkeeping.
- The straggler test's orphan checks use `processRunning` instead of raw `isAlive`, so a
  killed-but-unreaped orphan counts as reaped (it is, for the wedge the reap guards against).
- The test also gained an `assumeTrue(reapPrimitiveWorks())` guard — a self-probe that spawns a
  marked `setsid` child and runs the same scan/kill script — so on a sandbox that genuinely does
  deny the environ scan or the cross-session kill (the originally suspected class, not this one)
  the test skips with a pointer here instead of failing on environment grounds.

`DaemonSupervisorTest` (all 14) now passes in this environment with the build cache disabled.
