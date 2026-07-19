# userflows/

Programmatic **user stories** that end-to-end-test qits through a real browser (Playwright-Java)
and render themselves into local **reports**. A story is a named, described, step-recorded walk
through the UI; running one produces more than a green check — it writes a markdown document
interleaving the story's description, its recorded steps, and inline screenshots, plus a video of
the run and a canonical `userflow.json`, into `target/userstories/<slug>/`.

This module is the automated sibling of `docs/manual-acceptance-tests/` — a story is the executable
form of a plan.md's scripted walk. It is **part 1** of the
[qits-userflows epic](../docs/epics/qits-userflows/epic.md): the reports it produces are shaped to
become the by-branch golden screenshots/videos a future diff tab compares (the artifacts upload
itself is a follow-up part, out of scope here). It depends on **none** of the other qits modules —
it reaches the app by URL only, so a story can never cheat the user's perspective by touching
internals. `-pl userflows` builds never need `-Dqits.variant`.

## The absolute rule: `src/main` is the framework, `src/test` is stories only

- **`src/main`** (`eu.wohlben.qits.userflows`) holds the *framework* and nothing else: the
  annotations, the JUnit 5 extension, the `Flow` recording facade, the report model + renderers, and
  every shared utility (`ReportAssertions`, `HarnessResources`, `UserflowTarget`, …).
- **`src/test`** holds **user stories only** — one `@UserStory` method per story, plus a lean
  `@AfterAll` companion that only *calls into* `src/main` helpers. Nothing abstract, no plumbing, no
  reusable helper ever lands in `src/test`. **If a story needs a helper, it moves to `src/main`.**

This split is also the future repository boundary: part 4 of the epic extracts everything except the
stories into a standalone library, so qits-managed projects can author their own stories.

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

## Kinds of story

- **Harness stories** (`*Test`, run in every default build): drive a **static HTML page bundled as a
  test resource** via `HarnessResources.classpathUrl(...)`, so they need no running app and give the
  framework itself coverage. `GreetingHarnessTest` is the reference; `FailingHarnessTest`
  (`@ExpectedFailure`) proves the failure path stays green while reporting `outcome: "failed"`.
- **App stories** (`*IT`, `@Tag("extended")`): drive a running qits. They read the target from
  `qits.userflows.base-url` (default `http://localhost:8080`) and **self-skip** via
  `assumeTrue(UserflowTarget.isReachable())` when nothing answers — safe in every default build
  (mirrors `WorkspaceContainerIT`). Expected state is the idempotent `seed-webapp` fixture.

## Running stories

```bash
# Harness stories only (no app needed) — runs in every default build:
./mvnw -pl userflows test

# App stories too — start qits + seed first, then run the extended ITs:
./mvnw install -DskipTests
./mvnw -pl service -am quarkus:dev                       # serves the UI on :8080
./mvnw -pl cli quarkus:run -Dcli.args=seed-webapp
./mvnw -pl userflows verify -Pextended -Dqits.dev-guard.skip=true   # dev holds :8080

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
