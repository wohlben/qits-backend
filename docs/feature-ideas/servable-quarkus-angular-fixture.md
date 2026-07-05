# Servable Quarkus + Angular test fixture (`testing-repo-quarkus-angular`)

## Introduction

Today the only in-repo git fixture is
[`domain/src/test/resources/fixtures/testing-repo.git`](../../domain/src/test/resources/fixtures/testing-repo/README.md)
— a bare repo whose entire content is `hello.txt` + `README.md` on `master`/`feature`. It's perfect
for exercising *git mechanics* (clone, pull, branch discovery, divergence probes, the JGit git host)
without a network, and that's all it's ever asked to do.

But qits is increasingly about running *real work inside a worktree*, not just moving refs around,
and none of that has a fixture that plausibly represents a real project:

- **[Workspace containers](../features/2026-07-04_workspace-containers.md)** and
  **[disposable workspace containers](../features/2026-07-04_disposable-workspace-containers.md)** —
  a worktree is a container that clones a branch and runs things in it. `hello.txt` runs nothing.
- **[Daemons](../features/2026-07-04_daemons.md)** and the
  **[daemon web-view picker](../features/2026-07-05_daemon-webview-picker.md)** — these want a
  long-running dev server on a port serving a real page to observe/pick against.
- **[Actions / feature-flows](../features/2026-05-01_actions.md)** — steps like "build", "test",
  "run" need something buildable and testable to run against.
- **[Framework-aware file browser](../features/2026-07-03_framework-aware-file-browser.md)** and
  **[smart file display](../features/2026-07-03_worktree-smart-file-display.md)** — these key off
  recognizable project shapes (a `pom.xml`, an `angular.json`); the current fixture has neither.
- **[Coding agent harness](../features/2026-07-01_coding-agent-harness.md)** — a real agent demo
  needs a real (if tiny) app to modify and re-run.

This idea adds a **second fixture** — a genuinely servable, absolutely-minimal Quarkus + Angular
app, shaped like qits itself — so those features can be demonstrated end-to-end against a plausible
project. It also **fixes a modelling wart in the existing fixture** at the same time: the editing
checkout should be a *gitignored plain clone*, not a committed submodule (see
[Fix the existing checkout](#fix-the-existing-checkout-submodule--gitignored-clone)).

Related/dependent plans: all of the features linked above (this fixture is the demo substrate for
them), plus the `cli` **`seed`** flow (`SeedService`) which is the natural place to wire a second
seeded project from this fixture.

## What "minimal but servable, shaped like qits" means

The point is a fixture a viewer recognizes as "a small version of qits": a Quarkus backend serving a
single JSON endpoint and a one-page Angular UI via Quinoa, buildable and runnable **inside the
`qits/workspace` container** with the same toolchain the real app uses (JDK 25, Maven wrapper, pnpm).
Least dependencies possible, but real enough to `quarkus:dev`, `mvnw test`, and serve a page.

Concretely, the smallest thing that still illustrates features:

```
testing-repo-quarkus-angular/            (the working checkout — GITIGNORED, see below)
  pom.xml                                single-module Quarkus app
  mvnw  .mvn/wrapper/…                   Maven wrapper (matches qits' "always use the wrapper")
  src/main/java/…/GreetingResource.java  one JAX-RS endpoint: GET /api/hello -> {"message": "..."}
  src/main/resources/application.properties   quarkus.rest.path=/api, quarkus.quinoa.* (mirror qits)
  src/main/webui/                        minimal Angular app (Quinoa auto-detected)
    package.json  pnpm-lock.yaml  angular.json  src/…   one component that fetches /api/hello
  src/test/java/…/GreetingResourceTest.java   one @QuarkusTest asserting the endpoint
  README.md                              what it is / how to run
```

Dependency floor to aim for:

- **Backend:** `quarkus-rest` + `quarkus-rest-jackson` (or classic REST) for the one endpoint,
  `quarkus-quinoa` to build+serve the Angular app, `quarkus-junit5` + `rest-assured` for the one
  test. No datasource, no Flyway, no health, no MapStruct — deliberately none of qits' heavier
  extensions. If Quinoa proves to add too much friction for such a tiny fixture, fall back to a
  hand-written static `src/main/resources/META-INF/resources/index.html` that fetches `/api/hello`,
  dropping the pnpm/Angular toolchain entirely (see Open questions).
- **Frontend:** a single standalone Angular component, OnPush, that calls the endpoint and renders
  the message. No routing, no component library, no state management.

### Branch layout (so it can demo more than "clone")

Mirror the *intent* of the existing fixture's branches, but with changes that touch the running app
so worktree divergence/actions have something visible to show:

| Branch                | Purpose                                                             |
|-----------------------|--------------------------------------------------------------------|
| `main`                | default branch — the app as above                                  |
| `feature/greeting`    | a small change to the greeting text/component — clean fast-forward |
| `feature/diverged`    | a commit that conflicts with a `main` change — divergence/conflict |

(Named to demo the fast-forwardable vs. diverged worktree states the seed command already builds for
`testing-repo`.) Keep commit history tiny — a handful of commits, source only.

## The bare-repo-as-committed-files pattern (unchanged)

Follow the existing fixture's storage model exactly, because it's what makes tests network-free and
reproducible: the **bare repo is committed to the qits repo as plain files** at
`domain/src/test/resources/fixtures/testing-repo-quarkus-angular.git/`. That directory *is* the
source of truth; tests and seed clone from it via a `file:`/classpath URL just like
`testing-repo.git` (`getClass().getResource("/fixtures/…​.git")`).

Because it's source-only (no `node_modules/`, no `target/`, no built `dist/`), the committed git
objects stay small. The heavy build artifacts are produced *inside the workspace container at run
time*, never committed.

## The editing checkout — gitignored plain clone (not a submodule)

The working checkout beside the bare repo (`testing-repo-quarkus-angular/`) exists **only so a human
can edit the fixture** and push changes back into the bare mirror. Since the bare repo is already the
committed source of truth, the checkout is fully regenerable and should **not** be tracked:

```bash
# regenerate the editing checkout from the committed bare repo
cd domain/src/test/resources/fixtures
git clone testing-repo-quarkus-angular.git testing-repo-quarkus-angular
# …edit, commit, push back into the bare mirror…
git -C testing-repo-quarkus-angular push origin main
```

Add the checkout dir to `domain/src/test/resources/fixtures/.gitignore`. This is deliberately
**simpler than the submodule** the existing fixture uses: no `.gitmodules` entry, no gitlink to keep
in sync, no `--recurse-submodules` friction on fresh clones. The one thing we give up — a
version-pinned working-tree snapshot — we don't need, because the bare repo already pins everything
and the checkout is one `git clone` away.

## Fix the existing checkout (submodule → gitignored clone)

The user's observation is correct: `testing-repo/` was set up as a **committed git submodule**, which
is heavier than warranted for the same "editing convenience" role, and it carries a stale mismatch —
`.gitmodules` names the submodule `service/src/test/resources/fixtures/testing-repo` while its
`path =` is `domain/src/test/resources/fixtures/testing-repo` (a leftover from the module reorg).
No code reads the working checkout — every reference in tests, seed, and MCP tools points at
`testing-repo.git` — so the submodule buys us nothing at runtime.

Bring it in line with the new fixture's pattern:

1. `git submodule deinit -f domain/src/test/resources/fixtures/testing-repo`
2. `git rm --cached domain/src/test/resources/fixtures/testing-repo` (drop the gitlink; keep the bare
   repo `testing-repo.git` untouched)
3. Remove the `[submodule …]` block from `.gitmodules` (delete the file if it becomes empty).
4. Add `testing-repo/` to `domain/src/test/resources/fixtures/.gitignore`.
5. Update the fixture `README.md` and the **CLAUDE.md "Test fixtures"** paragraph, which currently
   documents the submodule model, to describe the gitignored-clone model instead.

This is a self-contained cleanup that can land with the new fixture or on its own.

## How it plugs into seed and tests

- **Seed:** add a second seeded project sourced from `testing-repo-quarkus-angular.git` (the seed
  already supports a `qits.seed.repo-url` override and builds fast-forwardable/diverged worktrees for
  `testing-repo`). A "qits-like demo" project makes the daemon/dev-server and action demos land on
  something real. Keep the existing `testing-repo` project for the pure git-mechanics demos.
- **Tests:** purely additive. Existing tests keep using `testing-repo.git`. New tests that need a
  *buildable/servable* worktree (e.g. daemon dev-server, action "run"/"test" steps) opt into the new
  fixture. Because it builds inside the container, the heaviest of those belong under the
  docker-dependent **`-Pextended`** profile (they self-skip when docker/the image is absent), not the
  default unit suite.

## Open questions

- **Quinoa+Angular vs. static HTML.** A real Angular app (pnpm, `angular.json`) is the most faithful
  to qits and best exercises the framework-aware file browser, but it's a lot of files for a
  "minimal" fixture and adds a pnpm build step to any container run. A hand-written static page that
  fetches `/api/hello` is dramatically smaller and still "servable + Quarkus-shaped." Decide which
  faithfulness/size tradeoff wins — possibly ship the static version first and grow the Angular
  frontend only if a feature demo actually needs it.
- **Maven wrapper commit.** Committing `mvnw` + `.mvn/wrapper/maven-wrapper.jar` (a small binary)
  makes the fixture self-bootstrapping in the container and matches qits' "always use the wrapper"
  rule; relying on the container's system `mvn` avoids the binary blob. Lean toward committing the
  wrapper for fidelity.
- **Toolchain drift.** The fixture pins Quarkus/Angular/JDK versions independently of qits. Note that
  it's a *demo fixture*, not a dependency of the build, so it can lag; but the `qits/workspace` image
  must be able to build it (JDK 25 + pnpm are already in the fat image).
- **Do we retire `testing-repo`?** No — keep both. The tiny one stays the fast, dependency-free
  fixture for git-mechanics tests; the new one is the "real project" demo substrate. They serve
  different purposes.

## Verification sketch

- **Clone-network-free:** a test cloning `/fixtures/testing-repo-quarkus-angular.git` succeeds with
  no network, same as `testing-repo.git`.
- **Servable in a container:** create a worktree from the fixture, start a `quarkus:dev` daemon, and
  confirm the daemon web-view picker sees a live page and `GET /api/hello` returns the JSON.
- **Buildable/testable:** an action "test" step runs `./mvnw test` in the worktree and the one
  `@QuarkusTest` passes.
- **Divergence demo:** `feature/diverged` shows as a conflicting/diverged worktree; `feature/greeting`
  fast-forwards — matching the states the seed command demonstrates for `testing-repo`.
- **Existing-fixture cleanup:** after the submodule→gitignored change, a fresh `git clone` of qits
  (without `--recurse-submodules`) has no dangling gitlink, the full test suite still passes (nothing
  read the working checkout), and `git clone testing-repo.git testing-repo` regenerates the editing
  checkout as an ignored dir.
