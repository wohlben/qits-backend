# Sync with Remote

## User Story

As a developer, I want to keep an onboarded repository in step with its remote so that work in QITS is based on the latest upstream state and finished work flows back out.

## Builds On

1. `repository/onboard-codebase`

## UI Flow

The repository detail page shows a **sync bar** for the repository's configured **main branch**:

1. The bar continuously shows the ahead/behind status against the remote.
2. **Pull** fetches and integrates remote changes; **Push** publishes local commits; **Sync** does both.
3. The user can change which branch is considered the main branch; sync operations follow that choice.

## Processes

- `repositories-repoId-sync-status` — ahead/behind status against the remote
- `repositories-repoId-pull` — pull remote changes
- `repositories-repoId-push` — push local commits
- `repositories-repoId-sync` — pull and push in one step
- `repositories-repoId-main-branch` — choose the synced main branch
