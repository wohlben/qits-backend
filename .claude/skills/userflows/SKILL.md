---
name: userflows
description: Author and run qits "userflow" stories — programmatic Playwright walks through the qits UI that render themselves into markdown+media+JSON reports (target/userstories/). Use when adding, editing, or running a user story / systemtest in the `userflows/` module, or when working with its Flow facade, step ids, screenshots, or userflow.json report contract.
---

# Authoring & running qits userflows

The `userflows/` module drives the **qits application** through a real browser (Playwright-Java) and
renders each run into `target/userstories/<slug>/` (`user-story.md` + screenshots + `recording.webm`
+ canonical `userflow.json`). Full rules live in `userflows/CLAUDE.md`; this skill is the recipe.

## The one rule

Two modules: the **`qits-userflows`** module is the framework (annotations, `Flow`, the extension +
class orderer, report model/renderers, shared helpers); the **`userflows`** module is **stories
only** (`src/test`) — one `@UserStory` method per class, plus at most a lean `@AfterAll` companion
that *calls into* framework helpers. **If a story needs a helper, it goes in the `qits-userflows`
framework**, not in `userflows`. Never put plumbing among the stories. Both share the package root
`eu.wohlben.qits.userflows`; stories are organized in **domain sub-packages** (`.project`,
`.projectrepository`, `.workspace.webview`, …) — never a flat `.stories`. The framework's own
self-test harness stories live in `qits-userflows` under `.harness`.

Stories drive **qits itself**. A managed project's own app (e.g. the fixture greeting SPA) gets its
own stories in that project once epic part 4 extracts the framework into a library — not here.

## Add a story

App stories go in the **`userflows`** module, in a **domain package** (`…userflows.project`,
`…userflows.projectrepository`, `…userflows.workspace.webview`, …), named `<Action><Domain>IT` (no
`Flow` suffix), one `@UserStory` per class:
- `*IT` + `@Tag("extended")` — an **app story** driving a running qits. Runs under `-Pextended` and
  self-skips when the app is down. This is what you write in `userflows`.
- `*Test` — a no-app **harness story** (drives a bundled static page) that covers framework
  machinery. These are the framework's own self-tests and live in **`qits-userflows`** under
  `.harness`, not in `userflows`.

```java
@Tag("extended") // *IT only
class BrowseDemoProjectIT {

  @BeforeAll
  static void requireRunningQits() { // *IT only: self-skip when nothing answers
    assumeTrue(UserflowTarget.isReachable(),
        () -> "qits not reachable at " + UserflowTarget.baseUrl() + " (skipping)");
  }

  @UserStory("Browse the demo project")            // display name → slugged report dir
  @UserStoryDescription("""
      An operator opens the projects list, picks a project, and drills into
      its repository to see the branch tree.
      """)                                          // optional markdown, rendered verbatim
  void browseDemoProject(Flow flow) {              // Flow is injected; take it, nothing else
    flow.navigate("/projects");
    flow.waitFor("app-project-card");
    flow.screenshot("app-project-list", "projects list").as("projects-list");
    flow.click("a:has-text('Quarkus + Angular Demo')");
    flow.waitFor("h2:has-text('Branches')");
    flow.screenshot("app-branch-list", "branch tree").as("branch-tree");
  }
}
```

`@UserStory` is meta-annotated with `@Test` + the extension — **do not** add `@Test`/`@ExtendWith`
yourself. There is no `Playwright`/browser setup in a story; the extension owns it.

## The Flow API (drive the UI ONLY through this)

Every verb records a step; the facade *is* the step mechanism (Playwright-Java has no step API — the
JS `test.step()` does not exist here).

| Verb | Does | Step line |
|---|---|---|
| `navigate(urlOrPath)` | relative → base URL; absolute (incl. `file://`) passes through | `navigate <path>` |
| `navigate(template, args…)` | fill `{}` with args; **fingerprint keeps the template** (stable hash for dynamic ids) | `navigate <template>` |
| `waitFor(selector[, ms])` | wait for selector (optional short timeout) | `waitFor <selector>` |
| `expectAbsent(selector)` | wait until no element matches | `expectAbsent <selector>` |
| `click(selector)` | click first match | `click <selector>` |
| `fill(selector, value)` | type into field | `fill <selector> "<value>"` |
| `expectText(selector, text)` | assert element contains text | `expectText <selector> "<text>"` |
| `screenshot(selector, label)` | capture element into report | `screenshot <selector> "<label>"` |
| `screenshot(label)` | capture full page | `screenshot "<label>"` |
| `currentUrl()` | read the page URL (records nothing) — extract produced state | — |
| `page()` | **escape hatch** → raw `Page`, **records nothing** | — |

- **Never call the raw `Page`** except via `page()` for genuinely exotic actions — otherwise the
  report goes blind.
- Selectors: the qits UI has **no `data-testid`** — target by role (`[role="tab"]`), heading text
  (`h2:has-text('Branches')`), element name (`app-project-card`), button text, `aria-label`.

## Step ids and `.as(...)` — how screenshots couple to steps

Every step gets a string **id**: machine `step-00`, `step-01`, … by default, or an explicit author
id via **`.as("open-project")`** appended to the verb (`flow.click("…").as("open-project")`).

- A **screenshot links to its step by that id** (`"step": "projects-list"` in the sidecar), and for
  a screenshot step the id is the **PNG file-name prefix** (`projects-list-<label>.png`). The
  coupling is by name, never by position — so a mid-story screenshot renders under exactly its step
  and survives reordering.
- Prefer `.as(...)` on screenshot steps so media have stable, meaningful names (goldens depend on it).
- Ids must be unique per story and file-name-safe (`[A-Za-z0-9][A-Za-z0-9._-]*`); `.as()` throws
  otherwise. Ids are labels only — **not** part of the `definitionHash`, so renaming never changes
  the flow's fingerprint.

## Dependent flows — build on a previous story's state

Stories share one running qits, so a story can depend on state another produced instead of setting
up its own. Declare it on the `@UserStory` method and inject `UserflowContext`:

```java
@UserStory("Edit the project")
@UserflowPrecondition(CreateProjectIT.class)          // depends on that story CLASS
void editProject(Flow flow, UserflowContext context) {
  String id = context.require("project.id", String.class); // handed off by the producer
  flow.navigate("/projects/{}/edit", id);                  // templated → stable definitionHash
  …
}
```

- **Ordering + skip**: predecessors run first (topological `UserflowClassOrderer`); a dependent is
  **skipped before its browser launches** if a **precondition** didn't pass (failed / `@ExpectedFailure`
  / itself-skipped don't satisfy). Skip is **transitive**.
- **Two edge kinds**: `@UserflowPrecondition(X.class)` = after X **and** X must pass (else skip).
  `@UserflowRunsAfter(X.class)` = after X **only**, runs regardless of X's outcome — the cleanup
  edge. A delete flow pairs both: `@UserflowPrecondition(create)` + `@UserflowRunsAfter(edit)` →
  still cleans up if edit fails, skipped if create fails.
- **Handoff**: producer `context.put("project.id", Urls.lastPathSegment(flow.currentUrl()))`;
  dependents `context.require(...)`. Namespace keys by the producing flow. State lives in qits (fresh
  browser per story) — the context passes ids/URLs.
- **Dynamic ids**: `navigate("/projects/{}/edit", id)` keeps `{}` in the fingerprint (stable hash);
  keep constant selectors (not per-run names) elsewhere.
- **Constraints**: one sequential test JVM (surefire default; **no parallel**); a chain must be all
  `*Test` or all `*IT` (surefire/failsafe are separate JVMs); running a dependent **alone** skips it.
  The orderer is registered in `src/test/resources/junit-platform.properties`.

## Report contract (`target/userstories/<slug>/`)

`userflow.json` is canonical; the markdown is the *default renderer* over it (never parse the md):

```jsonc
{
  "story": "…", "slug": "…", "description": "…",
  "steps": [ { "id": "step-00", "line": "navigate /projects" }, … ],
  "definitionHash": "sha256:…",                 // over the value-free step lines
  "screenshots": [ { "path": "projects-list-projects-list.png", "label": "projects list",
                     "step": "projects-list", "width": …, "height": …, "contentHash": "sha256:…" } ],
  "video": { "path": "recording.webm", "width": 1280, "height": 720 },
  "outcome": "passed" | "failed"
}
```

A story that **fails mid-run still reports**: partial step log + an appended `FAILED: …` step +
`outcome: "failed"`. For a *deliberate* failure test, annotate the story `@ExpectedFailure` — the
extension records the failure, then swallows it (and fails if the story unexpectedly passed).

Assert a report from an `@AfterAll` companion using framework helpers:
`ReportAssertions.assertComplete(slug, PASSED)`, `.assertStepId(slug, id)`,
`.assertFailedWithPartialLog(slug)`, `.assertMarkdownContains(slug, …)`.

## Run

```bash
# Framework self-test harness stories (no app) — default build of the framework module:
./mvnw -pl qits-userflows test

# App stories (extended). Start qits + seed first, then run the ITs (self-skip if :8080 is down):
./mvnw install -DskipTests
./mvnw -pl service -am quarkus:dev                       # UI on :8080
./mvnw -pl cli quarkus:run -Dcli.args=seed-webapp        # idempotent-by-reset fixture
./mvnw -pl userflows verify -Pextended -Dqits.dev-guard.skip=true   # dev holds :8080

# Point at another app:
./mvnw -pl userflows verify -Pextended -Dqits.userflows.base-url=https://qits.example.eu
```

`-pl userflows` never needs `-Dqits.variant`.

## Golden pixels need the pinned renderer

Media meant for **cross-branch diffing** must be produced inside the `docker/workspace` image (baked
Chromium `playwright@1.61.0` at `PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright` + pinned fonts). The
module's `playwright.version` matches it; the Java driver finds the baked browser automatically
(the extension skips its download step when a browser is already installed). **Unpinned local runs
are fine for authoring but their pixels are not goldens.** Bump `playwright.version` (userflows/pom.xml)
and `ARG PLAYWRIGHT_VERSION` (docker/qits/Dockerfile) in lockstep.
