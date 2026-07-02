# Abandon Change

## User Story

As a developer, I want to abandon work that is no longer needed so that it doesn't clutter the system.

Abandoning removes the on-disk worktree and its branch, but not the record: the dialog asks for a markdown **result** explaining why the work ends, the worktree is resolved as `ABANDONED`, and it remains visible in the repository's history together with its preamble, timeline, and the commands that ran in it.

## Builds On

1. `worktree/propose-change`

## Processes

- `repositories-repoId-worktrees-worktreeId-discard` — abandon the worktree (with an optional result narrative)
