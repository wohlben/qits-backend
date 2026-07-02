# Resolve Merge Conflicts

## User Story

As a developer, I want conflicts between my change and its parent branch resolved without risking the change itself, so that divergence never blocks integration.

## Builds On

1. `worktree/propose-change`

## UI Flow

1. A diverged branch whose merge would conflict shows a **conflict marker** in the branch tree.
2. Opening it lists the conflicting files.
3. Choosing **Resolve** forks a *separate resolution worktree* off the conflicting branch and launches an autonomous coding agent in it. The agent merges the parent in and resolves the conflicts; the original worktree is left untouched.
4. The user is taken to the spawned agent's command view to watch (and later review) the resolution run.

## Processes

- `repositories-repoId-worktrees-worktreeId-conflicts` — list conflicting files
- `repositories-repoId-worktrees-worktreeId-resolve-conflict` — fork a resolution worktree and launch the autonomous agent (returns the command)
