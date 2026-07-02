# Review Changes

## User Story

As a developer, I want to see the changes currently in flight in a repository so that I can decide which to integrate, update, or abandon.

## UI Flow

The repository detail page renders the **branch tree**: all branches as a forest, each nested under the parent it was forked from, with worktree-backed branches marked. Per branch/worktree the tree surfaces:

1. **Drift from the parent** — an ahead/behind connector. Opening it shows the actual commits: incoming (what the parent has that the change lacks) and outgoing (what the change adds). From there the user can fast-forward, merge the parent in, or start integration (see the sibling stories).
2. **Conflict marker** — shown when the change has diverged from its parent in a way that would conflict; it opens the conflict-resolution flow.
3. **Cleanup eligibility** — branches whose work is fully contained in their parent are flagged for one-click cleanup.
4. Entry points into the change itself: view its commits, browse its files, run an action in it, or hand it to a coding agent.

## Builds On

1. `repository/onboard-codebase`

## Processes

- `repositories-repoId-branches` — the branch forest with status flags
- `repositories-repoId-worktrees` — the in-flight worktrees
- `repositories-repoId-worktrees-worktreeId-incoming-commits` — commits the parent has that the change lacks
- `repositories-repoId-commits` — commits the change adds over its parent
