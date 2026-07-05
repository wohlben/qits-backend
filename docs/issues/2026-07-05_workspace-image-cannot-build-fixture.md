# Workspace image can't build the Quarkus+Angular fixture (missing `unzip`, wrong JDK)

## Introduction

The `seed-webapp` demo ([servable Quarkus+Angular fixture](../features/2026-07-05_servable-quarkus-angular-fixture.md),
[full-feature integration](../feature-ideas/quarkus-angular-fixture-full-integration.md)) seeds a
"Quarkus dev server" [daemon](../features/2026-07-04_daemons.md) whose `startScript` is
`./mvnw -q quarkus:dev …`. That daemon runs inside a
[workspace container](../features/2026-07-04_workspace-containers.md) built from
`docker/workspace/Dockerfile`. Two toolchain gaps in that image stop the fixture from ever building,
so the daemon crashes on launch. This is a fixture/image bug, **not** a daemon-supervisor or
event-surfacing bug — the crash is correctly detected, restarted per policy, and surfaced (see below).

## Observed repro

On `.../workspaces/greeting`, start the "Quarkus dev server" daemon. It goes `STARTING → CRASHED`
after 3 immediate restarts. The crashed command's log (and the durable daemon-event excerpt) is:

```
Error: Failed to validate Maven distribution SHA-256, your Maven distribution might be compromised.
If you updated your Maven version, you need to update the specified distributionSha256Sum property.
```

Reproduced directly in the container:

```bash
docker exec -w /workspace qits-ws-greeting-<repo8> ./mvnw -v
# → same SHA-256 validation error, exit 1
```

## Root cause (blocker 1: missing `unzip` → SHA-256 mismatch)

The fixture pins its Maven distribution in
`.mvn/wrapper/maven-wrapper.properties` (maven-wrapper `3.3.4`, `distributionType=only-script`):

```
distributionUrl=…/apache-maven-3.9.16-bin.zip
distributionSha256Sum=5af3b743dd8b876b5c45da33b676251e5f1687712644abb4ee519ca56e1d89ce   # the .zip's hash
```

The generated `mvnw` script contains this branch (lines ~178-182):

```sh
# select .zip or .tar.gz
if ! command -v unzip >/dev/null; then
  distributionUrl="${distributionUrl%.zip}.tar.gz"   # falls back to tar.gz when unzip is absent
  distributionUrlName="${distributionUrl##*/}"
fi
```

The workspace image ships **no `unzip`** (only `tar`). So `mvnw` rewrites the URL to
`apache-maven-3.9.16-bin.tar.gz`, downloads *that*, and then validates it against the pinned **zip**
hash. The tar.gz hash is `80ffca22aed9e8b9713a232f3394fd81d7f20322df75efdb2b047dbd3e3a23bb` ≠
`5af3b743…`, so validation fails and `mvnw` exits 1 — every launch, hence the crash loop.

Confirmed the URL/SHA/network are otherwise fine: `curl`-downloading the `.zip` inside the container
reproduces the pinned hash exactly; only the tar.gz-rewrite path mismatches.

## Root cause (blocker 2: JDK 17 vs required JDK 25)

Even with `unzip` added, the next launch would fail to compile: the image installs
`openjdk-17-jdk-headless`, but the fixture targets `maven.compiler.release=25` (like qits itself). A
Java 25 `quarkus:dev` cannot run under JDK 17.

## Suggested fix direction

Both are `docker/workspace/Dockerfile` changes (then rebuild + recreate workspace containers):

1. **Add `unzip`** to the base apt install so `mvnw` keeps using the `.zip` it has a checksum for.
   (Alternative: drop/relax `distributionSha256Sum` in the fixture, or switch the wrapper to a
   `bin` distribution type — but the image is meant to be the fat toolchain, so shipping `unzip` is
   the right layer.)
2. **Install JDK 25** instead of 17 (e.g. Temurin 25 via the Adoptium apt repo) so Quarkus 3 / Java
   25 projects compile.

Rebuild: `docker build -t qits/workspace docker/workspace`. Existing per-workspace containers keep
running the old image until recreated — recreate the `greeting`/`main` containers (or re-run
`seed-webapp`) to pick it up.

## Note on error surfacing (not a bug)

The daemon feature surfaces this correctly. The `/api/daemon-events` durable feed carries the
`STATUS_CHANGED (CRASHED)` and `ERROR_DETECTED` events with the full log excerpt, the workspace
daemons panel renders them under "Recent events", and the status chip reads "CRASHED (3 restarts)".
The error is only invisible when the daemon is in `STOPPED` state — i.e. it was never started, or the
in-memory supervisor state was reset to `STOPPED` by a `quarkus:dev` live-reload (durable events
persist, but the chip resets). No change needed here.
