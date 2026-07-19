# Mass "Unsatisfied dependency" for MapStruct mappers + Panache repositories after an incremental compile

> **Resolved 2026-07-05.** Set `<useIncrementalCompilation>false</useIncrementalCompilation>` on the
> `maven-compiler-plugin` (root `pom.xml` `pluginManagement`). Maven's default incremental compiler
> sometimes reports "Nothing to compile — all classes are up to date" and skips recompiling a *changed*
> source, leaving that source **newer than its compiled `.class`**. A following `@QuarkusTest` then sees
> the stale class, triggers Quarkus's own test-time recompilation, and mis-registers the generated
> MapStruct `*Impl` mappers and the Panache repositories — Arc fails deployment with an
> `Unsatisfied dependency` for **every** such bean, even though the `*Impl.class` files are present in
> `target/classes`. Forcing full recompilation of stale sources keeps each `.class` at least as new as
> its source, so Quarkus never re-derives them. The Maven build cache skips compilation entirely when a
> module's inputs are unchanged, so the extra work is paid only on a real change. This retires the
> `clean`-before-test workaround previously recorded in project memory.

## Introduction

Related / dependent plans:

- `docs/epics/qits-build-setup/features/2026-07-05_maven-build-cache.md` — the build-cache work that surfaced (and shares the
  root shape of) this bug; it flagged root-causing this fragility as a follow-up, which this resolves.
  Note the build cache also hit the *same* failure class via a different trigger (an empty
  `target/classes` on restore), fixed there by attaching `classes` to the restored outputs.
- Project memory `mvnw-clean-before-test` — the prior workaround ("re-run with `clean`"); now superseded.

## Symptom

An incremental sequence that mixes goals — e.g. `./mvnw -pl domain compile` (or an edit to one domain
source) followed by `./mvnw -pl domain test` **without** an intervening `clean` — fails a `@QuarkusTest`
boot with hundreds of deployment problems:

```
Found 420 deployment problems:
[1] Unsatisfied dependency for type FeatureFlowConfigurationRepository and qualifiers [@Default]
    - injection target: ...ProjectService#featureFlowConfigurationRepository
[2] Unsatisfied dependency for type ProjectRepository and qualifiers [@Default]
... (every Panache repository and every MapStruct *Impl mapper) ...
```

Tell-tale signs: the `@ApplicationScoped` **services** are found (they are the injection *targets*), only
their injected **repositories/mappers** are unsatisfied; and the compile log says
`Nothing to compile - all classes are up to date` while `*MapperImpl.class` files are demonstrably in
`target/classes`.

## Root cause

`maven-compiler-plugin`'s default `useIncrementalCompilation=true` can decide "Nothing to compile" and
skip recompiling a source that was in fact modified, leaving `src/.../Foo.java` newer than
`target/classes/.../Foo.class`. `@QuarkusTest` (via `quarkus-junit5`) runs a build-time augmentation
that detects the newer source and kicks off Quarkus's dev/test-mode recompilation. That path does not
reproduce the Maven annotation-processor setup faithfully for the *generated* beans (MapStruct `*Impl`,
which carry `@ApplicationScoped`, and the Panache repositories registered by a Hibernate-ORM-Panache
build step), so they drop out of the bean index while hand-written `@ApplicationScoped` services remain.

## Fix / verification

- **Fix:** `<useIncrementalCompilation>false</useIncrementalCompilation>` in the root
  `maven-compiler-plugin` config.
- **Reproduced deterministically** (cache disabled to isolate from the build cache): clean-compile
  `domain`, append a comment to `ProjectService.java`, run `./mvnw -pl domain test -Dtest=OtelEnvironmentTest`
  → **420 unsatisfied** with the default; **0 unsatisfied, 3/3 runs green** with the fix, and the
  compiled `.class` is no longer older than its source.
- Full `./mvnw install` (all modules, with the build cache) stays green.

## Note on a regression test

This is Maven/Quarkus build-tooling behaviour driven by on-disk `.class`-vs-source timestamps, not
application logic, so there is no meaningful JUnit assertion for it — the guard is the POM config plus
this documented reproduction. If it ever regresses, the reproduction above deterministically re-triggers it.
