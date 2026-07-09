# Host-side merges rely on ambient git identity — seed/tests fail where ~/.gitconfig is absent

## Introduction

Related plans:

- [workspace-containers](../features/2026-07-04_workspace-containers.md) — the container-side git
  verbs already solved this correctly (identity supplied inline / configured at provisioning).
- The `seed` command ([project-domain](../features/2026-05-01_project-domain.md) era) — the
  affected caller: it manufactures the diverged branch tree via host-side merges.

## Observed

`SeedServiceTest.seedsFastForwardableAndDivergedWorkspaces` (cli module) fails in a container
without a git identity:

```
InternalServerErrorException: Git merge failed: Command failed [128]: git merge feeder -m Merge feeder into mainline
Committer identity unknown
fatal: unable to auto-detect email address (got 'dev@cba3b934205e.(none)')
```

The same test passes when `~/.gitconfig` exists — which it usually does in the devcontainer
because VS Code copies the host's gitconfig in on attach. So the failure is intermittent across
environments (fresh containers, CI, `devcontainer up` without VS Code), not flaky in itself.

## Suspected cause

`WorkspaceService.mergeIntoTarget` (WorkspaceService.java:906-913) shells `git merge` in a host
worktree without supplying an identity, so commit creation depends on ambient `user.email`. The
sibling container-side merge path (WorkspaceService.java:1026-1030) already passes
`-c user.email=qits@local -c user.name=qits` inline, and container provisioning sets
`git config user.email qits@local` in the clone (WorkspaceService.java:120) — the host-side merge
is the one gap.

## Suggested fix

Pass the same inline identity in `mergeIntoTarget`'s `git merge` invocation
(`git -c user.email=qits@local -c user.name=qits merge …`), mirroring line 1026-1030. Synthetic
qits merges shouldn't impersonate the developer's identity anyway. Add a regression note to
`SeedServiceTest` (it already covers the path; it just needs an identity-less environment to
bite).
