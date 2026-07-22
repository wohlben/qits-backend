# Docker image build fails: derive-fixture-bares runs on a git-stripped context

## Introduction

The Docker image build (`docker/qits/Dockerfile`, driven by `install.sh` / the manual deployment in
`docs/guides/deployment.md`) started failing. Direct fallout of
[dev-guard antrun scope fix](2026-07-21_dev-guard-skip-disables-all-antrun-executions.md); touches
the fixture derivation ([fixture repos split and submodules](../../epics/qits-testing-fixtures/features/2026-07-14_fixture-repos-split-and-submodules.md),
`scripts/derive-fixture-bares.sh`).

## Observed

Both `docker build` steps of the deployment fail in the Maven stage with:

```
fatal: not a git repository: /src/domain/src/test/resources/fixtures/testing-repo/../../../../../../.git/modules/domain/src/test/resources/fixtures/testing-repo
derive-fixture-bares: submodule 'testing-repo' has no origin branches (uninitialised?).
```

Last green build: `2f4d753` (2026-07-21 22:36). First red: `82c7418` (2026-07-22 07:31) and every
commit on top of it (the deployed tip flagged by the pipeline was its child `74d2aa1`).

## Cause

`82c7418` ("fix(build): scope dev-guard antrun config to the guard's own executions") correctly moved
the antrun `<skip>` off the plugin level onto the guard's own two executions, so
`-Dqits.dev-guard.skip=true` no longer skips **every** antrun execution in the reactor — the intended
fix of the 07-21 issue.

But the Dockerfile had been **relying on that leak**: its build stages pass `-Dqits.dev-guard.skip=true`
and its comment claimed this "ALSO skips the derive-fixture-bares antrun … so the build needs NO git
submodules". After `82c7418` that is no longer true, so `derive-fixture-bares` now runs during the
image build. The `.dockerignore` drops `.git` and `.gitmodules` (the app image build is tests-skipped
and needs no submodules), but it does **not** drop the per-submodule `.git` *pointer files* under
`domain/src/test/resources/fixtures/*/.git` — `COPY . .` copies them into `/src`, where they now
dangle (their `../../../../../../.git/modules/…` target, i.e. `/src/.git`, was excluded). The
derivation's `git -C <worktree> for-each-ref` then fails with the "not a git repository" above.

(The submodule config itself is fine — the deeply-`../`'d gitdir pointer is the normal git submodule
indirection, not corruption.)

## Resolution

Fixed 2026-07-22: give fixture derivation its **own** skip property instead of piggybacking on the
dev guard's.

- Root `pom.xml`: new `qits.fixture-derivation.skip` (default `false`).
- `domain`/`service`/`cli` `pom.xml`: the `derive-fixture-bares` execution now carries
  `<skip>${qits.fixture-derivation.skip}</skip>`.
- `docker/qits/Dockerfile`: both Maven stages pass `-Dqits.fixture-derivation.skip=true` (the app
  `build` stage builds `domain`+`service`, which is what triggered it; added to the
  `workspace-daemon-build` stage too for consistency), and the stale comment is corrected.

Default builds (CI, local `test`, the reactor `package`) leave the flag `false`, so derivation still
runs there — only the tests-skipped, submodule-free image builds opt out. No automated regression
test (same as the 07-21 issue: the project has no harness for pom-level build behaviour); verified by
reproducing the failure against a git-stripped copy of the fixtures dir and confirming the `<skip>`
suppresses the antrun execution.
