# Inspect Commit History

## User Story

As a developer, I want to browse the commits of a branch and drill into any commit's changes so that I can understand what a change actually did before deciding to integrate, update, or abandon it.

Commit listings are scoped to what is *unique to the branch* — the commits it added on top of its parent — so reviewing a workspace branch shows exactly the work done there, not the whole repository history.

## Builds On

1. `repository/onboard-codebase`

## UI Flow

1. From a branch row in the repository's branch tree, the user opens **View commits**.
2. The commit list shows the branch's own commits; clicking one opens the commit detail.
3. The commit detail shows the changed files as a tree alongside a per-file unified diff.

## Processes

- `repositories-repoId-commits` — commit log for a branch
- `repositories-repoId-commits-commitHash-changes` — files changed by a commit
- `repositories-repoId-commits-commitHash-diff` — a single file's diff within a commit
