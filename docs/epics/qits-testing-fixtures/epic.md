# Epic: qits-testing-fixtures — the git test fixtures

## Introduction

The **test-fixture domain**: the git repositories qits' tests and seeds run against — chiefly
the **servable `testing-repo-quarkus-angular`** (a minimal but real Quarkus 3 + Angular app,
shaped like qits itself, for demoing features that run real work in a workspace) and the
submodule-composed fixture family, plus the history/packaging work that keeps them fetchable
offline.

**Cross-cutting test-infrastructure epic**, not part of the projects → repositories →
workspaces aggregate chain. The fixtures are the **reference consumers** of the integration
epics: the quarkus-angular fixture consumes
[qits-integration-angular](../qits-integration-angular/epic.md) (`@qits/angular`) and fulfils
the [qits-integration-quarkus](../qits-integration-quarkus/epic.md) contract, and it is the
seed-webapp demo target the `/verify` skill relies on.

**Scope rule** — this epic owns the **fixture repositories**: their content, their split into
standalone `wohlben/qits-fixture-*` repos, submodule composition, and the history purge that
made them clean. It does **not** own:

- The **visual-baseline renderer** baked into `docker/workspace` — the build/test-tooling
  image, not a fixture; it lives in [qits-build-setup](../qits-build-setup/epic.md).
- **Workspace submodule support** as a product feature —
  [qits-project-repository-submodules](../qits-project-repository-submodules/epic.md) (the
  fixtures merely *exercise* it).
- The tiny committed `submodule-*.git` and `testing-repo` bares documented alongside the code in
  the root `CLAUDE.md`'s Test-fixtures section (this epic is the *feature history*; that is the
  current-state reference).

## Parts (implemented)

- **[servable-quarkus-angular-fixture](features/2026-07-05_servable-quarkus-angular-fixture.md)**
  (07-05) — the foundation: a minimal but **servable** Quarkus 3 + Angular fixture
  (`testing-repo-quarkus-angular`) for demoing dev-server daemons, actions, and the coding agent
  against real work.
- **[quarkus-angular-fixture-full-integration](features/2026-07-05_quarkus-angular-fixture-full-integration.md)**
  (07-05) — wire that fixture up to *every* qits feature so it exercises the full surface.
- **[fixture-repos-split-and-submodules](features/2026-07-14_fixture-repos-split-and-submodules.md)**
  (07-14) — split the fixtures into standalone `qits-fixture-*` repos, extract the Angular SPA,
  compose via (nested) submodules.
- **[fixture-repos-history-purge](features/2026-07-14_fixture-repos-history-purge.md)** (07-14)
  — purge the nested bare repos from history so the submodule-composed fixtures stay clean and
  offline-fetchable.

## Done when

Rolling: current when its `feature-ideas/` is empty and every fixture feature since this epic's
creation has landed here.

## Status

| Part | Status |
|---|---|
| [servable-quarkus-angular-fixture](features/2026-07-05_servable-quarkus-angular-fixture.md) | implemented |
| [quarkus-angular-fixture-full-integration](features/2026-07-05_quarkus-angular-fixture-full-integration.md) | implemented |
| [fixture-repos-split-and-submodules](features/2026-07-14_fixture-repos-split-and-submodules.md) | implemented |
| [fixture-repos-history-purge](features/2026-07-14_fixture-repos-history-purge.md) | implemented |
