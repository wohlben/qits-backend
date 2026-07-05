# Abandon Change

## User Story

As a developer, I want to abandon work that is no longer needed so that it doesn't clutter the system.

Abandoning removes the on-disk workspace and its branch, but not the record: the dialog asks for a markdown **result** explaining why the work ends, the workspace is resolved as `ABANDONED`, and it remains visible in the repository's history together with its preamble, timeline, and the commands that ran in it.

## Builds On

1. `workspace/propose-change`

## Processes

- `repositories-repoId-workspaces-workspaceId-discard` — abandon the workspace (with an optional result narrative)
