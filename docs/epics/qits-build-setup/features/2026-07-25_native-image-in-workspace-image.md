# GraalVM native-image (Mandrel) baked into the workspace image

## Introduction

Makes `./mvnw package -Dnative` work **inside a workspace container and the devcontainer**, by
installing Mandrel (the Quarkus-blessed, JVM-only GraalVM distribution) into the `workspace` stage of
`docker/qits/Dockerfile`.

Related plans:

- [qits-build-setup](../epic.md) — the epic this belongs to; sibling of
  [the screenshot-baseline renderer bake-in](2026-07-13_screenshot-baseline-renderer-baked-into-image.md),
  which is the same pattern (a toolchain the workspace image must own so results are reproducible
  and available everywhere).
- [qits-workspaces / workspace containers](../../qits-workspaces/features/2026-07-04_workspace-containers.md) —
  workspace containers are the sole execution environment for actions, dev servers and the coding
  agent; whatever they cannot do, nobody working in qits can do.
- [qits-workspace-daemon](../../qits-workspace-daemon/epic.md) — the first natively-compiled qits
  component; built by the separate `workspace-daemon-build` Mandrel stage, which is unaffected.
- [qits-gateway](../../qits-gateway/epic.md) — the second one, and the trigger: it is developed in
  its own repository (a submodule of qits) *from inside a workspace*, and it compiles to native.

## The problem

`native-image` existed in exactly one place: the `workspace-daemon-build` Docker stage
(`quay.io/quarkus/ubi9-quarkus-mandrel-builder-image:jdk-25`), used at *image build* time. The
`workspace` stage — the image every workspace container and the devcontainer run — shipped Temurin
JDK 25 and no native toolchain at all.

Quarkus' fallback for a missing local toolchain is `quarkus.native.container-build`, which shells out
to the Mandrel *builder image* via docker. Workspace containers have no docker CLI, so that fallback
can never fire there. The net effect: a component whose defining property is "compiles to native"
could be written, tested and reviewed in a workspace but never actually native-compiled in one — the
only feedback path was a full image build, or a failure at the end of a long build.

## The change

### The stage split

`docker/qits/Dockerfile` previously had one shared toolchain stage, `workspace`, that the app image
stages built on (`FROM workspace AS build`, `FROM workspace` for the runtime image). A native
toolchain added there would have landed in the qits app image too, for no benefit — qits
native-compiles nothing at runtime. So the shared stage is now:

- **`workspace-base`** — everything that was in `workspace` before, unchanged: the apt toolchain,
  Temurin JDK 25, node/pnpm, fonts + Playwright Chromium, the agent CLIs, the `qits-workspace-daemon`
  binary and its ENTRYPOINT. **The app image stages build on this** (`FROM workspace-base`).
- **`workspace`** — `workspace-base` + the GraalVM toolchain below. This is what `--target workspace`
  builds, what workspace containers run and what the devcontainer extends. **The build command is
  unchanged**, and so is everything the app image contains.

`workspace-daemon-build` stays exactly as it was, a separate stage on the Mandrel *builder image*:
the daemon binary must be cross-built before/independently of the image that ships it, and every
build path that produces it (Dokploy's git-driven build included) depends on that stage existing.

### The toolchain layer

One layer in the new `workspace` stage:

- Downloads Mandrel `java25` for the build architecture (`amd64`/`aarch64` derived from `dpkg
  --print-architecture`), **verifies it against the release's own `.sha256` asset**, and unpacks it to
  `/usr/lib/jvm/mandrel-25`.
- Symlinks `native-image` into `/usr/local/bin` (so a bare invocation works — a hand-written script,
  a non-Quarkus project) and sets `ENV GRAALVM_HOME=/usr/lib/jvm/mandrel-25`.
- Runs `native-image --version` in the same layer, so an unusable toolchain fails the image build
  loudly rather than at first use. It links against the `build-essential`/`zlib1g-dev` layer already
  installed above.
- `ARG MANDREL_VERSION=25.0.3.0-Final` is the upgrade knob.

**Temurin stays `JAVA_HOME`** — the runtime everything compiles and runs on, and what jdtls
discovers. Mandrel is reachable only as `GRAALVM_HOME`, which is the second entry in Quarkus' native
toolchain discovery order (`quarkus.native.graalvm-home` → `GRAALVM_HOME` → `JAVA_HOME`). Two JDKs,
each with one job, and no behaviour change for any JVM build.

`java25` is not cosmetic: native-image cannot read bytecode newer than its own JDK, and every module
in reach targets `maven.compiler.release=25` — the same constraint the `workspace-daemon-build` stage
documents.

## Consequences

- **Size.** ~200 MB download, ~1 GB in the layer — in the workspace image **only**. The app image is
  unaffected: it stops at `workspace-base`.
- **The `workspace-daemon-build` stage is unchanged.** It keeps using the Mandrel builder image: it
  runs before/independently of the workspace stages and must not depend on them.
- **The image must be rebuilt** for any of this to appear —
  `docker build -t qits/workspace --target workspace -f docker/qits/Dockerfile .` — and the
  devcontainer rebuilt after that, since it extends the same stage.

## Verification

No docker CLI is available inside a workspace container, so the image itself could not be built here.
Instead the layer's shell was extracted **verbatim from the committed Dockerfile** and executed
against a relocated prefix (download → `sha256sum -c` → unpack → symlink →
`native-image --version` ⇒ `native-image 25.0.3 / Mandrel-25.0.3.0-Final`), then used end to end by
native-compiling the qits-gateway with only `GRAALVM_HOME` pointed at the resulting toolchain:

- `./mvnw package -Dnative -Dquarkus.native.native-image-xmx=4g` → **BUILD SUCCESS in 82 s**, 48 MB
  binary, peak RSS 2.5 GB.
- The binary starts in **21 ms** and serves its route table on `/q/health/ready`.

The 2.5 GB peak matters for hosts running several workspaces: keep passing
`-Dquarkus.native.native-image-xmx` in build commands, as the Dockerfile's own native stages do.
