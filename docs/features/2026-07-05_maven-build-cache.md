# Maven build cache: skip unchanged module builds (and the pnpm Angular build)

## Introduction

`./mvnw package`/`install` rebuilt all three modules from scratch every time — recompiling `domain`,
re-running Spotless, re-running every module's test suite, and re-driving the pnpm + Angular build
inside `service` via Quinoa — even when nothing in a module changed. This adds the
[Maven Build Cache Extension](https://maven.apache.org/extensions/maven-build-cache-extension/)
(local disk cache only), which fingerprints each module's inputs and, on a hit, **restores that
module's outputs instead of rebuilding it**.

Two files, no code changes, no Maven upgrade (extension supports Maven 3.9+; the wrapper is pinned to
3.9.12):

- **`.mvn/extensions.xml`** — loads `maven-build-cache-extension:1.2.3` as a core extension.
- **`.mvn/maven-build-cache-config.xml`** — the tuning that makes it correct for *this* repo.

It changes *how fast* the existing build runs, not what it produces. No runtime surface, no dependent
plans. Related build characteristics it touches (all in `CLAUDE.md`): the `domain` → `service`/`cli`
dependency edge, Spotless at `process-sources`, Quinoa's pnpm + Angular build, and the
`mvnw-clean-before-test` MapStruct fragility (see the correctness fix below). Supersedes the idea doc
`docs/feature-ideas/maven-build-cache.md`.

## What granularity actually buys us (important, and narrower than it sounds)

The cache is keyed and restored **per module (Maven project)**, not per plugin-execution. There is
**no "recompile the Java but skip Quinoa" within a single module** — any input change to `service`
rebuilds all of `service`, frontend included. So the realistic wins are:

- **No-op rebuilds** — near-instant, everything restored, tests not re-run. (~4:00 → ~2.4s here.)
- **Restoring modules whose inputs are untouched.** Iterating on `cli` restores `domain` **and
  `service`** — so the pnpm/Angular build is skipped on a cli-only change. Iterating on `service`
  restores `domain` and `cli`.
- **Cross-checkout / fresh-`target` reuse** — a wiped `target/` restores from cache in seconds.

Note the frontend build is skipped only when `service`'s *whole* input is unchanged. Editing a
`service` `.java` file is a `service` cache **miss** and rebuilds the frontend too — the idea doc's
"touch a service .java → frontend skipped" was optimistic about the granularity. Editing `domain`
invalidates `service` and `cli` transitively (they depend on it), so that rebuilds everything.

## The config, and the two non-obvious correctness fixes

`.mvn/maven-build-cache-config.xml` is local-cache-only, remote disabled, `hashAlgorithm=XX` (fast,
non-cryptographic — fine for a local dev cache). The parts that matter:

### 1. `attachedOutputs` must include `classes` — or reactor consumers fail to wire domain beans

The **highest-risk interaction**, and it bit exactly as the idea doc predicted. A cache restore
repopulates the module's **jar artifact** but *not* its `target/classes` directory. Quarkus's
reactor/workspace bootstrap resolves sibling modules by reading their **`target/classes` directory**,
not the installed jar. So a module **rebuilt** while `domain` is **restored** (the common "change only
`cli`, rebuild" inner loop) indexes an **empty `domain/target/classes`** and fails Arc with:

```
Found 18 deployment problems:
[1] Unsatisfied dependency for type ...ProjectService and qualifiers [@Default]
... (every @ApplicationScoped domain service) ...
```

This is the **same failure class** as the pre-existing `mvnw-clean-before-test` gotcha (mass MapStruct
`*Impl` "Unsatisfied dependency" after incremental compiles) — the cache just makes it reproducible in
the full-reactor `install` loop. The fix is to attach `classes` so a restore repopulates
`target/classes` (which also carries the compiled `*MapperImpl` classes, directly ruling out the
stale-generated-code mode):

```xml
<attachedOutputs>
    <dirNames>
        <dirName>classes</dirName>      <!-- reactor siblings + MapStruct *Impl; REQUIRED for correctness -->
        <dirName>quarkus-app</dirName>  <!-- fast-jar output: runnable app + bundled Angular UI -->
    </dirNames>
</attachedOutputs>
```

`quarkus-app` is the second attach: Quarkus fast-jar (`service`, `cli`) writes `target/quarkus-app/`,
which is not a Maven artifact and would be dropped on a hit — leaving a non-runnable restore (no
runner; for `service`, no bundled UI). `domain` is a plain jar and simply has no such dir.

#### Follow-up (2026-07-09): the "stale `domain` restore" was a misdiagnosis — the IDE was the culprit

A `quarkus:dev` boot once failed with a mass **"Unsatisfied dependency" for every domain `*Mapper`
bean** (22 of them), and it was initially blamed on a *partial/stale* cache **restore** of `domain` —
"fixed" by marking `domain` non-cacheable (`<maven.build.cache.skipCache>true</maven.build.cache.skipCache>`
in `domain/pom.xml`). **That diagnosis was wrong, and the exclusion has been reverted — `domain`
caches normally again.**

Root-causing it properly: the cache **restore of `domain` is complete and correct** — a faithful
reproduction (`mvn clean` → partial `-pl service,cli -am compile` so `domain` restores from cache into
an empty `target/` → `quarkus:dev`) restores all `*MapperImpl` classes with **zero** stubs and boots
cleanly (`started in ~10s`, `/q/health` → 200). What actually produced the 22-bean failure was the
**IDE language server** (redhat.java / Claude Code's jdtls) compiling into the *same* `target/classes`
with a briefly-incomplete model and leaving broken/partial `*MapperImpl` stubs that Arc couldn't index
as beans. The very same mechanism produced the on-edit `java.lang.Error: Unresolved compilation
problems` (missing Lombok `@Builder`). Both are one bug: the LS sharing `target/classes` with
Maven/Quarkus.

The real fix lives in the **root pom** (`m2e-separate-output` profile) — it gives the language server
its own `target-ide/` build directory so it can never touch `target/classes`. It activates only under
m2e (the `m2e.version` user property m2e-core's `MavenExecutionContext` puts on every resolve —
verified in bytecode — and which no `./mvnw` CLI invocation sets), and relocates `<directory>` (a
profile *can* set that; it can't set `<outputDirectory>`, and the Quarkus dev mojo can't resolve a
property-indirected `<outputDirectory>` for reactor hot-reload deps — it looked for a literal
`target/${property}` and failed). With that in place the build cache needs no `domain` carve-out.

### 2. `service`'s Angular sources must be an explicit input — or a frontend change is a false hit

The extension scans only `src/main/{java,resources}` (+ test) by default, and the Angular app lives at
`service/src/main/webui/`. Without adding it, a **webui-only change would be a false cache hit** and
ship stale UI. So `webui/` is added as an input include, with its regenerable subdirs excluded:

```xml
<input><global>
  <includes><include>src/main/webui</include></includes>
  <excludes>
    <!-- gitignored, regenerable fixture CHECKOUTS beside the committed bare *.git repos;
         testing-repo-quarkus-angular is ~290MB — hashing it would be slow and unstable -->
    <exclude>src/test/resources/fixtures/testing-repo</exclude>
    <exclude>src/test/resources/fixtures/testing-repo-quarkus-angular</exclude>
    <!-- webui build/tooling artifacts (none affect the Angular production output; .pi/public/src are tracked inputs, kept) -->
    <exclude>src/main/webui/node_modules</exclude>
    <exclude>src/main/webui/dist</exclude>
    <exclude>src/main/webui/.angular</exclude>
    <exclude>src/main/webui/.vitest-attachments</exclude>
    <exclude>src/main/webui/.vscode</exclude>
    <exclude>src/main/webui/.claude</exclude>
  </excludes>
</global></input>
```

The default glob is `*` (all file types), left as-is so no Angular file type (`.ts/.html/.scss/.json`)
is silently dropped from the hash. Excluding the ~290MB gitignored fixture checkout under `domain`
keeps input hashing fast and stable (the committed bare `*.git` repos stay hashed — they *are* the
test inputs).

Integration tests (`-Pextended`, docker-dependent, self-skipping) are marked `runAlways` for
`maven-failsafe-plugin` so they are never served from cache.

## Verification (performed by hand)

- **No-op rebuild** — cold `install` 4:04 → second `install` **2.3s**, all 4 modules restored,
  Spotless/compile/Surefire/Quinoa all skipped.
- **Wiped-`target` pure restore** — `rm -rf */target && install` → **2.4s**; `service`'s
  `quarkus-app` with `quarkus-run.jar`, the Angular assets (`META-INF/resources/index.html`,
  `main-*.js`, `styles-*.css`) in `quarkus/generated-bytecode.jar`, and the 11 domain `*MapperImpl`
  classes all restored. Booting the restored `quarkus-run.jar` initializes the full Arc container +
  Flyway (24 migrations) + repository discovery with **no** "Unsatisfied dependency" — ruling out the
  stale-generated-code failure mode.
- **cli-only change → frontend skipped, and correct** — appended a comment to `cli/.../Main.java`:
  `domain` + `service` restored, **Quinoa not run**, `install` in **15s** (vs 4+ min), 0 unsatisfied.
  (This is the exact scenario that failed with the naive config before the `classes` attach.)
- **webui change → correctly misses** — touching a `webui/**` `.ts` file makes `service` a cache miss
  and Quinoa re-runs, while `domain`/`cli` restore.
- **Cache is the cause of the bean-wiring failure, not a pre-existing incremental bug** — the same
  rebuild-`cli`-against-existing-`domain`-jar succeeds with the cache disabled
  (`-Dmaven.build.cache.enabled=false`) and fails with it enabled (naive config), pinning the empty
  `target/classes` restore as the mechanism.

## Operational notes

- **Local cache only**, stored as a sibling to the local Maven repo (i.e.
  `${maven.repo.local}/../build-cache`); remote/shared cache is deliberately off (needs a
  hosting + write-trust decision before CI reuse — see below).
- **Disable per-invocation** with `-Dmaven.build.cache.enabled=false` (used above as a control; also
  the escape hatch if a restore is ever suspected). To fully reset, delete the cache directory:
  `rm -rf $(./mvnw help:evaluate -Dexpression=settings.localRepository -q -DforceStdout)/../build-cache`.
- **`quarkus:dev` is orthogonal** — the cache targets `package`/`test`/`install` lifecycle builds;
  dev mode is already incremental and workspace-aware.
- **Native (`-Dnative`) / extended (`-Pextended`)** — the `native` profile flips plugin config so it
  keys distinctly from JVM entries (no cross-contamination); the native runner binary is not attached,
  so treat native builds as uncached for now. Extended ITs are `runAlways`.

## Open questions / follow-ups

- **Remote/shared cache** for CI + cross-machine reuse is the larger payoff but needs a hosting choice
  (HTTP vs. object store) and a write-trust model. Local-only first.
- ~~**Root-cause the pre-existing `mvnw-clean-before-test` fragility.**~~ Done — it was Maven's
  incremental compiler leaving a changed source newer than its `.class`, which Quarkus's test-time
  recompilation then mis-registers. Fixed with `useIncrementalCompilation=false`; see
  `docs/issues/resolved/2026-07-05_mapstruct-unsatisfied-after-incremental-compile.md`.
