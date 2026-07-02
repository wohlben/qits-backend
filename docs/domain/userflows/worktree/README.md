# Worktree

A worktree is the technical mechanism QITS uses to isolate changes in a version-controlled codebase. From a user perspective, this domain is about the **change lifecycle**: proposing work, keeping it current with its parent, reviewing what is in flight, integrating it when complete, and abandoning it when no longer needed.

A worktree is more than a checkout — it is the **durable record of a unit of work**:

- It carries a markdown **preamble** (the reason and goal, authored at creation) and a markdown **result** (the outcome, authored at integration or abandonment).
- It has a **status**: `ACTIVE` while in flight, then `INTEGRATED` or `ABANDONED` once resolved.
- Every lifecycle transition (created, merged, updated from parent, integrated, abandoned) is recorded as a timestamped **event** on its timeline.
- Every **command** and coding-agent session that ran inside it stays associated with it.

Resolving a worktree removes the on-disk checkout and its branch, but never the record: resolved worktrees remain browsable as the repository's **history** of everything that flowed through it.

Worktrees are created when a developer (or a coding agent) starts a change — driven by a feature flow, initiated ad-hoc, or forked automatically (e.g. for conflict resolution). Its files are directly browsable in the UI, including uncommitted edits made by agents.

## User Stories

- [Propose Change](propose-change.md)
- [Review Changes](review-changes.md)
- [Stay Current with Parent](stay-current-with-parent.md)
- [Resolve Merge Conflicts](resolve-merge-conflicts.md)
- [Integrate Change](integrate-change.md)
- [Abandon Change](abandon-change.md)
- [Browse Worktree Files](browse-worktree-files.md)
- [Recall Past Work](recall-past-work.md)
