# Stay Current with Parent

## User Story

As a developer, I want to bring my in-flight change up to date with its parent branch so that integration later stays small and predictable.

## Builds On

1. `worktree/propose-change`

## UI Flow

From the branch tree's ahead/behind popover ("Behind" tab):

1. If the change has no commits of its own beyond the parent, **Fast-forward** advances it without a merge commit.
2. Otherwise, **Merge parent in** merges the parent branch into the worktree (recorded as an `updated-from-parent` event on the worktree's timeline).
3. If merging the parent would conflict, the merge is aborted and the conflict marker appears instead — continue with `worktree/resolve-merge-conflicts`.

## Processes

- `repositories-repoId-worktrees-worktreeId-fast-forward` — fast-forward the worktree onto its parent
- `repositories-repoId-worktrees-worktreeId-update-from-parent` — merge the parent into the worktree
- `repositories-repoId-worktrees-worktreeId-incoming-commits` — what the update would bring in
