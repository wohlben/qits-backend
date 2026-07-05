# Propose Change

## User Story

As a developer, I want to start work on a change in a repository by forking a new branch from a chosen parent branch, so that I can modify the codebase in isolation without disrupting the parent branch.

Each change gets its own branch — two changes never share a branch — so concurrent work cannot collide. This change may be part of a feature flow, initiated ad-hoc by a developer, or created by a coding agent.

When proposing the change, the developer also states its **intent**: the creation dialog takes a workspace ID, the new branch name, and a markdown **goal (preamble)** describing why the work exists and what "done" means. The preamble stays editable while the workspace is active, is shown wherever the workspace is worked on (e.g. the work-in-progress page), and becomes part of the permanent record once the workspace is resolved.

## Builds On

1. `repository/onboard-codebase`

## Processes

- `repositories-repoId-branches` — choose the parent branch
- `repositories-repoId-workspaces` — create the workspace (records a `created` event)
