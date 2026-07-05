# Stay Current with Parent

## User Story

As a developer, I want to bring my in-flight change up to date with its parent branch so that integration later stays small and predictable.

## Builds On

1. `workspace/propose-change`

## UI Flow

From the branch tree's ahead/behind popover ("Behind" tab):

1. If the change has no commits of its own beyond the parent, **Fast-forward** advances it without a merge commit.
2. Otherwise, **Merge parent in** merges the parent branch into the workspace (recorded as an `updated-from-parent` event on the workspace's timeline).
3. If merging the parent would conflict, the merge is aborted and the conflict marker appears instead — continue with `workspace/resolve-merge-conflicts`.

## Processes

- `repositories-repoId-workspaces-workspaceId-fast-forward` — fast-forward the workspace onto its parent
- `repositories-repoId-workspaces-workspaceId-update-from-parent` — merge the parent into the workspace
- `repositories-repoId-workspaces-workspaceId-incoming-commits` — what the update would bring in
