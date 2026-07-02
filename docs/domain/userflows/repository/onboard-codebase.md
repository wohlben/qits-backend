# Onboard Codebase

## User Story

As a lead developer, I want to bring an existing codebase into QITS under a project so that my team can isolate changes in worktrees, run standardized actions against it, and apply the project's shared feature flows to it.

Onboarding clones the repository from its remote URL into QITS-managed storage and records it under the project. QITS also persists repository and worktree metadata as JSON files next to the clone, and re-discovers repositories found on disk at startup — so the filesystem, not only the database, carries the onboarded state.

## Processes

- `projects-projectId-repositories` — clone a repository under a project
