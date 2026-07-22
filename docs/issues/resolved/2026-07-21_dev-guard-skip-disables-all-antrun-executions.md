# Dev-guard plugin-level config leaks into every antrun execution in the reactor

## Introduction

Found while verifying the daemon-MCP removal: `RepositoryMcpToolsTest` failed its constructor on a
missing `/fixtures/testing-repo.git`, even after the fixture submodules were checked out and a full
`install` had run. Related: the dev-mode build guard (root pom, see
[mapstruct-unsatisfied-after-incremental-compile](2026-07-05_mapstruct-unsatisfied-after-incremental-compile.md))
and the fixture derivation
([fixture repos split and submodules](../epics/qits-testing-fixtures/features/2026-07-14_fixture-repos-split-and-submodules.md)).

## Observed

Every build run with `-Dqits.dev-guard.skip=true` (the documented bypass for the dev-mode build
guard) logged `Skipping Antrun execution` for **all** maven-antrun executions — including
`derive-fixture-bares` in `domain`/`service`/`cli`, so no `testing-repo.git` etc. were derived into
`target/test-classes/fixtures/`. Tests resolving fixture bares then fail with an NPE on
`getResource("/fixtures/testing-repo.git")` (surfacing as Quarkus's "When using constructor
injection in a test…" wrapper). Cache restores hid this further: a cache hit can bring back a
previously derived bare, so the skip only bites on cold/changed modules.

## Cause

The root pom declared the guard's `<skip>${qits.dev-guard.skip}</skip>` **and** its
socket-check+fail `<target>` at the antrun **plugin level**. Plugin-level configuration merges into
*every* execution of that plugin in the reactor — the guard's own two executions *and* the modules'
`derive-fixture-bares`:

- the plugin-level **skip** made `-Dqits.dev-guard.skip=true` skip fixture derivation too; and
- the plugin-level **target** merged the guard's `<condition>`+`<fail>` *into* the derive step
  (ant `<target>` configs combine, they don't override) — so with the skip scoped correctly but the
  target still plugin-level, `derive-fixture-bares` itself failed builds on a held port. (It had
  silently run the guard's socket check all along; harmless only while the port was free.)

## Resolution

Fixed 2026-07-21: the plugin now carries **no plugin-level configuration at all** — each guard
execution (`guard-dev-mode-preclean`, `guard-dev-mode-validate`) owns its full
`<skip>` + `<target>`. Verified: with `-Dqits.dev-guard.skip=true`, `derive-fixture-bares` runs and
the derived bares land in `target/test-classes/fixtures/`; with the flag unset and the port held,
the guard executions still fail the build. No automated regression test — the project has no
harness for pom-level build behavior; the check is the two-liner above.
