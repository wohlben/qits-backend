# Integrate Change

## User Story

As a developer, I want to integrate my completed changes into a target branch — chosen from the repository's existing branches — so that the work becomes part of the codebase.

Integration closes the unit of work: the Integrate dialog asks for a markdown **result** describing the outcome, the merge is recorded on the worktree's timeline, and the worktree is resolved as `INTEGRATED`. Once a branch's work is fully contained in its parent, the branch tree offers a one-click **Cleanup** that removes the branch (and resolves its worktree) while keeping the historical record.

## Builds On

1. `worktree/propose-change`

## Processes

- `repositories-repoId-branches` — choose the integration target
- `repositories-repoId-worktrees-worktreeId-merge` — merge the worktree's branch into the target
- `repositories-repoId-branches-merge` — merge a plain branch into a target
- `repositories-repoId-branches-cleanup` — clean up a fully-integrated branch
