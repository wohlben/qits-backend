# Clean devcontainer re-downloads all Maven deps — VS Code's Java LS ignored the shared /caches/m2

## Introduction

Found right after fixing the [stale-container bring-up
failure](./2026-07-08_devcontainer-stale-container-wont-start.md): each *clean* devcontainer appeared
to re-download every Maven dependency from Central, even though a shared `qits_shared_m2` volume was
supposed to persist them. Related: [qits-net devcontainer
unification](../features/2026-07-07_qits-net-devcontainer-unification.md),
[.devcontainer/docker-compose.yml](../../.devcontainer/docker-compose.yml).

## Symptom

Opening the project in a freshly created devcontainer, VS Code's Java tooling downloads the full
dependency set from Maven Central every time — the `qits_shared_m2` volume never seems to help.

## Cause

Two different Maven resolvers run in the devcontainer, and only one was pointed at the shared volume:

- **The terminal `./mvnw`** (postCreate build, manual builds) honors
  `MAVEN_OPTS=-Dmaven.repo.local=/caches/m2` (set in `docker-compose.yml`), so it resolves into the
  shared `qits_shared_m2` volume (mounted at `/caches/m2`). Verified: a build here produces **0
  downloads** on a warm volume.
- **VS Code's Java Language Server** (redhat.java → JDT-LS's embedded m2e resolver) does **not** read
  `MAVEN_OPTS`. With no `~/.m2/settings.xml` present in the image, it falls back to the **default
  `~/.m2/repository`** = `/home/dev/.m2/repository`, which lives on the **ephemeral container layer**
  (the persistent volume is at `/caches/m2`, and `qits-data` covers `~/.qits`, not `~/.m2`). So the
  LS's project import re-downloads everything into a throwaway repo on every clean container.

So the volume and the `MAVEN_OPTS` redirect were both correct — the Java LS was simply never told
about them.

## Fix

Give the Java LS a `settings.xml` whose `<localRepository>` is the shared volume, and point it there:

- Added [`.devcontainer/m2-settings.xml`](../../.devcontainer/m2-settings.xml) with
  `<localRepository>/caches/m2</localRepository>` — honored by both the CLI and the LS.
- Set `java.configuration.maven.userSettings` to it in
  [`.devcontainer/devcontainer.json`](../../.devcontainer/devcontainer.json)'s
  `customizations.vscode.settings`, so JDT-LS resolves into `/caches/m2` like the CLI does.

Verified with `./mvnw -s .devcontainer/m2-settings.xml` and `MAVEN_OPTS` unset: `Using local
repository at /caches/m2` — i.e. the `<localRepository>` directive alone (the exact path the LS uses)
redirects resolution to the shared volume.

## Notes

- The Maven **build cache** (`~/.m2/build-cache`, the module-restore extension) is a separate cache
  and is still ephemeral per container — that governs whether *modules rebuild*, not whether *deps
  download*, and was not the cause here. Sharing it too is a possible future improvement but out of
  scope for this download issue.
- `docker exec` does inherit the compose `MAVEN_OPTS`, so terminal `mvn` in VS Code was always fine;
  only the in-process LS resolver was affected.
