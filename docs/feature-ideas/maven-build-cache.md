# Maven build cache: skip unchanged module builds (and the pnpm Angular build)

## Introduction

Every `./mvnw package` today rebuilds all three modules from scratch — recompiles `domain`, re-runs
Spotless, re-runs every module's test suite, and re-drives the **pnpm + Angular** build inside
`service` via Quinoa — even when nothing in a given module changed since the last build. The
[Maven Build Cache Extension](https://maven.apache.org/extensions/maven-build-cache-extension/)
fingerprints each module's inputs (source files, POM, dependency coordinates, plugin config) and,
on a hit, **restores that module's outputs instead of rebuilding it** — skipping compile, Spotless,
tests, and (crucially here) the frontend build. It's a drop-in `.mvn/extensions.xml` addition; no
code changes, no Maven upgrade (the extension supports Maven 3.9+, and the wrapper is pinned to
3.9.12).

This is pure build-infrastructure ergonomics — it changes *how fast* the existing build runs, not
what it produces. It has no runtime surface and no dependent feature plans. The plans it touches are
the build characteristics documented in `CLAUDE.md`:

- **The `domain` → `service`/`cli` dependency edge.** `domain` is a plain library jar both other
  modules index (`quarkus.index-dependency.domain.*`). When only `service` code changes, the cache
  should let `domain` and `cli` restore from cache and rebuild `service` alone — the common inner-loop
  case.
- **Spotless at `process-sources`** (google-java-format). Spotless *rewrites source files in place*,
  which interacts with input hashing — see "Gotchas" below.
- **Quinoa's pnpm + Angular build** (`service/src/main/webui/`). The single most expensive step in a
  full build and the biggest prize: it should be skipped whenever `webui/` is unchanged.
- The `generate-migration` / `seed` cli flows and the **native** (`-Dnative`) and **extended**
  (`-Pextended`) profiles, whose caching behaviour needs deliberate scoping (see Open questions).

## Why this repo specifically benefits

- **Wide inner loop.** The documented single-test invocations already use `-am` to rebuild the
  `domain` dependency (`./mvnw -pl service -am test -Dtest=…`). With the cache, that `-am` rebuild of
  `domain` becomes a cache restore whenever `domain` is untouched — the frequent case when iterating
  on a controller or a test.
- **The frontend tax.** A full `./mvnw package` pays for a pnpm install + Angular production build
  every time. Backend-only changes (the vast majority) never touch `service/src/main/webui/`, so a
  correctly-keyed cache skips the entire Quinoa build — the largest wall-clock win available.
- **Test restoration.** The cache can restore Surefire results, so `domain`'s business-logic suite
  and `service`'s REST/mutiny/validation suites don't re-run when their module's inputs are identical
  — turning a full-build test pass into a near-no-op after the first run.

## Sketch of the change

1. **Add the extension** at `.mvn/extensions.xml` (this file does not exist yet):

   ```xml
   <extensions xmlns="http://maven.apache.org/EXTENSIONS/1.2.0">
     <extension>
       <groupId>org.apache.maven.extensions</groupId>
       <artifactId>maven-build-cache-extension</artifactId>
       <version><!-- latest release --></version>
     </extension>
   </extensions>
   ```

2. **Add a cache config** at `.mvn/maven-build-cache-config.xml` to tune what's tracked. The key
   decisions for this repo:
   - **Input globs per module** — ensure `service`'s inputs include `src/main/webui/**` (Angular
     sources, `package.json`, `pnpm-lock.yaml`, `angular.json`) so a frontend change correctly
     *invalidates* the cache and a backend-only change does not.
   - **Exclude generated + volatile paths** from hashing: MapStruct/annotation-processor output,
     `PENDING_MIGRATION.sql` at the repo root, `dist/`, `node_modules/`, the H2 data dir.
   - Decide whether to cache the `-Dnative` build (large, GraalVM-dependent) — likely **off** at
     first (local-cache only, JVM builds).

3. **Start local-only.** The extension defaults to a local disk cache (`~/.m2/build-cache`). No
   remote/shared cache until the local behaviour is trusted (see Open questions for the remote option).

## Gotchas to design around

- **Spotless mutates sources during the build.** `spotless:apply` reformats `.java` files in place at
  `process-sources`. The build cache hashes inputs *before* the build runs, so an already-formatted
  tree hashes stably and reformatting is idempotent — but a build that reformats files changes the
  working tree, which changes the *next* build's input hash. In practice this settles after one
  formatting pass; worth verifying that a clean, already-formatted tree produces a stable cache key
  across back-to-back builds (it should).
- **Quinoa build outputs must be captured as module outputs.** The Angular build lands in
  `service/target` (Quinoa serves `dist/qits-ui/browser`). Confirm the restored `service` artifact
  includes the built frontend so a cache hit doesn't ship a jar without UI assets — the cache must
  treat the packaged webui as part of `service`'s output, not a side effect it drops.
- **Annotation processors (MapStruct, Lombok, Panache).** Generated `*Impl` mappers and Panache
  enhancement are build outputs; they must be restored with the module, not re-derived from a
  half-cached state. Note the existing "clean before test" gotcha (`mvnw-clean-before-test`) about
  bogus MapStruct "Unsatisfied dependency" errors after incremental compiles — the cache must not
  reintroduce that class of stale-generated-code problem. This is the highest-risk interaction and
  the main thing acceptance testing must rule out.
- **Shared H2 file / seed flow.** Nothing about caching should touch the runtime `~/.qits` data dir;
  just make sure it's never an input or output path.

## Rollout

1. Land `.mvn/extensions.xml` + a conservative `.mvn/maven-build-cache-config.xml`, local cache only,
   JVM builds only.
2. Verify hit/miss behaviour by hand (below) and watch for the MapStruct staleness class of bug.
3. Only then consider a **shared remote cache** for CI and cross-machine reuse (the extension supports
   an HTTP/S3-backed remote cache), which is where the big CI wins live but also where correctness
   stakes rise.

## Verification sketch

- **Backend-only edit → frontend skipped.** Full `package`, then touch one `.java` file in `service`
  and rebuild: `domain`/`cli` restore from cache, the pnpm/Angular build is skipped, only `service`
  Java recompiles. Confirm via the build log (cache-restored module markers) and wall-clock drop.
- **Frontend edit → frontend rebuilt.** Touch a file under `service/src/main/webui/` and rebuild:
  the cache correctly *misses* for `service` and Quinoa re-runs.
- **No-op rebuild.** Two consecutive `./mvnw package` with no changes: the second is (near) all cache
  hits, tests restored not re-run.
- **Correctness guard.** A cache-hit build still produces a runnable app with UI assets and generated
  MapStruct mappers present — i.e. `./mvnw -pl service quarkus:dev` and a REST smoke call work off a
  restored `service` artifact, ruling out the stale-generated-code failure mode.

## Open questions

- **Remote/shared cache?** Local-only is a safe first step; a shared cache (CI + dev machines) is the
  larger payoff but needs a hosting decision (HTTP server vs. object store) and a trust model for who
  can *write* cache entries.
- **Native + extended profiles.** Cache the GraalVM native build (`-Dnative`) and the docker-dependent
  `-Pextended` ITs, or explicitly exclude them? They're environment-sensitive; excluding at first is
  safer.
- **Spotless-in-cache stability.** Confirm empirically that an already-formatted tree yields identical
  cache keys across runs; if not, consider moving Spotless to a check-only mode in cached builds.
- **Interaction with `quarkus:dev`.** The build cache targets `package`/`test` lifecycle builds; dev
  mode is already incremental and workspace-aware, so the cache is orthogonal there — worth a note
  that this idea targets the batch build, not the live-reload loop.
