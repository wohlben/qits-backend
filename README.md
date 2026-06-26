# qits

A Quarkus-based service for managing Git repositories and worktrees, with an Angular web UI.

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
                └── fixtures/
                    ├── testing-repo.git/   # ← Bare repo fixture (tracked files)
                    └── testing-repo/       # ← Submodule (checked-out working copy)
```

## Submodules

### Why `testing-repo` is a submodule

`service/src/test/resources/fixtures/testing-repo.git` is a **bare Git repository** committed as regular files. It provides reproducible test data for integration tests that exercise clone/pull operations.

`service/src/test/resources/fixtures/testing-repo` is a **Git submodule** pointing at `testing-repo.git`. It exists so you can:

- Inspect the fixture repository's contents easily
- Add/modify branches, commits, or tags for new test scenarios
- Push changes back to the bare repo (`testing-repo.git`) to update the fixture

### Working with the submodule

```bash
# Navigate to the submodule
cd service/src/test/resources/fixtures/testing-repo

# The submodule is already configured with the bare repo as its origin
git remote -v
# origin  ../testing-repo.git (fetch)
# origin  ../testing-repo.git (push)

# Make changes and push back to the fixture
git checkout -b new-test-scenario
# ... add commits ...
git push origin new-test-scenario
```

After updating `testing-repo.git`, commit the submodule pointer change in the parent repo:

```bash
cd /path/to/qits
git add service/src/test/resources/fixtures/testing-repo
git commit -m "Update test fixture with new scenario"
```

### Cloning this repository

The submodule is optional for basic builds, but required if you want to modify test fixtures:

```bash
git clone --recurse-submodules <repo-url>
```

If you already cloned without `--recurse-submodules`:

```bash
git submodule update --init --recursive
```

## Frontend

The Angular UI lives at `service/src/main/webui/` — Quinoa's default UI directory. It is built and served via [Quarkus Quinoa](https://quarkiverse.github.io/quarkiverse-docs/quarkus-quinoa/dev/index.html) during development and packaged into the application at build time. Quinoa auto-detects the Angular framework and the pnpm package manager, so no extra `quarkus.quinoa.*` path configuration is required.

## Building

```bash
# Full build (frontend + backend)
./mvnw package

# Run in dev mode (live-reload for both Java and Angular)
cd service && ./mvnw quarkus:dev
```
