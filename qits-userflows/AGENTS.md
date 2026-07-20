# qits-userflows/

The **userflows framework** — everything that runs a user story except the stories themselves. A
plain library jar (package root `eu.wohlben.qits.userflows`) on the `userflows` module's test
classpath. It depends on **none** of the app modules; it drives qits by URL only.

## What lives here

- **Annotations**: `@UserStory`, `@UserStoryDescription`, `@ExpectedFailure`, `@UserflowPrecondition`,
  `@UserflowRunsAfter`.
- **`Flow`** — the step-recording facade over Playwright's `Page` (every verb records a step).
- **`UserStoryExtension`** — the JUnit 5 extension: browser/video lifecycle, `Flow`/`UserflowContext`
  injection, outcome tracking, report emission, the passed-story registry, and the
  `ExecutionCondition` that skips a dependent whose precondition didn't pass.
- **`UserflowClassOrderer`** — topological class ordering over the precondition + runs-after graph.
- **`UserflowContext`** — the shared key→value store for dependency handoff.
- **`report/`** — the canonical `UserflowReport` model, the JSON + markdown renderers, and
  `ReportAssertions` / `Slugs` / `Hashing` / `UserflowPaths`.
- **Utilities**: `UserflowTarget` (base URL + reachability self-skip), `HarnessResources` (bundled
  test-page URLs), `Urls`.

## Rules

- **No product stories here.** Real qits user stories live in the sibling
  [`userflows`](../userflows/AGENTS.md) module, organized by domain (`…userflows.project`,
  `…userflows.projectrepository`, …). This module's `src/test` holds only the framework's own
  **self-test harness stories** — `*Test` classes under `…userflows.harness` that drive a bundled
  static page (no running qits) to cover step recording, the failure path, and the
  ordering/skip/runs-after dependency machinery on every default build.
- **This split is temporary.** It keeps the framework separate from the stories ahead of the epic's
  part 4, which extracts `qits-userflows` into a standalone repository so qits-managed projects can
  depend on it. Keep the framework free of any coupling to qits internals (URL-only), so the
  extraction stays a move, not a rewrite.
- Authoring conventions (how to write a story, the `Flow` API, dependent flows, running) are
  documented where the stories live — see [`userflows/AGENTS.md`](../userflows/AGENTS.md) and the
  `userflows` skill. The report contract lives in
  `docs/epics/qits-userflows/features/2026-07-19_qits-userflows.md`.
- Playwright is pinned (`playwright.version`) to the Chromium baked into `docker/qits/Dockerfile`;
  bump both in lockstep. Never needs `-Dqits.variant`.
