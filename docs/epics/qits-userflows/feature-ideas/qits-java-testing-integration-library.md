# qits-java-testing-integration: extract the userflows framework into its own library

## Introduction

Extract everything except the stories out of the `userflows/` module into a **standalone
library repository** — working name **`wohlben/qits-java-testing-integration`**, the Java
sibling of [`wohlben/qits-angular-integration`](https://github.com/wohlben/qits-angular-integration)
and named by the same `qits-<surface>-integration` scheme. **Creating that repository is a
prerequisite of this feature.** After implementation, the qits reactor's `userflows/` module
contains **exclusively actual user stories** (its `src/test` today) plus a dependency on the
library; the framework — the `UserStory` model, the annotations, the JUnit 5 extension, the
`Flow` step-recording facade, the report model (`userflow.json`) and its renderers *including
the artifactory renderer* — lives in the library, consumable by **any qits-managed project**.

That last clause is the point: today the [epic's](../epic.md) golden-diffing loop is only
authorable for qits itself, because the framework is locked inside qits' reactor. With the
library, a managed project adds one test-scoped dependency, writes stories against its own UI,
and its workspace branches produce the `ci-userstories` goldens the
[diff tab](qits-artifactory-workspace-userflow-diff-tab.md) compares — the epic's capability
becomes a property of *projects qits manages*, not of qits alone.

Related/dependent plans:

- **Hard dependency** — [qits-userflows](qits-userflows.md) (part 1): this is a pure
  extraction; the framework must exist first. Cleanest **after the
  [artifactory renderer](qits-userflows-artifactory-renderer.md)** (part 2) as well, since
  that plan deliberately puts the renderer in the same `src/main` — extracting between parts
  1 and 2 would just mean the renderer lands in the library repo instead. Independent of the
  [diff tab](qits-artifactory-workspace-userflow-diff-tab.md) (part 3).
- **Shape and naming precedent** —
  [qits-angular-integration-library](../../qits-integration-angular/features/2026-07-13_qits-angular-integration-library.md):
  standalone repo under `wohlben/`, the qits fixture as reference consumer, qits' toolchain
  mirrored, a deliberately small public API. This plan is the same move one module over.
- **Distribution route, eventually** — the `qits-artifactory-maven-repository` follow-up epic
  ([artifactory epic](../../qits-artifactory/epic.md), Follow-ups): a qits-hosted maven
  repository is the natural long-term home for resolving this library inside workspace
  builds. Not a dependency — an interim channel ships first (Design sketch) — but this
  library becomes that epic's first first-party artifact when it lands.
- **Reference consumer candidate** — the `testing-repo-quarkus-angular` fixture
  ([servable fixture](../../qits-testing-fixtures/features/2026-07-05_servable-quarkus-angular-fixture.md)), already
  the reference consumer of `@qits/angular`; a story in the fixture would prove the
  managed-project consumption path end-to-end (Open questions).

## Motivation

The [qits-userflows](qits-userflows.md) plan already made the framework qits-agnostic on
purpose: no dependency on `domain`, `service`, or `artifactory`; the app under test is reached
by URL. A framework with no qits coupling that can only be used from inside qits' reactor is
an accident of packaging, not a design. Extraction makes the boundary real — and hardens the
plan's own `src/main`/`src/test` discipline structurally: once the framework is a separate
repository, "nothing abstract lands in `src/test`" stops being a convention to police and
becomes the only thing that compiles (framework changes require a library change + version
bump, exactly the friction that keeps plumbing out of story modules).

## Contract

1. **New repository first.** `wohlben/qits-java-testing-integration` is created as an explicit
   prerequisite step — its own Maven build (not a qits reactor module), mirroring qits'
   toolchain: JDK 25, Spotless google-java-format, the same wrapper discipline. Maven
   coordinates `eu.wohlben.qits:qits-java-testing-integration`.
2. **The library is today's `src/main`, whole.** Annotations, JUnit extension, `Flow` facade,
   report model + `userflow.json` emission, the markdown renderer, the artifactory renderer
   and its uploader `main` — package root stays `eu.wohlben.qits.userflows` so story imports
   survive the move untouched. Dependency posture unchanged: Playwright (Java) + JUnit 5 (+
   `java.net.http` for the renderer), no Quarkus, no qits modules.
3. **The framework's test coverage moves with it.** The harness smoke story, the
   deliberately-failing story, and the renderer's stub-HTTP-server suite are framework tests
   (that happen to be written as stories) — they live in the library repo's own suite, keeping
   the framework fully covered without any consumer.
4. **`userflows/` becomes stories-only.** After the move the qits module keeps: the qits user
   stories, the extended-suite/`base-url`/self-skip wiring for running them, and one
   test-scoped dependency on the library. Its `CLAUDE.md` is rewritten in the same commit:
   authoring conventions now point at the library (and its version-bump workflow), the
   main/test split rule collapses to "this module contains only stories — the framework is
   `qits-java-testing-integration`".
5. **Pure extraction, no behavior change.** Report contract, `userflow.json` shape, metadata
   mapping, renderer semantics all byte-for-byte as before — a story run before and after the
   move produces identical output. Framework evolution is explicitly not this feature.

## Design sketch

- **Consumption channel (interim)**: Maven has no pnpm-style SHA-pinned git dependency, so the
  angular library's trick doesn't transplant. Leaning **JitPack** for day one (closest analog:
  a git tag/commit *is* the version, no publishing infrastructure to stand up), with GitHub
  Packages as the fallback if JitPack's build environment can't honor the JDK 25 toolchain.
  Either way the channel is an implementation detail consumers see only as a `<repository>`
  entry — swapped for the qits-hosted maven repository when that epic lands.
- **Versioning**: plain semver tags. qits' `userflows` module pins an exact version; managed
  projects do the same. The reference-consumer bump ritual mirrors the angular library's
  (library commit → tag → consumer bump), documented in the library README.
- **Repo layout**: single-module Maven build, `src/main` = the framework, `src/test` = the
  framework's own story-shaped coverage (contract 3). CI runs the suite headless — the
  Playwright browser install is the only CI-specific concern (the renderer-pinning rule from
  the userflows plan stays a *consumer* concern: goldens come from the `docker/workspace`
  image regardless of where the library is built).
- **The extraction commit in qits**: delete `userflows/src/main`, add the dependency, keep
  stories compiling unmodified (same packages), rewrite `userflows/CLAUDE.md`. The reactor
  build gets slightly cheaper; nothing else in qits notices.

## Out of scope

- **The maven protocol repository** — its own future epic on the artifactory backbone; this
  feature ships on an interim channel and merely becomes its first customer.
- **Any framework evolution** (new `Flow` verbs, report changes, new renderers) — extraction
  is behavior-preserving by contract.
- **qits UI/backend changes** — the diff tab already consumes artifactory metadata and never
  knew where the framework lived.
- **Onboarding tooling for managed projects** (a starter archetype, a "add user stories"
  action template) — natural follow-ups once a first external consumer exists.

## Open questions

- **Exact name**: `qits-java-testing-integration` follows the established scheme; the surface
  it integrates is really "JVM end-to-end testing", so `qits-userflows-integration` (named for
  the concept rather than the language) is the alternative. Decide when creating the repo —
  renaming a published library later is the one genuinely expensive path.
- **Where does the reference consumer live?** The `testing-repo-quarkus-angular` fixture is
  the natural candidate (it already reference-consumes `@qits/angular`, and a story driving
  its greeting flow doubles as seed-webapp demo material) — but growing the fixture means
  another two-level submodule round-trip per change. Alternative: qits' own `userflows`
  module *is* the reference consumer and the fixture stays lean until a managed-project demo
  is actually wanted.
- **JitPack + JDK 25**: verify before committing to the channel; GitHub Packages is the
  known-good fallback at the cost of credential plumbing for consumers.

## Testing sketch

- **Library repo**: the moved framework suite must pass standalone — harness smoke story,
  failing-story path, renderer unit tests against the stub server, step-hash stability. That
  suite running green in the new repo with zero qits checkout present *is* the proof of clean
  extraction.
- **qits side**: the existing qits stories compile and run unmodified against the library
  dependency (same packages, pinned version); `./mvnw -pl userflows test` stays green and
  variant-flag-free; the extended stories still self-skip without a running qits.
- **Equivalence check (one-off, during implementation)**: run the reference story before and
  after the extraction and diff the report directories — `user-story.md` and `userflow.json`
  identical modulo the video bytes.
- **Consumption path**: one CI-executed sample consumer build (a minimal pom in the library
  repo's CI, or the fixture if the reference-consumer question lands there) resolving the
  library through the chosen channel — the "does a project outside the reactor actually get
  it" test.
