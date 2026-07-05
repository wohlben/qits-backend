# Recall Past Work

## User Story

As a developer, I want to browse everything that ever flowed through a repository — including finished and abandoned work — so that the reasoning behind past changes is never lost.

Because workspaces are resolved rather than deleted, each one remains a durable unit-of-work record: why it existed (preamble), how it ended (result), what happened along the way (event timeline), and what ran inside it (commands and agent sessions).

## Builds On

1. `workspace/propose-change`

## UI Flow

1. From the repository detail page, open **History**.
2. The history lists all workspaces — active and resolved — with status, parent, and created/resolved dates.
3. Opening one shows its preamble and result, the event timeline (created, merged, updated from parent, integrated, abandoned — each with branch/target/commit context and timestamp), and the commands that ran in it, each linking to its full audit log.
4. The narrative (preamble/result) can be amended after the fact.

## Processes

- `repositories-repoId-history` — list the repository's workspace history
- `repositories-repoId-history-id` — one workspace's full record (narrative, timeline, commands); also updates the narrative
