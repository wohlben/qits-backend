# Browse Worktree Files

## User Story

As a developer, I want to look inside an in-flight worktree — including edits a coding agent has made but not committed — so that I can inspect the change and point at specific code.

## Builds On

1. `worktree/propose-change`

## UI Flow

The worktree detail page is a two-pane file browser:

1. **Folder tree** (left) built from the worktree's tracked and new files (ignored files, build output, and VCS internals stay out). It can be narrowed with a fuzzy filename filter or an advanced filter dialog composing include/exclude rules (exact, fuzzy, includes, excludes) with a live match preview.
2. **Read-only code viewer** (right) with per-language syntax highlighting and line numbers, reading from the working tree so uncommitted agent edits are visible. Binary or oversized files are flagged instead of rendered.
3. **Code references**: selecting a line range collects it as a removable `path:line` chip and paints a persistent highlight. References are the staging ground for feeding selected code into a coding-agent prompt.

## Processes

- `repositories-repoId-worktrees-worktreeId-files` — list the worktree's files
- `repositories-repoId-worktrees-worktreeId-files-content` — read one file from the working tree
