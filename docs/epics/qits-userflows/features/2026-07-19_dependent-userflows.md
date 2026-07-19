# Dependent userflows: preconditions, ordering, and shared context

## Introduction

An enhancement to **part 1** ([qits-userflows](2026-07-19_qits-userflows.md)) of the
[qits-userflows epic](../epic.md). Userflow stories are e2e integration tests against **one shared
running qits**; giving each test its own isolated data (a fresh project/repo/workspace per case) is
wasteful setup. Instead a story can **depend on state a previous story produced** — a first-class
dependency mechanism, a shared theme across the suite.

Related: builds directly on the part-1 framework (`UserStoryExtension`, `Flow`, the report
contract). The reference chain drives the same qits admin UI the
[BrowseDemoProjectIT](2026-07-19_qits-userflows.md) example uses.

## The model

A story declares its dependencies on the `@UserStory` method:

```java
@UserStory("Edit the project")
@UserflowPrecondition(CreateProjectIT.class)   // depends on that story class
void editProject(Flow flow, UserflowContext context) {
  String id = context.require("project.id", String.class);   // handed off by the producer
  flow.navigate("/projects/{}/edit", id);                    // templated → stable definitionHash
  …
}
```

The framework then:

- **Orders** every predecessor class before its dependents — `UserflowClassOrderer`, a topological
  sort (stable by-name tiebreak; throws on a cycle), registered globally via each test module's
  `src/test/resources/junit-platform.properties`
  (`junit.jupiter.testclass.order.default=…UserflowClassOrderer`).
- **Skips** a dependent — *before a browser even launches* (an `ExecutionCondition` on
  `UserStoryExtension`) — if any **precondition** did not **pass**. A failed, `@ExpectedFailure`, or
  itself-skipped precondition does not satisfy; skip is **transitive**.
- **Hands off values** via an injected **`UserflowContext`** — a JVM-wide key→value store. Because
  each story runs in a fresh browser, produced state lives server-side in qits; the context carries
  *references* to it (a created id, a URL) that a producer discovers (e.g. `flow.currentUrl()`) and
  stashes with a namespaced key (`"project.id"`).

### Two edge kinds

| Annotation | Ordering | Gates execution? |
|---|---|---|
| `@UserflowPrecondition(X.class)` | this runs after X | **yes** — skip (transitively) if X didn't pass |
| `@UserflowRunsAfter(X.class)` | this runs after X | **no** — runs whether X passed, failed, or was skipped |

`@UserflowRunsAfter` is the **cleanup** edge: a delete flow should run after the flows that mutate a
thing, *regardless* of whether they succeeded, so a mid-chain failure doesn't strand state. It pairs
with a precondition for the state actually needed. The reference chain's delete uses both:

```java
@UserflowPrecondition(CreateProjectIT.class)   // needs the project — skip if create failed
@UserflowRunsAfter(EditProjectIT.class)       // run after edit, pass or fail
void deleteProject(Flow flow, UserflowContext context) { … }
```

So if edit fails, delete **still runs** and cleans up (verified end-to-end); if create fails,
delete is skipped (nothing to clean up).

### How it works

- `UserStoryExtension` gains a JVM-wide `PASSED_SLUGS` set (beside the existing `EMITTED_SLUGS`),
  populated in `afterEach` only when `outcome == PASSED`. The `ExecutionCondition` resolves each
  precondition class's story slug and checks the set.
- Both annotations reference story **classes** (one `@UserStory` per class — the module convention);
  the orderer builds edges from the **union** of precondition + runs-after references
  (`orderingPredecessorsOf`), while the `ExecutionCondition` gates on preconditions only.

### Hash stability for dynamic ids

Dependent flows navigate to server-generated ids, which would otherwise vary the `definitionHash`
per run. `Flow.navigate(template, args…)` fills `{}` placeholders for the real navigation and the
recorded step line, but keeps the **template** in the fingerprint — so
`navigate("/projects/{}/edit", id)` hashes identically across runs. (Other verbs already exclude
typed values from the fingerprint; keep constant selectors, not per-run values, in `waitFor`/`click`
so a flow's hash stays stable.)

## Constraints

- **Single sequential test JVM** — the registry + ordering assume surefire's default
  `reuseForks=true`/`forkCount=1` and **no parallel execution**.
- **Same-kind chains** — a producer and its dependents must be all `*Test` or all `*IT`; surefire
  and failsafe are separate runs (separate JVMs), so a passed slug doesn't cross between them.
- **Running a dependent alone** (`-Dtest=EditProjectIT`) skips it — its precondition never
  ran. Intended: "precondition absent → skip".

## Coverage

- **Harness chain** (`*Test`, no app, every default build): a producer stashes a value and a
  dependent reads it (proving ordering + handoff — the dependent's classes sort inversely to the
  dependency, so it only runs if the orderer put the producer first); a `@ExpectedFailure` producer
  with a dependent that is asserted (via `@AfterAll`) to have been **skipped** (proving
  skip-on-failed-precondition). These are the framework's self-tests — they live in the
  `qits-userflows` module (`.harness`) and run in `./mvnw -pl qits-userflows test`.
- **Reference chain** (`*IT`, `@Tag("extended")`, self-skipping): `CreateProjectIT` →
  `EditProjectIT` → `DeleteProjectIT` — a project lifecycle through qits' admin UI, sharing
  the created project's id through the context (no docker/git needed). Verified end-to-end against a
  live qits.

## Out of scope

- Normalizing dynamic ids in the golden-diff (part 3's concern); the sidecar keeps templated
  fingerprints, which is the stable input a future diff can rely on.
- Per-chain (vs JVM-wide) context scoping — keys are namespaced by convention for now.
