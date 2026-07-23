# Epic: qits-project-repository-submodules — submodules as sibling repositories

## Introduction

The **submodule domain**: when qits imports a git repository that has **submodules**,
recursively import each submodule as a **sibling `Repository` under the same `Project`**
(deduplicated, cycle-safe), and materialize it **offline** inside a workspace container by
fetching it from qits' own git host. Net-new product behaviour that applies to every repo qits
imports.

Sits alongside [qits-project-repositories](../qits-project-repositories/epic.md) — it **builds
on** the Repository entity (a submodule becomes another `Repository` row) but is carved out
because submodule import (the sibling graph, the offline materialization, the level-by-level
import UX) is its own body of work.

**Links to [qits-technical-processes](../qits-technical-processes/epic.md)** for the **"train"
pulls**: pulling a superproject recursively pulls every imported submodule sibling, one segment
per repo — that recursive walk over the submodule-sibling graph is where this domain meets the
technical-process framing, and it lives there
([repository-pull-technical-process](../qits-technical-processes/features/2026-07-19_repository-pull-technical-process.md)).

Retroactive umbrella epic; future submodule work lands here.

**Scope rule** — this epic owns **submodule import and materialization**: the recursive
sibling-`Repository` creation, dedup/cycle handling, level-by-level import UX, and the
offline materialization of the imported edge closure in workspace containers. It does not own
the plain Repository entity ([qits-project-repositories](../qits-project-repositories/epic.md)),
the workspace container it materializes into
([qits-workspaces](../qits-workspaces/epic.md)), or the
pull/sync process that walks the graph ([qits-technical-processes](../qits-technical-processes/epic.md)).

## Parts (implemented)

- **[workspace-submodule-support](features/2026-07-14_workspace-submodule-support.md)** — the
  foundation: recursive import of submodules as sibling repositories (diamond-deduped,
  cycle-safe), materialized offline in workspace containers, imported user-driven layer by
  layer.

## Parts (planned)

- **[project-scoped-name-addressed-git-serving](feature-ideas/project-scoped-name-addressed-git-serving.md)**
  — serve a project's repositories as siblings under `/git/<projectId>/<name>` (names as a
  repository **link table**, not a column), so committed relative submodule urls resolve
  **natively** and provisioning becomes a plain clone + a bounded walk over the imported edge
  closure (native for relative urls, name-addressed override only for absolute). Replaces the
  per-level id-addressed `submodule.<name>.url` override, supersedes the
  layer-by-layer partial import with
  **full-closure recursive** import, and unblocks the workspace-daemon self-clone track (zero
  name→id hand-off). Prerequisite of
  [`docs/implementation-plan.md`](../../implementation-plan.md) Part 1.

## Done when

Rolling: current when its `feature-ideas/` is empty and every submodule feature since this
epic's creation has landed here.

## Status

| Part | Status |
|---|---|
| [workspace-submodule-support](features/2026-07-14_workspace-submodule-support.md) | implemented |
| [project-scoped-name-addressed-git-serving](feature-ideas/project-scoped-name-addressed-git-serving.md) | planned (2026-07-23) |
