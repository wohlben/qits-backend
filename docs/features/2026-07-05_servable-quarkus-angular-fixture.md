# Servable Quarkus + Angular test fixture (`testing-repo-quarkus-angular`)

## Introduction

The only in-repo git fixture used to be
[`testing-repo.git`](../../domain/src/test/resources/fixtures/testing-repo/README.md) — a bare repo
whose whole content is `hello.txt` + `README.md`. It's ideal for *git mechanics* (clone, pull, branch
discovery, divergence probes, the JGit git host) and nothing else runs in it.

This feature adds a **second bare fixture** — `testing-repo-quarkus-angular.git`, a genuinely
**servable, minimal Quarkus 3 + Angular app** shaped like qits itself — so the features that run real
work inside a worktree have a plausible project to point at, and **fixes a modelling wart** in the
existing fixture at the same time (its editing checkout is now a gitignored plain clone, not a
committed submodule).

Related plans it exists to demo:

- **[Workspace containers](2026-07-04_workspace-containers.md)** /
  **[disposable workspace containers](2026-07-04_disposable-workspace-containers.md)** — a worktree
  clones a branch into a container and runs things; `hello.txt` runs nothing, this app does.
- **[Daemons](2026-07-04_daemons.md)** + the **[daemon web-view picker](2026-07-05_daemon-webview-picker.md)**
  — need a long-running dev server serving a real page (`./mvnw quarkus:dev`).
- **[Actions / feature-flows](2026-05-01_actions.md)** — "build"/"test"/"run" steps need something
  buildable and testable.
- **[Framework-aware file browser](2026-07-03_framework-aware-file-browser.md)** /
  **[smart file display](2026-07-03_worktree-smart-file-display.md)** — key off recognizable shapes
  (a `pom.xml`, an `angular.json`), which this fixture has and `testing-repo` doesn't.
- **[Coding agent harness](2026-07-01_coding-agent-harness.md)** — a real agent demo needs a real
  (if tiny) app to modify and re-run.

## As built

### The app (`domain/src/test/resources/fixtures/testing-repo-quarkus-angular.git`)

Scaffolded from the official initializer (<https://code.quarkus.io>, stream 3.37, `quarkus-rest-jackson`
+ `quarkus-quinoa`) then trimmed to the smallest thing that is still recognizably "a small qits":

```
pom.xml                                     single-module Quarkus app, maven.compiler.release=25
mvnw  mvnw.cmd  .mvn/wrapper/…              committed Maven wrapper
src/main/java/…/testingrepo/GreetingResource.java
src/main/resources/application.properties   quarkus.rest.path=/api + Quinoa config
src/main/webui/                             Angular 21 app (Quinoa auto-detects it, pnpm-lock.yaml)
  src/app/app.routes.ts  greeting.ts  greeting-redirect.ts  app.config.ts
src/test/java/…/testingrepo/GreetingResourceTest.java  @QuarkusTest for POST /api/greetings
```

- **Backend** — `POST /api/greetings` with `{"name":"..."}` returns `{"name":"...","timestamp":"<Instant>"}`.
  The `/api` prefix is `quarkus.rest.path`; the resource declares `/greetings`.
- **Frontend** — route `/greeting/:name` (`Greeting`) URL-decodes the name, `POST`s it to the
  same-origin `/api/greetings`, and renders **"Hello, {name}!"** with the timestamp. Uses signals +
  `toSignal` over the route `paramMap`.
- **Fallback** — `/greeting`, `/`, and any unmatched path route to `GreetingRedirect`, which calls
  `router.navigateByUrl('/greeting/world', { replaceUrl: true })`. This is the imperative
  "replaceUrl" — deliberately **not** a config `redirectTo`, so the fallback URL isn't pushed onto the
  browser history (no back-button trap).

**GroupId note:** the requested `eu.wohlben.qits.testing-repo` isn't a legal package (the initializer
rejects the dash), so the fixture uses `eu.wohlben.qits.testingrepo`.

**Endpoint note:** the route is `greeting/:name` (singular) and the REST collection is `/api/greetings`
(plural, RESTful); the frontend `POST`s to `/api/greetings`.

### Verified working

`./mvnw package` in the fixture builds green end-to-end: the `@QuarkusTest` passes, Quinoa detects
Angular + pnpm, runs `pnpm install`, and the Angular production bundle is built into the packaged jar.
Running `target/quarkus-app/quarkus-run.jar` and driving it confirms it's servable:

- `POST /api/greetings {"name":"Ada Lovelace"}` → `{"name":"Ada Lovelace","timestamp":"2026-07-05T…Z"}`
- `GET /` → the SPA's `index.html`
- `GET /greeting/world` (SPA deep link, hard load) → `200` (Quinoa `enable-spa-routing`)

No dev proxy config was needed: Quinoa serves the SPA and `/api` from one origin (in dev it runs
`ng serve` and proxies the UI), so the app's relative `/api/greetings` calls just work.

### Storage model (same as `testing-repo`)

The **bare repo is committed to qits as plain files** — the committed `*.git` dir *is* the source of
truth; tests/seed clone it via `getClass().getResource("/fixtures/…​.git")`, network-free. Source only
(no `node_modules`/`target`/`dist`), so the committed objects stay small (~220 KB). Build artifacts
are produced inside the workspace container at run time, never committed.

### Branch layout

| Branch             | Purpose                                                              |
|--------------------|---------------------------------------------------------------------|
| `main`             | the app; greeting reads "Hello, {name}!"                             |
| `feature/greeting` | adds a welcome note — a clean **fast-forward** over `main`           |
| `feature/diverged` | rewords the same `<h1>` line — **diverges from / conflicts** with `main` |

(Mirrors the fast-forwardable vs. diverged worktree states the `seed` command already demonstrates
for `testing-repo`.)

### Editing checkout — gitignored plain clone (and the `testing-repo` fix)

Both fixtures now follow one model: the committed bare `*.git` is the source of truth, and the editing
checkout beside it is a **gitignored plain clone** (`domain/src/test/resources/fixtures/.gitignore`
ignores `testing-repo/` and `testing-repo-quarkus-angular/`), regenerated with
`git clone <name>.git <name>`.

The existing `testing-repo` was a committed **git submodule** — heavier than warranted for the same
"editing convenience" role, and it carried a stale `.gitmodules` mismatch (name `service/…`, path
`domain/…`, a module-reorg leftover). Since no code reads the working checkout (every reference points
at `testing-repo.git`), the submodule was removed: `git submodule deinit`, drop the gitlink, delete
`.gitmodules`, gitignore the dir. A fresh `git clone` of qits no longer needs `--recurse-submodules`.

## Not yet wired (follow-ups)

The fixture exists and is servable, but nothing in qits consumes it yet. Deferred, each a small
additive step:

- **Seed a second project** from `testing-repo-quarkus-angular.git` in `SeedService` (it already
  supports a `qits.seed.repo-url` override and builds fast-forwardable/diverged worktrees) so the
  daemon/dev-server and action demos land on a real app. Keep the `testing-repo` project for the pure
  git-mechanics demos.
- **Tests** that need a *buildable/servable* worktree (daemon dev-server, action "run"/"test") can opt
  into the new fixture; the heaviest belong under the docker-dependent **`-Pextended`** profile.
- **`testing-repo`'s internal README** still describes itself as a submodule — a cosmetic staleness
  inside the fixture's own history; updating it means a new commit in `testing-repo.git`, deferred to
  avoid churning the committed bare-repo objects.

## Verification sketch (for the follow-ups)

- **Clone network-free:** a test cloning `/fixtures/testing-repo-quarkus-angular.git` succeeds offline,
  same as `testing-repo.git`.
- **Servable in a container:** create a worktree, start a `quarkus:dev` daemon, confirm the web-view
  picker sees a live page and `POST /api/greetings` returns the JSON.
- **Divergence demo:** `feature/diverged` shows diverged/conflicting; `feature/greeting` fast-forwards.
- **Existing-fixture cleanup:** a fresh `git clone` (no `--recurse-submodules`) has no dangling gitlink;
  the full suite still passes (nothing read the working checkout).
