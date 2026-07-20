# userflows/

The qits **user stories** — programmatic, end-to-end walks through qits' UI in a real browser
(Playwright-Java) that render themselves into local **reports**. A story is a named, described,
step-recorded walk; running one produces more than a green check — it writes a markdown document
interleaving the story's description, its recorded steps, and inline screenshots, plus a video of
the run and a canonical `userflow.json`, into `target/userstories/<slug>/`.

This module is the automated sibling of `docs/manual-acceptance-tests/` — a story is the executable
form of a plan.md's scripted walk. It is **part 1** of the
[qits-userflows epic](../docs/epics/qits-userflows/epic.md): the reports it produces are shaped to
become the by-branch golden screenshots/videos a future diff tab compares (the artifacts upload
itself is a follow-up part, out of scope here). It depends on **none** of the app modules — it
reaches qits by URL only, so a story can never cheat the user's perspective by touching internals.
`-pl userflows` builds never need `-Dqits.variant`.

## This module is stories only; the framework is `qits-userflows`

- **This module** (`userflows`) holds **user stories only** — `src/test` classes, one `@UserStory`
  method per class, plus a lean `@AfterAll` companion that only *calls into* framework helpers.
  Nothing abstract, no plumbing, no reusable helper ever lands here. **If a story needs a helper, it
  goes in the framework**, not here.
- **The framework** (annotations, the `Flow` facade, the JUnit 5 extension + class orderer, the
  shared `UserflowContext`, the report model/renderers, and utilities like `ReportAssertions` /
  `HarnessResources` / `UserflowTarget`) lives in the sibling **[`qits-userflows`](../qits-userflows/AGENTS.md)**
  module, on this module's test classpath.

This module boundary is the **future repository boundary**: the framework split out here is a
temporary step ahead of part 4 of the epic extracting `qits-userflows` into a standalone library, so
qits-managed projects can author their own stories.

## Conventions: folder structure & naming

Stories are organized **by domain/epic**, never dumped in one flat package — so the suite stays
navigable as it grows. All under the package root `eu.wohlben.qits.userflows`:

```
eu.wohlben.qits.userflows.project              <- Browse/Create/Edit/DeleteProjectIT
eu.wohlben.qits.userflows.projectrepository    <- BrowseDemoProjectIT, Create/DeleteRepositoryIT
eu.wohlben.qits.userflows.workspace.webview    <- a sub-area of a domain nests (workspace → web view)
```

A dependent chain may span domains (a repository needs a project): `CreateRepositoryIT`
(`.projectrepository`) has `@UserflowPrecondition(CreateProjectIT.class)` from `.project`. That
cross-package reference just means the referenced class/keys are `public`.

- **One package per domain**; nest a sub-package for a sub-area (`workspace.webview`). Put a new
  story in the package that matches what it exercises; add a package when a new domain/area appears.
- **Naming**: `<Action><Domain>IT` — e.g. `CreateProjectIT`, `EditProjectIT`, `DeleteProjectIT`,
  `BrowseDemoProjectIT`. **No `Flow` suffix.** App stories end in `IT` (they're extended
  integration tests; see below).
- **One `@UserStory` method per class** — the display name in the annotation is what the report
  directory is slugged from; the class name is for humans and for `@UserflowPrecondition` references.

## Authoring a story

A story drives **qits itself** — a real walk through the qits application. (Stories for a
qits-managed project's *own* app live in that project, once part 4 of the epic extracts this
framework into a reusable library; they are not authored here.)

```java
@UserStory("Browse the demo project")
@UserStoryDescription("""
    An operator opens the projects list, picks a project, and drills into its
    repository to see the branch tree.
    """)
void browseDemoProject(Flow flow) {
  flow.navigate("/projects");
  flow.waitFor("app-project-card");
  flow.screenshot("app-project-list", "projects list").as("projects-list");
  flow.click("a:has-text('Quarkus + Angular Demo')");
  flow.waitFor("h2:has-text('Branches')");
  flow.screenshot("app-branch-list", "branch tree").as("branch-tree");
}
```

- `@UserStory("name")` is meta-annotated with `@Test` + the extension, so a story is just this one
  annotated method taking a `Flow` — no `@Test`, no `@ExtendWith`. The name is the display name and
  the (slugged) report directory name.
- `@UserStoryDescription("""…""")` is optional multiline **markdown**, rendered verbatim.
- **Drive the UI only through `Flow`.** Its verbs (`navigate`, `waitFor`, `click`, `fill`,
  `expectText`, `screenshot`) map 1:1 onto Playwright and each records a step — Playwright-Java has
  no step notion, so the facade *is* the step mechanism. `flow.page()` is the escape hatch for
  genuinely exotic interactions, but it **records nothing**: reach for it and the report goes blind.
- `flow.navigate("/path")` resolves relative paths against the base URL; absolute URLs (incl.
  `file://`) pass through. `flow.screenshot(selector, label)` captures an element,
  `flow.screenshot(label)` the full page; both write a PNG named by the step id and record the label.
- **Every step has a string `id`.** Unnamed steps get a machine `step-NN`; append `.as("open-project")`
  to give the step just recorded a meaningful, reorder-proof id — `flow.click("…").as("open-project")`.
  A screenshot links back to its step **by that id** (and, for a screenshot step, the id is the PNG
  file-name prefix), so ids are how media and steps stay coupled — never by position. Ids are labels
  only; they are **not** part of the `definitionHash`.
- The recorded step lines are hashed (verbs + selectors + labels, no typed values) into the
  deterministic `definitionHash` in the sidecar — the future `qits.userflow.hash`.

## Stories here are app stories

The stories in **this** module are **app stories** (`*IT`, `@Tag("extended")`): they drive a running
qits. They read the target from `qits.userflows.base-url` (default `http://localhost:8080`) and
**self-skip** via `assumeTrue(UserflowTarget.isReachable())` when nothing answers — safe in every
default build (mirrors `WorkspaceContainerIT`). Expected state is the idempotent `seed-webapp`
fixture. Reference: `BrowseDemoProjectIT` and the `CreateProjectIT` → `EditProjectIT` →
`DeleteProjectIT` chain.

> The framework's own **harness stories** — `*Test` classes that drive a bundled static page (no
> running app) to cover the framework machinery (step recording, the failure path, the
> ordering/skip/runs-after dependency logic) — live in the **`qits-userflows`** module's `src/test`,
> not here. Don't add framework-coverage stories to this module.

## Dependent flows

Stories are e2e tests against one shared qits, so a story can **build on state a previous story
produced** instead of setting up its own. Declare it on the `@UserStory` method:

```java
@UserStory("Edit the project")
@UserflowPrecondition(CreateProjectIT.class)         // depends on that story CLASS
void editProject(Flow flow, UserflowContext context) { // inject the shared context
  String id = context.require("project.id", String.class);
  flow.navigate("/projects/{}/edit", id);                // templated → stable definitionHash
  …
}
```

- **Ordering + skip**: predecessors always run first (topological `UserflowClassOrderer`), and a
  dependent is **skipped before its browser launches** if a **precondition** didn't pass (a failed,
  `@ExpectedFailure`, or itself-skipped precondition doesn't satisfy; skip is transitive).
- **Two edge kinds**: `@UserflowPrecondition(X.class)` = run after X **and** require X to pass (else
  skip). `@UserflowRunsAfter(X.class)` = run after X **only** (ordering; runs whether X passed,
  failed, or was skipped) — the **cleanup** edge. Combine them: a delete flow is
  `@UserflowPrecondition(create)` + `@UserflowRunsAfter(edit)`, so it still cleans up when edit
  fails but is skipped when create fails.
- **Handoff**: the producer stashes references (`context.put("project.id", Urls.lastPathSegment(
  flow.currentUrl()))`); dependents `require(...)` them. Namespace keys by the producing flow. Each
  story gets a fresh browser, so the *state* lives in qits — the context passes ids/URLs, not the
  state itself.
- **Dynamic ids**: use `flow.navigate("/projects/{}/edit", id)` (templated) so the fingerprint keeps
  `{}` and the hash stays stable per run; keep constant selectors (not per-run names) in
  `waitFor`/`click`.
- **`@UserflowPrecondition` references a class** — one `@UserStory` per class (already the rule).
- **Constraints**: one sequential test JVM (surefire default; **no parallel execution**); a chain's
  producer and dependents must be the **same kind** (all `*Test` or all `*IT` — surefire and failsafe
  are separate JVMs); running a dependent **alone** skips it (its precondition never ran). The class
  orderer is registered in `src/test/resources/junit-platform.properties`.

Reference chain: `CreateProjectIT` → `EditProjectIT` → `DeleteProjectIT` (project
lifecycle, sharing the created id). See `docs/epics/qits-userflows/features/2026-07-19_dependent-userflows.md`.

## Running stories

```bash
# The app stories here are extended ITs — start qits + seed first, then run them
# (they self-skip if nothing is on :8080):
./mvnw install -DskipTests
./mvnw -pl service -am quarkus:dev                       # serves the UI on :8080
./mvnw -pl cli quarkus:run -Dcli.args=seed-webapp
./mvnw -pl userflows verify -Pextended -Dqits.dev-guard.skip=true   # dev holds :8080

# The framework's own harness self-tests (no app) run in the framework module's default build:
./mvnw -pl qits-userflows test

# Point at a different app:
./mvnw -pl userflows verify -Pextended -Dqits.userflows.base-url=https://qits.example.eu
```

Reports land under `userflows/target/userstories/<slug>/`:

```
user-story.md          <- the human artifact (never gains frontmatter)
step-05-<label>.png    <- one per screenshot step, ordinal-prefixed
recording.webm         <- the full-run video (Playwright records webm natively)
userflow.json          <- the canonical structured output; every renderer consumes THIS
```

A story that fails mid-run still writes its report: the steps recorded so far, the failure as a
final step line, and `outcome: "failed"` in the sidecar — a failing story's report is a debugging
artifact.

## Golden pixels need the pinned renderer

Story media meant for **cross-branch comparison** must be produced inside the `docker/workspace`
image, which bakes a pinned Chromium (JS `playwright@1.61.0`, at
`PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright`) plus a pinned font stack. This module's
`playwright.version` is pinned to match; the Java driver honors `PLAYWRIGHT_BROWSERS_PATH`
automatically, finding the baked browser. Unpinned local runs are fine for **authoring**, but their
pixels are **not goldens** — bump `playwright.version` here and `ARG PLAYWRIGHT_VERSION` in
`docker/qits/Dockerfile` in lockstep.
