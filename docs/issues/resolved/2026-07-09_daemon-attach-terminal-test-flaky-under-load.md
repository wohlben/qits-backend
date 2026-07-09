# `DaemonAttachTerminalTest.attachStreamsTheDaemonOutputAndTerminatesCleanly` is flaky under suite load in sandboxed environments

## Introduction

Observed while implementing
[lazy workspace-container provisioning](../../features/2026-07-08_lazy-workspace-container-provisioning.md)
(unrelated to that change — the failing assertion concerns daemon-session teardown, which the change
does not touch). Sibling of
[daemon straggler-reap test fails in sandboxed env](2026-07-08_daemon-straggler-reap-test-fails-in-sandboxed-env.md):
same root cause, observed at a different assertion.

## Observed

In a full `./mvnw -pl domain test` run the test failed once:

```
DaemonAttachTerminalTest.attachStreamsTheDaemonOutputAndTerminatesCleanly:121
  kill tears the daemon session down ==> expected: <false> but was: <true>
```

i.e. after `killDaemon` the fake's `daemonAlive(...)` still reported the daemon process alive.
Passed when rerun in isolation — a timing flake under load.

## Root cause (diagnosed 2026-07-09)

Same zombie mechanics as the straggler-reap issue: `FakeContainerRuntime.daemonAlive` read
`ProcessHandle.isAlive`, which **stays `true` for a zombie**. The attach test's daemon leader is a
*direct* child of the JVM, so Java's asynchronous process-reaper thread usually reaps it quickly
after the `kill -9` — but under suite load the reaper lags, the single-snapshot `assertFalse`
observes the transient zombie, and the test fails. (In the straggler test the process is a
*grandchild* reparented to a non-reaping PID 1, so the same window is permanent there.)

## Resolution

- The assertion polls with the suite's standard await deadline (`awaitDaemonDead`) instead of
  asserting a single snapshot right after the kill.
- `FakeContainerRuntime.daemonAlive` is zombie-aware via the shared `processRunning(pid)` helper
  (see the sibling issue's resolution), so even an unreaped leader reads as dead — matching real
  docker, where the tmux session is simply gone.
