# qits-userflows: programmatic user stories that render themselves into reports

## Introduction

A new **separate Maven module `userflows/`**, inspired by classic "systemtest" modules: it
end-to-end tests the application through a real browser (**Playwright** as a direct
dependency), but its tests are written as **programmatic user stories** — named, described,
step-recorded walks through the UI. Running a story produces more than a green checkmark: it
renders a **report** — a markdown document interleaving the story's description, its recorded
steps, inline screenshots, and a video of the run — into
`target/userstories/<user-story-display-name>/` (`user-story.md` + the media files).

The module has a deliberate **main/test split**: `src/main` holds the *framework* — the
`UserStory` model, the annotations, abstract test bases, the step-recording wrapper, the report
writer, all shared utilities; `src/test` holds **exclusively actual user stories**. Nothing
abstract, no helpers, no plumbing ever lands in `src/test` — if a story needs it, it moves to
`src/main`. **This convention must be written into the module's own `CLAUDE.md`/`AGENTS.md`**,
created in the same commit as the module, so every future contributor (human or agent) adding a
story inherits the rule without reading this plan.

The strategic goal is [qits-artifactory](qits-artifactory.md)'s golden-media loop: user stories
are the *producers* of the by-branch screenshots/videos the
[user-flow diff tab](qits-artifactory-workspace-userflow-diff-tab.md) compares. **The scope of this
feature is the creation of the report — not persisting anything into an artifactory
repository.** The report's on-disk layout is shaped so the future upload step is a plain walk
over `target/userstories/` (see the mapping section), but that uploader is a follow-up.

Related/dependent plans:

- **Produces for** [qits-artifactory](qits-artifactory.md): the report media are the future
  `ci-screenshots`/`ci-videos` uploads; the story name / step labels / definition hash map onto
  `qits.userflow.name` / `qits.display.name` / `qits.userflow.hash` (mapping below). Upload
  itself is out of scope here.
- **Feeds, eventually, the** [user-flow diff tab](qits-artifactory-workspace-userflow-diff-tab.md) —
  whose NEW/CHANGED/REMOVED verdicts are only as good as the `qits.diff.hash` discipline this
  module will one day stamp on its outputs.
- **Comparable pixels need a pinned renderer** —
  [screenshot-baseline-renderer-baked-into-image](../features/2026-07-13_screenshot-baseline-renderer-baked-into-image.md):
  the same lesson applies verbatim; story media meant for cross-branch diffing must come from
  the `docker/workspace` toolchain image (see Execution model).
- **Automates the territory of** `docs/manual-acceptance-tests/` — a user story is the
  automated sibling of a plan.md's scripted walk (imperative steps, each with an observable
  expectation); plans that a story fully covers can shrink to their packaged-deployment
  concerns. The `/verify` skill's seed-webapp + agent-browser loop is the interactive
  ancestor of the same idea.
- **Extended-suite conventions** — the repo's `-Pextended` / self-skip-when-backend-absent
  pattern (`WorkspaceContainerIT` precedent) is reused for stories that need a running qits.
- **Module split precedent** — [qits-artifactory](qits-artifactory.md)'s "own module, not in
  `domain`" reasoning applies: `userflows` touches no qits code at all; it drives the app the
  way a user does, through the browser.

## The module

- **`userflows/`**, a new top-level reactor module — plain jar, JDK 25, Spotless, build cache,
  never needs `-Dqits.variant` for module-scoped builds. Dependencies:
  `com.microsoft.playwright:playwright` (Java), JUnit 5. **No dependency on `domain`,
  `service`, or `artifactory`** — the app under test is reached by URL, and coupling to
  internals would let stories cheat the user's perspective.
- **`src/main`** (`eu.wohlben.qits.userflows`): the framework —
  - the annotations (`@UserStory`, `@UserStoryDescription`),
  - the JUnit 5 extension that orchestrates a story's lifecycle (browser/context setup with
    video recording, step recorder injection, report emission),
  - the step-recording facade over Playwright,
  - the report **model** (the canonical JSON below) and its **renderers** — markdown is just
    the default one,
  - abstract story bases and shared utilities (login helpers, seed-state navigation, common
    selectors) as they emerge.
- **`src/test`**: user stories only. One class (or method) per story.
- **`userflows/CLAUDE.md`** (required deliverable of this feature): states the main/test
  split rule above, the authoring conventions (annotations, step facade — never raw `Page`
  calls in a story, or the report goes blind), how to run stories, and where reports land.

## Authoring model

```java
@UserStory("Create a greeting")
@UserStoryDescription("""
    A visitor opens the greeting page, submits their name, and sees the
    greeting echoed back with a timestamp — the core loop of the demo app.
    """)
void createGreeting(Flow flow) {
  flow.navigate("/");
  flow.waitFor("input[name=name]");
  flow.fill("input[name=name]", "Ada");
  flow.click("button[type=submit]");
  flow.waitFor(".greeting-result");
  flow.screenshot(".greeting-result", "greeting result");
}
```

- **`@UserStory("name")`** — the story's display name; also the report directory name
  (slugged) and the future `qits.userflow.name`.
- **`@UserStoryDescription("""…""")`** — multiline **markdown**, rendered verbatim into the
  report's description section.
- **`Flow`** — the recording facade the extension injects. Its verbs map 1:1 onto Playwright
  operations (`navigate`, `waitFor`, `click`, `fill`, `expectText`, `screenshot`, …), and
  every call appends a step line to the story's step log. `screenshot(selector, label)`
  additionally captures the element (or `screenshot(label)` the full page) into the report
  directory and records the label — the future `qits.display.name`. Playwright's Java API has
  no built-in step notion (that's a JS-test-runner feature), so the facade *is* the step
  mechanism — which is also why stories must not bypass it: an escape hatch
  (`flow.page()`) exists for genuinely exotic interactions but leaves no step record and the
  CLAUDE.md says so.
- The **step log doubles as the flow's fingerprint**: hashing the recorded step lines
  (verbs + selectors + labels, no dynamic values) yields a deterministic definition hash —
  the natural future `qits.userflow.hash`, computed from what the story *does* rather than
  from source text. Emitted into the report metadata from day one (below) so the uploader
  never needs to re-derive it.

## Report contract

Per story, under `target/userstories/<user-story-display-name>/` (display name slugged the
usual kebab way):

```
user-story.md
step-05-greeting-result.png     (one per screenshot step, ordinal-prefixed)
recording.webm                  (the full-run video)
userflow.json                   (the canonical structured output — see below)
```

`userflow.json` is not a sidecar afterthought but the **canonical output of a story run** —
everything a renderer needs, with the markdown writer being merely the *default renderer*
consuming it:

```jsonc
{
  "story": "Create a greeting",
  "slug": "create-a-greeting",
  "description": "A visitor opens the greeting page, …",   // the annotation markdown, verbatim
  "steps": ["navigate /", "waitFor input[name=name]", "…"],
  "definitionHash": "sha256:…",                              // hash of the step lines
  "screenshots": [
    { "path": "step-05-greeting-result.png", "label": "greeting result",
      "width": 640, "height": 220, "contentHash": "sha256:…" }
  ],
  "video": { "path": "recording.webm", "durationSeconds": 12.4, "width": 1280, "height": 720 },
  "outcome": "passed"
}
```

`user-story.md` follows the sketched shape — description, steps, media inline:

```markdown
# Create a greeting

## User flow

A visitor opens the greeting page, submits their name, and sees the
greeting echoed back with a timestamp — the core loop of the demo app.

## Steps

    navigate /
    waitFor input[name=name]
    fill input[name=name] "Ada"
    click button[type=submit]
    waitFor .greeting-result
    screenshot .greeting-result "greeting result"

![greeting result](step-05-greeting-result.png)

## Video

[recording.webm](recording.webm)
```

- Screenshots are referenced inline right after the step block (or interleaved per step —
  see Open questions); relative links only, so the directory is portable as a bundle.
- **Video is `.webm`** — that is what Playwright records natively; the sketch's `.mp4` would
  cost a transcode step for no consumer that needs it (browsers and the artifactory
  `ci-videos` type accept webm). Markdown can't inline-play video, hence the link form.
- **Failure still reports**: a story that fails mid-run writes the report with the steps
  recorded so far, the failure appended as a final step line, and `outcome: "failed"` in the
  sidecar — a failing story's report is a debugging artifact, and the future uploader skips
  non-passing runs by reading the sidecar.
- `user-story.md` stays the human artifact and never gains frontmatter; further renderers
  (first: [qits-userflows-artifactory-renderer](qits-userflows-artifactory-renderer.md))
  consume `userflow.json`, never the markdown.

## Future artifactory mapping (documented now, wired later)

| Report piece | Artifactory metadata (future upload) |
|---|---|
| `@UserStory` name | `qits.userflow.name` |
| Screenshot step label | `qits.display.name` |
| Step-log hash (sidecar) | `qits.userflow.hash` |
| Screenshot content hash | `qits.diff.hash` (images) |
| Video | `qits.diff.hash` — the renderer plan adopts a provisional v1: a digest over the ordered screenshot content hashes + the definition hash |
| Media dimensions (sidecar) | `media.resolution.*` |

The upload leg is its own feature idea:
[qits-userflows-artifactory-renderer](qits-userflows-artifactory-renderer.md) — a second
renderer over `userflow.json` that uploads the media, re-renders the story markdown against the
uploaded blob URLs, and stores the story document itself in artifactory.

## Execution model

- Stories that drive qits are **`*IT` classes behind `-Pextended`**, exactly like
  `WorkspaceContainerIT`: they read the target from `qits.userflows.base-url` (default
  `http://localhost:8080`) and **self-skip** when nothing answers there — safe in every
  default build. Expected state: the `seed-webapp` fixture (idempotent by reset — the same
  known-good state the `/verify` skill relies on).
- One story runs as a plain surefire `*Test` with no app: a **harness smoke story** driving a
  static HTML page bundled as a test resource. It exists so the framework itself (step
  recording, screenshot capture, video, report + sidecar emission, failure path) has coverage
  on every normal `./mvnw -pl userflows test` — while still being written as a user story,
  keeping the src/test rule absolute.
- **Renderer pinning**: story media intended for cross-branch comparison must be produced
  inside the `docker/workspace` image (which already bakes a pinned Chromium + fonts for the
  webui's visual baselines). Playwright-Java resolves browsers via `PLAYWRIGHT_BROWSERS_PATH`;
  aligning its browser install with the baked one (or baking the Java driver's browsers in the
  same image layer) is an implementation task of this feature, not an afterthought — unpinned
  local runs are fine for authoring but their pixels are not goldens.

## Out of scope

- Uploading to artifactory (the follow-up above), and therefore everything branch-related —
  this module doesn't know or care what branch it runs on; that context belongs to the future
  uploader action.
- Any qits UI for browsing reports (`target/` artifacts are the deliverable; the diff tab
  consumes artifactory, not this module).
- Video diff-hash semantics (open in the artifactory plan; the sidecar just doesn't emit a
  video diff hash yet).
- Cross-browser matrices, mobile emulation, performance timing — stories are Chromium-only
  until a concrete need appears.

## Open questions

- **Steps block vs interleaved media**: the sketch shows one steps block with screenshots
  after; interleaving each screenshot directly beneath its step line reads better for long
  stories. Decide with the first real multi-screenshot story — the writer supports either
  with the same recorded data.
- **Method-injected `Flow` vs base-class field**: injection (JUnit parameter resolver) keeps
  stories free of inheritance; a base class gives shared helpers a natural home. Leaning
  injection + composition-style helpers in `src/main`.
- **Display-name collisions**: two stories slugging identically would overwrite each other's
  report dirs — fail fast at collection time rather than last-writer-wins.
- **Should the harness smoke story's report be asserted byte-exactly** (a golden of the
  golden-maker)? Probably structural assertions only; byte-golden would make every writer
  tweak a two-step change.

## Testing sketch

The module *is* tests; what needs testing is the framework, and per the src/test rule that
coverage itself takes story form:

- The **harness smoke story** (no app needed, runs in default builds): asserts afterwards —
  via a JUnit `@AfterAll` companion reading `target/userstories/` — that the report dir
  exists, `user-story.md` contains the description and every step line in order, ordinal
  screenshot files exist with plausible dimensions, `recording.webm` is non-empty, and the
  sidecar's step hash is stable across two runs of the same story.
- A **deliberately failing smoke story** (expected-failure harness) proving the failure path:
  partial step log, appended failure line, `outcome: "failed"`.
- One real qits story against seed-webapp (extended, self-skipping) as the reference
  implementation for authors — the "Create a greeting" walk above, doubling as E2E proof that
  the base-url/seed conventions hold.
- Reactor hygiene: default `./mvnw test` stays green with no qits running (self-skip), and
  `-pl userflows` builds need no variant flag.
