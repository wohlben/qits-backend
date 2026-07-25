# WorkspaceRecreateContainerServiceTest: recreate keeps the untracked marker — old container restarted, not destroyed?

## Introduction

Functional test failure noticed while diagnosing the suite-wide metaspace OOM
([2026-07-25_quarkus-test-metaspace-oom.md](2026-07-25_quarkus-test-metaspace-oom.md))
— unrelated to that memory work, documented on encounter. Related: `WorkspaceService.beginRecreateContainer`
(`domain/src/main/java/eu/wohlben/qits/domain/repository/control/`), the recreate feature
(`docs/epics/qits-workspace-registry/`, commit `60601658`), and `FakeContainerRuntime`
(`domain/src/test/java/.../FakeContainerRuntime.java`).

## Observed

On current `main` (`23d0ca1b`, branch `memory-utilization` carries no extra commits), in a
qits-in-qits workspace devcontainer:

```
./mvnw -pl domain test -Dtest=WorkspaceRecreateContainerServiceTest

WorkspaceRecreateContainerServiceTest.recreateTearsDownAndReprovisionsAFreshContainerWhenClean:101
  the fresh clone dropped the untracked file — the old container was destroyed, not restarted
  ==> expected: not equal but was: <0>
```

Reproduces consistently (3 runs: alone, and inside two different test batches). The test writes an
untracked `marker.txt` into the fake container's `/workspace`, reports the tree clean, runs
`beginRecreateContainer`, awaits the fresh-provision started event, then asserts `test -f
marker.txt` fails in the recreated container. It succeeds (exit 0): the marker survived recreate.
The class's other four tests (push-before-teardown, dirty-tree gate, etc.) pass.

## Suspected cause

Either the recreate path genuinely skips the teardown (rm) leg in this environment, or
`FakeContainerRuntime`'s emulation reuses the old host-clone directory on reprovision (its
"container" is a host directory keyed by container name — if `rm` doesn't delete the directory, or
the re-clone lands in the same path without cleaning, the marker persists). The started-event
recorder is awaited, so a pure race is less likely, but the await window (5 s) may also mask an
ordering where the assert runs against the OLD container before teardown.

Not investigated further — encountered out of scope during the memory work.

## Resolution

Not a product bug — a stale assertion. The persistent-workspace-volume feature (`6920e382`,
`docs/epics/qits-workspaces/features/2026-07-25_persistent-workspace-volume.md`) deliberately
redefined recreate as non-destructive: `beginRecreateContainer` keeps the per-workspace
`/workspace` volume, so the checkout is reattached to the fresh container rather than re-cloned —
the untracked marker is SUPPOSED to survive. The epics merge (`23d0ca1b`) left this one test
asserting the pre-volume behavior. Fixed by cherry-picking `d5520805` from `fix-main` (flips the
assertion to expect the marker to survive, updates the comment/javadoc); all 5 tests in the class
pass.
