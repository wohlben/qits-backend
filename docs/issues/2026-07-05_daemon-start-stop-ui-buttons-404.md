# Daemon Start/Stop UI buttons 404 — scrambled path params

## Introduction

Discovered while doing the end-to-end UI verification of
[tmux-backed daemons Increment 2](../features/2026-07-05_tmux-backed-daemons.md) (the interactive
terminal). Unrelated to that feature — this is a pre-existing defect in the daemon **Start/Stop**
control buttons. Related: [daemons](../features/2026-07-04_daemons.md).

## Symptom

Clicking **Start** or **Stop** on a daemon in the worktree daemons panel does nothing — the status
never changes. No error is surfaced (the mutation's `onSettled` just re-invalidates the list). The
network tab shows the POST returning **404**.

## Observed repro

With a live daemon (repo `3fe5ccd1…`, worktree `greeting`, daemon `39d2cfec…`), clicking Stop fires:

```
POST /api/repositories/greeting/worktrees/39d2cfec-…(daemonId)/daemons/3fe5ccd1-…(repoId)/stop  → 404
```

The three path segments are rotated: `repoId` slot holds the worktreeId, `worktreeId` slot holds the
daemonId, `daemonId` slot holds the repoId.

## Cause

The generated typescript-angular client orders path params **alphabetically**, not in path order:

```ts
// service/src/main/webui/src/app/api/api/worktreeDaemonController.service.ts
apiRepositoriesRepoIdWorktreesWorktreeIdDaemonsDaemonIdStartPost(daemonId, repoId, worktreeId, …)
apiRepositoriesRepoIdWorktreesWorktreeIdDaemonsDaemonIdStopPost(daemonId, repoId, worktreeId, …)
```

But both call sites in `service/src/main/webui/src/app/pattern/daemon/worktree-daemons.component.ts`
(`startMutation` ~L227, `stopMutation` ~L239) pass them **positionally in path order**
`(this.repoId(), this.worktreeId(), daemonId)`, so the values land in the wrong slots and the URL
404s. The sibling `…DaemonsGet(repoId, worktreeId)` is unaffected because for those two params
alphabetical order already equals path order — the mismatch only bites when a param that sorts
earlier (`daemonId`) appears later in the path.

## Fix (applied)

Pass the arguments in the order the generated method declares them — `(daemonId, repoId,
worktreeId)` — at both call sites. Added a regression test
(`worktree-daemons.component.spec.ts`) asserting Start/Stop invoke the service with the correct
argument order.

> **Follow-up worth considering:** this is a latent footgun for every generated multi-path-param
> POST/PUT/DELETE (any op where alphabetical param order ≠ path order). A sturdier guard would be an
> openapi-generator option that preserves declared path order, or an ESLint rule against positional
> calls to the generated client. Parked; the two daemon call sites are the only ones bitten today.
</content>
