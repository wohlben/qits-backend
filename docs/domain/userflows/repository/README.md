# Repository

A repository is a version-controlled codebase that serves as the technical substrate for change work. It enables the project, worktree, and feature-flow domains by providing the code that moves through a pipeline.

Repositories are always created within a project scope: onboarding clones the codebase from its remote URL into QITS-managed storage. From there QITS keeps a two-way relationship with the remote — the configured **main branch** can be pulled, pushed, or synced, and its ahead/behind status against the remote is always visible.

The center of the repository page is the **branch tree**: branches and their worktrees rendered as a forest, each branch nested under the parent it was forked from. From here users inspect commit history, see how far a change has drifted from its parent, and drive the whole worktree lifecycle (see the worktree domain).

Repositories on disk are the source of truth at startup: QITS auto-discovers repositories and worktrees found in its data directory and reconciles them with its database, using JSON metadata files kept alongside each repository.

## User Stories

- [Onboard Codebase](onboard-codebase.md)
- [Sync with Remote](sync-with-remote.md)
- [Inspect Commit History](inspect-commit-history.md)
- [Retire Codebase](retire-codebase.md)
