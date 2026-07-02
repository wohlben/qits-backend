# Configure with Claude

## User Story

As a developer, I want to hand a scoped task to a coding agent from wherever I am — a project, a repository, or a branch — so that configuration and change work can be delegated instead of done by hand.

## Builds On

1. `worktree/propose-change`

## UI Flow

Three "Configure … with Claude" entry points launch an agent chat, differing only in scope:

1. **Project detail** → *Configure project with Claude*: project scope — the agent can work across all of the project's repositories.
2. **Repository detail** → *Configure actions with Claude*: actions scope — the agent manages the repository's runnable actions.
3. **Branch/worktree row** → *Configure with Claude*: repository scope — the agent works this repository's branches, worktrees, and commits.

Each launch spawns a chat command in the target worktree (optionally seeded with an initial context as the first user turn) and navigates to its conversation view.

## Processes

- `repositories-repoId-worktrees-worktreeId-agents` — launch a scoped agent chat (returns the command)
