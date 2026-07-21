# Diverged remote reconciliation: auto-merge or park the remote tip on a merge branch

## Introduction

The repository detail route's **Pull / Sync / Push** all move the main branch between the local
mirror and the upstream remote, and before this feature every one of them simply **failed** the
moment both sides had new commits: the pull threw `Branch '<b>' has diverged from the remote;
manual merge required` (which also aborted a sync before its push), and a push died on git's
non-fast-forward rejection — with no way inside qits to actually perform that "manual merge".

Now all three verbs share one divergence policy, applied in the bare origin:

1. **Fast-forward when possible** (unchanged for pull; new for push, whose rejection handling now
   fast-forwards the *mirror* when the remote is strictly ahead — "nothing to push" instead of an
   error).
2. **Diverged but cleanly mergeable → a real merge commit** on the branch (local tip as first
   parent, remote tip as second), after which a sync/push lands it on the remote as an ordinary
   fast-forward.
3. **Diverged with conflicts → park the remote tip** on the branch
   `merge/<branch>-origin-<branch>` and fail with the conflicting files and the resolution path in
   the message. Re-running pull, sync, or push while the conflict persists **overwrites** the
   parked branch with the remote's *current* tip — there is never a second parking branch and
   never a stale one.

Related/dependent plans:

- **Process framing** — the verbs stream as technical processes:
  [repository-pull-technical-process](../../qits-technical-processes/features/2026-07-19_repository-pull-technical-process.md),
  [sync-as-technical-process](../../qits-technical-processes/features/2026-07-19_sync-as-technical-process.md),
  [push-as-technical-process](../../qits-technical-processes/features/2026-07-21_push-as-technical-process.md).
  The merge verdict / parking message lands in the segment stream; no frontend change was needed.
- **Merge machinery precedent** — `git merge-tree --write-tree` is the same no-working-tree probe
  the branch tree's conflict indicator and `ResolveConflictService.listConflictingFiles` use; the
  synthetic commit is attributed via
  [GitIdentity](../../qits-workspaces/epic.md) like every other commit qits manufactures.
- **Resolution path** — the parked branch shows up in the branch tree (a plain branch whose
  parent defaults to the main branch, diverged + conflicting), where the existing workspace
  machinery — including the
  [resolve-conflict flow](../../qits-coding-agents/epic.md) — can merge the main branch into it,
  resolve, and integrate back; the next sync then pushes fast-forward.
- **Remote auth** — the push-rejection fetch reuses
  [git-remote-https-auth](2026-07-21_git-remote-https-auth.md)'s credential-store wiring.

## As built

All in `RepositoryService` (`domain`, `repository.control`):

- **`mergeDivergedRemote(workdir, checkedOut, branch, localSha, remoteSha)`** — the shared policy
  core, entered only when neither sha is an ancestor of the other (the fetch has already brought
  the remote commits into the mirror's object store). Probes with
  `git merge-tree --write-tree --name-only`:
  - **exit 0 (clean)**: commits the written tree directly in the bare origin
    (`git commit-tree <tree> -p <local> -p <remote>` with `GitIdentity.inlineArgs()`, message
    `Merge remote '<branch>' into <branch>`) and advances the ref with `update-ref`; returns the
    verdict line (`Merged remote into '<branch>' (merge commit <sha>)`). The `checkedOut` seam
    (host main workspace, currently always false) runs a real `git merge` instead so ref, index
    and working tree move together.
  - **exit 1 (conflict)**: `update-ref refs/heads/merge/<branch>-origin-<branch> <remoteSha>` —
    create *or overwrite*, which is exactly the required "repeat attempts refresh the parked
    branch" semantics — then throws `BadRequestException` naming the conflicting files (parsed
    from the `--name-only` section) and the resolution path.
- **Pull** (`pullRepository`, also the pull half of sync): the diverged case calls the helper
  instead of throwing; on a clean merge the walk continues exactly like a fast-forward
  (`.qits-config.yml` re-ingested from the new tip, imported submodule children pulled, segment
  settles ok). The conflict throw reaches the process as before (`done failed`, message in
  stream); for a diverged submodule *child* it degrades to the WARNING-line path while the walk
  continues.
- **Push** (`pushRepository`): a failed push whose output matches git's remote-is-ahead rejection
  (`non-fast-forward` / `fetch first` — deliberately *not* `remote rejected`, so hook declines
  and auth failures surface unchanged) triggers `reconcileRejectedPush`: fetch the remote branch
  by URL, then remote-strictly-ahead → fast-forward the mirror's ref and return
  `… nothing to push`; diverged-clean → merge via the helper and retry the push once; conflict →
  the helper's parking throw. If the fetched tip turns out to be already contained locally (a
  racing pull), the original rejection is rethrown untouched.

Tests: `RepositoryPullProcessTest` (clean divergence auto-merges with correct parent order +
config re-ingest; conflicting divergence parks the tip, leaves the branch untouched, and a retry
after further remote commits overwrites the parked branch), `RepositorySyncProcessTest` (clean
divergence merges then pushes the merge commit; conflict fails before the push segment opens),
`RepositoryPushProcessTest` (behind-remote push fast-forwards the mirror; diverged push merges
and pushes; conflicting push parks and fails). All host-side against bare origins — no docker.
