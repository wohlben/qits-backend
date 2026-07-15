# qits

A Quarkus-based service for managing Git repositories and workspaces, with an Angular web UI.

## Project Structure

```
qits/
├── pom.xml                          # Root Maven POM (multi-module)
└── service/
    ├── pom.xml                      # Service module POM (Quarkus)
    └── src/
        ├── main/
        │   ├── java/                # Backend (Quarkus, REST API, services)
        │   ├── resources/           # Application config, DB migrations
        │   └── webui/               # Angular frontend (Quinoa default UI dir)
        │       ├── package.json
        │       ├── angular.json
        │       └── src/             # Angular source
        └── test/
            ├── java/                # Unit & integration tests (JUnit)
            └── resources/
                └── fixtures/            # git test fixtures (under the domain module)
                    ├── submodule-*.git/            # tiny bare repos committed as plain files
                    ├── testing-repo/               # submodule → qits-fixture-testing-repo
                    ├── testing-repo-angular/       # submodule → qits-fixture-angular
                    └── testing-repo-quarkus-angular/  # submodule → qits-fixture-quarkus-angular
                                                       #   (its src/main/webui is a nested submodule
                                                       #    → qits-fixture-angular)
```

## Test-fixture submodules

The git test fixtures live under `domain/src/test/resources/fixtures/`. Three of them are **git
submodules** pointing at standalone `github.com/wohlben/qits-fixture-*` repos:

| Submodule dir | GitHub repo | Role |
|---|---|---|
| `testing-repo` | `qits-fixture-testing-repo` | pure git mechanics (clone/pull/divergence) |
| `testing-repo-angular` | `qits-fixture-angular` | the Angular SPA on its own (Angular-only workspace) |
| `testing-repo-quarkus-angular` | `qits-fixture-quarkus-angular` | full-stack app; `src/main/webui` is a **nested submodule** → `qits-fixture-angular` |

Tests and the seeds resolve each fixture as a *bare* repo (`/fixtures/<name>.git`). The build
**derives** those bares from the submodule working trees into `target/test-classes/fixtures/`
(`scripts/derive-fixture-bares.sh`, run automatically as a `runAlways` maven-antrun step — all
offline). You never commit a bare; you bump a submodule pointer.

### Cloning

```bash
git clone --recurse-submodules <repo-url>          # nested: pulls quarkus-angular → angular
# already cloned without it?
git submodule update --init --recursive
```

A build without the submodules initialised fails the fixture-derivation step with a hint to run the
command above.

### Editing a fixture

Fixtures are append-only; treat a branch-tip change as deliberate. The Quarkus+Angular SPA lives in
`qits-fixture-angular`, so a SPA change is a **two-level** round-trip:

```bash
# 1. change + push the SPA
cd domain/src/test/resources/fixtures/testing-repo-angular   # (or the nested .../src/main/webui)
git commit -am "..." && git push
# 2. bump the webui gitlink in the quarkus-angular superproject, push it
# 3. bump the fixture submodule pointer(s) in qits and commit
git add domain/src/test/resources/fixtures/testing-repo-angular
git commit -m "Bump angular fixture"
```

## Frontend

The Angular UI lives at `service/src/main/webui/` — Quinoa's default UI directory. It is built and served via [Quarkus Quinoa](https://quarkiverse.github.io/quarkiverse-docs/quarkus-quinoa/dev/index.html) during development and packaged into the application at build time. Quinoa auto-detects the Angular framework and the pnpm package manager, so no extra `quarkus.quinoa.*` path configuration is required.

## Building & running

```bash
# Full build (all modules, frontend + backend)
./mvnw package

# First on a fresh checkout, build so the `domain` module is resolvable:
./mvnw install -DskipTests

# Run the web app in dev mode (live-reload for both Java and Angular, UI on :4200)
./mvnw -pl service -am quarkus:dev -Dquarkus.bootstrap.workspace-discovery=true

# Seed demo data (a project + branch tree, incl. fast-forwardable / diverged workspaces) into the
# shared local H2 DB so it shows up in the running app. One-step command-mode run, no web server.
# NOTE: `quarkus:run` executes the packaged CLI app, so build it first (`install`/`package` above);
# after a `clean` you must repackage or it fails with "Unable to access jarfile …/quarkus-run.jar".
./mvnw -pl cli -am install -DskipTests && ./mvnw -pl cli quarkus:run -Dcli.args=seed

# Seed the servable Quarkus + Angular demo: a "Quarkus + Angular Demo" project + a repository cloned
# from the testing-repo-quarkus-angular fixture, a web-viewable OTEL-enabled `quarkus:dev` daemon
# (LOG_LEVEL + PATTERN log observers, a FILE log source), a `greeting` workspace, and a "Build &
# Verify" feature-flow blueprint. This exercises the stack-specific feature surface (framework
# detection, the daemon web view, observability, log observation, feature-flows, the coding agent).
# Idempotent by RESET: each run deletes and recreates the project, always returning to the same
# known-good state — so use it as the fixture for manual UI poking and regression tests.
# (Same build prerequisite as `seed` above — package the CLI app before `quarkus:run`.)
./mvnw -pl cli -am install -DskipTests && ./mvnw -pl cli -am quarkus:run -Dcli.args=seed-webapp
```

## Deploying to a server (Docker)

Deployment is **build-on-the-server**: a throwaway container (with the host docker socket mounted)
clones this repo, builds the qits images from source, and brings the stack up — leaving nothing on the
host but the images and the running stack. No registry, no push. On a Linux server with Docker:

```bash
docker run --rm \
  -v /var/run/docker.sock:/var/run/docker.sock \
  docker:cli sh -c '\
    apk add --no-cache bash git curl >/dev/null && \
    curl -fsSL https://raw.githubusercontent.com/wohlben/qits-backend/main/install.sh | bash'
```

The first run is slow (it builds the workspace toolchain image + compiles the app). When it finishes,
qits runs on the `qits-net` network (alias `qits`, port 8080, no host port published — front it with a
reverse/forward-auth proxy). Re-run the same command to upgrade. Pin a release with `-e QITS_REF=<tag>`.

See **[`docs/guides/deployment.md`](docs/guides/deployment.md)** for the full contract (the by-hand
equivalent, ingress/auth, config knobs, state & backups, upgrades).
