# Workspace daemons empty state references the removed global daemon library

## Introduction

Cosmetic stale-copy bug found while walking a fresh repo through the
[integration guide](../feature-ideas/quarkus-angular-integration-guide.md) (Tier 1). Related
plans: [daemons](../features/2026-07-04_daemons.md) — the global daemon scope this copy refers
to was removed there (`V19__drop_global_daemon_scope.sql`).

## Observed

A repository with no daemon definitions shows this empty state in the workspace Daemons panel:

> No daemons defined. Add one in the global library or for this repository.

There is no global daemon library: the global `DaemonConfiguration` scope, its
`/api/daemon-configurations` CRUD, and the `/daemon-configurations` library UI were all removed
with `V19` (see the daemons feature doc, "mistaken specification and was removed"). A user
following the copy looks for a navigation entry that doesn't exist.

## Repro

1. Create a project + repository with no daemons (e.g. register any fresh repo).
2. Open the repository's workspace page — the Daemons region shows the copy above.

## Suspected cause

Leftover template string from before the global scope was dropped:
`service/src/main/webui/src/app/pattern/daemon/workspace-daemons.component.ts:41`.

## Suggested fix

Reword to the repository-only reality, e.g. "No daemons defined for this repository." (or point
at the repository settings surface where daemons are created). One-line template change; no
backend involvement.
