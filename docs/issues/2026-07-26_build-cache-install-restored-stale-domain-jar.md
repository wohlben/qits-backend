# Build cache: `-pl domain install` restored a stale domain jar (missing a just-added constant)

## Introduction

Encountered while relocating the qits config default to `.config/qits/repository.yml`
(`QitsConfigParser` gained a new `LEGACY_CONFIG_PATH` constant). Related plans:
[`docs/epics/qits-build-setup/features/2026-07-05_maven-build-cache.md`](../epics/qits-build-setup/features/2026-07-05_maven-build-cache.md)
(the cache setup, including the note that a previous stale-restore suspicion against `domain` turned
out to be the IDE language server, not the cache — this occurrence has harder evidence) and
[`docs/issues/resolved/2026-07-25_quarkus-test-metaspace-oom.md`](resolved/2026-07-25_quarkus-test-metaspace-oom.md)
(source of the `single-test-override` profile involved in the suspected sequence).

## Observed repro (2026-07-26, one occurrence)

Sequence, all in one session, after editing `domain` main sources
(`QitsConfigParser`: new `public static final String LEGACY_CONFIG_PATH`):

1. `./mvnw -pl domain test -Dtest=QitsConfigParserTest -Dqits.dev-guard.skip=true` — green (17
   tests; Spotless also reformatted a test file during this build). Note `-Dtest=...` activates the
   root pom's `single-test-override` profile.
2. `./mvnw -pl domain test "-Dtest=WorkspaceBootstrapRunnerTest,WorkspaceBootstrapKillSwitchTest"`
   — green.
3. `./mvnw -pl domain install -DskipTests -Dqits.dev-guard.skip=true` — **BUILD SUCCESS**, but the
   installed jar was stale:
   - `javap -cp domain/target/classes ...QitsConfigParser | grep CONFIG_PATH` → **both**
     `CONFIG_PATH` and `LEGACY_CONFIG_PATH` present (target/classes was current);
   - `javap` over `...QitsConfigParser.class` extracted from the freshly installed (mtime matched
     the install) `~/…/eu/wohlben/domain/1.0.0-SNAPSHOT/domain-1.0.0-SNAPSHOT.jar` → **only**
     `CONFIG_PATH`. Downstream effect: `-pl service test` failed test-compile with
     `cannot find symbol: variable LEGACY_CONFIG_PATH` (service resolves `domain` from the local
     repo when built without `-am`).
4. `./mvnw -pl domain install -DskipTests -Dmaven.build.cache.enabled=false ...` — jar correct,
   service tests then compiled and passed.
5. A subsequent cache-**enabled** `-pl domain install -DskipTests` restored from cache
   (`Found cached build, restoring eu.wohlben:domain from cache by checksum cac398087cb3958e`) and
   the restored jar was **correct** — so the cache state self-healed; the stale restore was a
   one-shot at step 3.

## Suspected cause

Step 3's restore served a jar that predates the source edit even though `target/classes` (and the
cache checksum inputs) were current. Two directions worth checking:

- Cache entries **saved by `test`-goal builds** (steps 1–2, which don't run `jar`/`install`) being
  matched by a later `install` of the same checksum: the highest-phase/attached-artifact logic may
  have restored/kept an old `domain/target/domain-1.0.0-SNAPSHOT.jar` lying around from a pre-edit
  build instead of repackaging from the current `target/classes`.
- Interaction with the `single-test-override` profile (profiles participate in the effective-pom
  part of the cache key), i.e. which entry steps 1–2 wrote vs which entry step 3 read.

Not the known IDE-language-server clobbering (`m2e-separate-output` keeps the LS in `target-ide/`,
and here `target/classes` was *correct* — only the installed jar was stale), and not the
"clean before test" MapStruct gotcha.

## Suggested fix direction

Reproduce with a throwaway constant: edit a `domain` class, run a `-Dtest=...` single-test build,
then `install -DskipTests`, and diff the installed jar against `target/classes`. If it reproduces,
either exclude `test`-goal builds from cache *save* for library modules, or make `install` ignore
cache entries whose recorded highest phase is below `package`. Until then the AGENTS.md workaround
stands: on any stale-restore suspicion, bypass with `-Dmaven.build.cache.enabled=false` (or purge
the build cache next to the local repo).
