# Full domain/service test suites OOM-killed at ~4 GiB — Quarkus per-@TestProfile app caching pins metaspace

## Introduction

Build/test-infrastructure bug affecting the `domain` and `service` `@QuarkusTest` suites. Related:
the build-guard and build-cache notes in `AGENTS.md`, `scripts/list-isolated-tests.sh` (part of the
fix), the surefire configuration in the root/`domain`/`service` poms, and the stale-assertion test
failure found while diagnosing this
([2026-07-25_workspace-recreate-container-test-fails.md](2026-07-25_workspace-recreate-container-test-fails.md), resolved — a stale assertion, fixed via `fix-main`).
Upstream: [quarkusio/quarkus#38774](https://github.com/quarkusio/quarkus/issues/38774) (open; the
structural fix, PR #53656 — shared augmentation classloaders — is targeted at Quarkus 4).

## Observed

Running the full `domain` (or `service`) suite in one surefire fork under a 4 GiB cgroup dies with
exit 137 (`The forked VM terminated without properly saying goodbye`) after ~170–200 Quarkus-booting
tests — never an assertion failure. The fork's heap was already ergonomically capped at 1 GiB, so
the growth was elsewhere: sampling the fork (`jcmd VM.classloaders`, NMT) showed **94
`QuarkusClassLoader` instances surviving two forced full GCs** with 451 MB of committed metaspace,
RSS 2.4 GiB and climbing, ~35 test classes in.

A heap-dump analysis (Eclipse MAT) pinned the retention: 93 QuarkusClassLoaders (70 % of live heap)
are held by `io.quarkus.test.junit.classloading.FacadeClassLoader` — Quarkus's JUnit facade keeps a
**static** `Map<String, CuratedApplication>` and an instance `Map<String, QuarkusClassLoader>`,
one entry per distinct `@TestProfile` (and per-class test-resource) key, **never evicted** for the
fork's lifetime. `domain` has 35 profile-carrying test classes, `service` 29 — each pins a complete
app (augmentation classloader + curated app + runtime classloader, ~90–130 MB RSS apiece).

Two aggravating findings:

- **JUnit's single discovery pass materializes every profile app up front**: the facade loads each
  selected test class through its profile's runtime classloader during discovery, augmenting as it
  goes, and the discovered `Class` objects pin their loaders for the whole launcher session. So
  `reuseForks=false` does not bound the peak either — the first fork still discovers (and augments)
  everything selected. Worse, when that discovery hit `OutOfMemoryError: Metaspace` the run reported
  `Tests run: 0` **and BUILD SUCCESS** — silent total test loss.
- **`-DargLine=...` on the CLI never reached the forks.** The root pom's empty `<argLine/>` property
  default (needed so `@{argLine}` resolves) shadows the CLI user property in surefire's late
  binding, so all earlier "run with a bigger/smaller heap" advice was a no-op; forks always ran with
  ergonomic defaults.

## Cause

Upstream Quarkus test-classloading design (the 3.16+ rewrite): one cached, never-released
application per profile/resource key per JVM. With dozens of profiles in one fork, metaspace +
retained heap grow linearly until the cgroup kills the fork. Not a leak in qits code — all
domain-side executors/threads shut down cleanly, and only Maven-bootstrap classes ever unloaded.

## Resolution

Bound the number of apps any single fork can accumulate, and make the caps real:

- `scripts/list-isolated-tests.sh` derives, per module at `process-test-classes` (antrun), the list
  of `*Test.java` carrying `@TestProfile`/`@WithTestResource` and splits it into 15 chunk files under
  `target/` (classes sharing a profile class sort adjacently; empty chunks get a never-matching
  pattern because an empty `includesFile` would fall back to surefire's defaults and re-run the
  whole suite).
- `domain`/`service` surefire now run the profile-less remainder in the default execution (one
  shared app — the whole `domain` remainder is a single Quarkus boot) with the all-isolated list as
  `excludesFile`, plus 15 `isolated-tests-N` executions, each a fresh fork holding 2-3 apps (the service app is heavier per profile than domain — chunk size is what keeps a fork inside the metaspace cap).
- Root pom surefire `argLine` now carries explicit caps —
  `-Xmx${qits.test.heap} -XX:MaxMetaspaceSize=512m -XX:ReservedCodeCacheSize=128m -XX:+ExitOnOutOfMemoryError`
  (heap 384m for the library modules, 512m in `service`, whose single app boot needs more) — so a
  regression dies loudly instead of silently skipping tests or growing to the cgroup limit.
- `-Dtest=...` flips the root `single-test-override` profile: isolated executions skip and the
  default execution drops its excludes, restoring today's single-execution behaviour exactly.

Result: full `domain` suite peak fork RSS ~0.9 GiB (was: OOM-killed at 4 GiB), total run (Maven +
fork) within ~1.4 GiB.

When Quarkus ships the upstream fix (shared augmentation classloaders, Quarkus 4), the chunked
executions can collapse back to a single one — the trigger to revisit is the quarkus platform
upgrade past that release.
