# Epic: qits-userflows — branch-vs-parent golden user-flow diffing

## Introduction

This epic delivers one user-visible capability: **a workspace's CI tab showing, per user
story, how the workspace branch compares against its parent branch's goldens** —
NEW / CHANGED / REMOVED / unchanged verdicts, with the two branches' rendered story documents
side-by-side — **for qits itself and for qits-managed projects**. Getting there takes four
features (a Playwright user-story framework, a publisher, a diff UI, and the framework's
extraction into a reusable library); none of them is the deliverable alone, which is why they
are one epic.

**This epic builds on the [qits-artifacts epic](../qits-artifacts/epic.md)**: the blob
store is where goldens live between runs and across branches. Artifacts is the backbone
only — its store feature is a dependency of this epic's parts 2 and 3, not a part of this
epic. (Part 2 extends it with the `ci-userstories` repository type — a cross-epic
contribution using the type seam the store deliberately exposes.)

Related/dependent plans (outside the two epics):

- **Runs via** [actions](../qits-feature-flows/features/2026-05-01_actions.md) /
  [feature-flows](../qits-feature-flows/features/2026-05-01_feature-flows.md): the userflows suite + renderer
  execute as a workspace action, on the parent branch once and on the workspace branch per
  change.
- **Comparable pixels need a pinned renderer** —
  [screenshot-baseline-renderer-baked-into-image](../qits-build-setup/features/2026-07-13_screenshot-baseline-renderer-baked-into-image.md).
- **Automates the territory of** `docs/manual-acceptance-tests/` — a user story is the
  automated sibling of a plan.md's scripted walk.
- **UI landing zone** — the workspace-detail tab conventions
  ([tab consolidation](../qits-workspace-detail/features/2026-07-09_workspace-detail-tab-consolidation.md),
  [tab-url deep links](../qits-workspace-detail/features/2026-07-10_workspace-tab-url-and-picked-file-deep-link.md)).

## Parts, in implementation order

1. **[qits-userflows](features/2026-07-19_qits-userflows.md)** — the `userflows/` module: programmatic
   user stories that render themselves into local markdown + media reports with a canonical
   `userflow.json`. **No dependency on artifacts** — it can be built before or in parallel
   with the artifacts epic (its report contract is *shaped* for the future upload, but
   nothing more).
2. **[qits-userflows-artifacts-renderer](feature-ideas/qits-userflows-artifacts-renderer.md)**
   — the publishing renderer: uploads a story's media, re-renders the story markdown against
   the uploaded blob URLs, stores the document in the new `ci-userstories` type. **Requires
   part 1 and the artifacts epic's store.**
3. **[qits-artifacts-workspace-userflow-diff-tab](feature-ideas/qits-artifacts-workspace-userflow-diff-tab.md)**
   — the CI tab: backend-driven evaluation over `ci-userstories` on parent vs. workspace
   branch, side-by-side story documents in the UI. **Requires part 2** (it consumes exactly
   what the renderer publishes).
4. **[qits-java-testing-integration-library](feature-ideas/qits-java-testing-integration-library.md)**
   — extract the framework (everything except the stories, renderer included) into the
   standalone `wohlben/qits-java-testing-integration` repository, so qits-managed projects can
   write their own stories and join the golden loop. **Requires parts 1 and 2** (it moves
   their code); independent of part 3. **Prerequisite: creating the new repository.**

```
[qits-artifacts epic] ──┐
                          ├──► 2. renderer ──┬──► 3. diff tab
1. qits-userflows ────────┘                  └──► 4. library extraction
```

## Done when

All four parts are implemented: the chain closes end-to-end (running the userflows action on
a parent branch and a workspace branch leaves goldens in artifacts, and the workspace's CI
tab shows honest verdicts with side-by-side documents whose media render — the diff tab's
manual acceptance walk is the epic's acceptance walk), and the framework lives in its own
library with qits' `userflows` module reduced to stories-only, so a managed project can join
the loop by adding a dependency.

## Status

| Part | Status |
|---|---|
| [qits-userflows](features/2026-07-19_qits-userflows.md) | implemented 2026-07-19 |
| [qits-userflows-artifacts-renderer](feature-ideas/qits-userflows-artifacts-renderer.md) | idea |
| [qits-artifacts-workspace-userflow-diff-tab](feature-ideas/qits-artifacts-workspace-userflow-diff-tab.md) | idea |
| [qits-java-testing-integration-library](feature-ideas/qits-java-testing-integration-library.md) | idea |
