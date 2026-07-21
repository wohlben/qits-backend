# SeedServiceTest fails when ambient GIT_AUTHOR_*/GIT_COMMITTER_* env vars are set

## Introduction

Test-robustness bug observed while running the `cli` suite in a devcontainer whose environment
exports a git identity (`GIT_AUTHOR_NAME=qits-bot`, `GIT_AUTHOR_EMAIL=qits-bot@example.com`,
`GIT_COMMITTER_*` likewise). Related: `GitIdentity`
(`domain/src/main/java/eu/wohlben/qits/domain/repository/control/GitIdentity.java`) and the cli
`seed` command (`cli/src/main/java/eu/wohlben/qits/cli/SeedService.java`).

## Observed

`./mvnw -pl cli test` fails in such an environment:

```
SeedServiceTest.seedsFastForwardableAndDivergedWorkspaces
  the seeded merge commit carries the configured (default) qits identity ==>
  expected: <Merge feeder into mainline|qits <qits@local>|qits <qits@local>>
  but was:  <Merge feeder into mainline|qits-bot <qits-bot@example.com>|qits-bot <qits-bot@example.com>>
```

Re-running with the four env vars unset (`env -u GIT_AUTHOR_NAME -u GIT_AUTHOR_EMAIL
-u GIT_COMMITTER_NAME -u GIT_COMMITTER_EMAIL ./mvnw -pl cli test`) passes, confirming the cause is
the ambient environment, not the code under test.

## Suspected cause

The seed's host-side merges (`SeedService` → `WorkspaceService.mergeWorkspace`) pin the identity
via `GitIdentity.inlineArgs()` — `git -c user.name=qits -c user.email=qits@local …`. But git's
precedence gives the `GIT_AUTHOR_*`/`GIT_COMMITTER_*` **environment variables** priority over
`user.*` config, including `-c`-supplied config. So in any shell that exports these vars (CI
images, this devcontainer), the configured qits identity silently loses and the test's assertion on
the merge author/committer fails.

## Suggested fix direction

Make the host-side commit path immune to ambient env instead of relying on `-c`: pass
`GitIdentity.envMap()` into the `ProcessBuilder` environment for commit/merge invocations (env
set explicitly on the child beats inherited env), or strip the four `GIT_*` vars from the child
environment when applying `inlineArgs()`. A narrower alternative is to sanitize the env in the
test, but the production path has the same leak: a host with `GIT_AUTHOR_*` exported would
attribute qits' synthetic commits to that identity.
