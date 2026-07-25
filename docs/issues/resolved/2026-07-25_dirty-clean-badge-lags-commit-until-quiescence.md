# Dirty/clean badge lags a commit — appears to fire only on push

## Introduction

Active bug in the workspace dirty/clean status pipeline. Related plans:

- **Concerns the watcher built in
  [daemon-driven working-tree status](../../epics/qits-workspace-daemon/features/2026-07-24_daemon-git-status-monitoring.md)**
  — the `GitStatusMonitor` `inotifywait` + `git status --porcelain=v2` loop.
- **Direct consequence of
  [`git status` monitor races a commit/push for `.git/index.lock`](2026-07-25_git-status-monitor-index-lock-contention.md)**
  — the 20 s trailing debounce introduced there to end `index.lock` contention is the root cause of
  this lag. Any fix here must not reintroduce that contention.
- Interacts with
  [daemon bidirectional auto-sync](../../epics/qits-workspace-daemon/features/2026-07-25_daemon-bidirectional-auto-sync.md)
  — but the daemon's own auto-`push` runs strictly *after* the settle that emits the clean flip, so
  it cannot defer the badge update; only a user-initiated push can (see Cause, point 3).

## Symptom (observed)

Committing inside a workspace container "does not necessarily trigger" the dirty→clean badge update;
the badge appears to flip clean only **after a push**, and even then it is delayed by many seconds.

## Cause (verified)

The badge is driven **entirely** by the in-container `workspace-daemon` — there is no host-side
polling. The chain is: `inotifywait` on `/workspace` → **trailing (resetting) debounce** →
`git status`/`git diff` → sha256 marker dedup → `GitStatus` frame over the control socket →
`WorkspaceDaemonRegistry.onGitStatus` → CDI `GIT_STATUS` hint (only on clean-flip) → SSE → badge.

Three interacting facts produce the symptom. All were reproduced with `inotifywait`/`git` locally:

1. **A commit IS observed.** `git commit` emits ~23 watched inotify events (`.git/index`,
   `.git/COMMIT_EDITMSG`, `.git/refs/heads/<branch>`, `.git/HEAD.lock`) — none excluded by
   `GitStatusMonitor.watchArgv()` (which only excludes `.git/objects`, `.git/logs`, and build dirs).
   So a commit reliably arms the debounce. The dirty→clean transition is therefore not *dropped* — it
   is *deferred*.

2. **The 20 s trailing debounce defers every report to 20 s after the tree (incl. `.git`) falls
   quiet.** `GitStatusMonitor.onRawChange` (`workspace-daemon/.../GitStatusMonitor.java:198`) cancels
   and re-arms a `qits.workspace-daemon.git-status.coalesce-ms` = **20000 ms** timer on *every* event,
   capped by `git-status.max-wait-ms` = **120000 ms**. `settle()` (`:250`) runs only after quiescence
   and emits a `GitStatus` only if the marker moved. So no clean report can land until the workspace
   has been *completely* idle for 20 s.

3. **A user-initiated push re-arms that same debounce — the daemon's auto-push cannot.** `git push`
   writes `.git/refs/remotes/origin/<branch>` (5 watched inotify events, reproduced), which is **not**
   excluded, so a push landing *inside* the 20 s window resets the timer even though a push never
   changes working-tree cleanliness. When the user commits and then keeps working (or pushes) within
   any 20 s gap, the single settle is pushed out until 20 s after the *last* git write. The first
   settle then observes an already-clean tree and, if the badge was dirty, flips it clean. The user
   sees the badge change ~20 s after the push and attributes the trigger to the push.

   The daemon's own auto-push is strictly **downstream** of that settle and cannot defer it:
   `ControlSocket.startGitStatusMonitor` (`workspace-daemon/.../ControlSocket.java:366`) wires the
   monitor's sink as `send(message)` *then* `sync.onWorkingTreeSettled()`, so `OriginSync` pushes only
   after the settle that already emitted the dirty→clean `GitStatus`. Its refs write does re-arm the
   debounce, but the follow-up settle is clean→clean — and `WorkspaceDaemonRegistry.onGitStatus`
   (`service/.../workspacedaemonhost/WorkspaceDaemonRegistry.java:267`) fires the `GIT_STATUS` badge
   hint **only when the `clean` boolean flips**, so that follow-up settle never touches the badge. A
   push-triggered settle thus never *itself* flips the badge; it only appears to because the deferred
   post-commit clean-flip lands in the same settle.

Net: the commit's clean state is correct and eventually reported, but the **20 s resetting debounce +
watching remote-tracking refs** means the report is deferred to 20 s after all pre-settle activity
(including any user push) ceases. In the pure auto-push flow (commit, then hands off) the lag is the
baseline ~20 s post-commit debounce alone. This is the tail cost of the `index.lock` contention fix.

Load-bearing code:

- `workspace-daemon/src/main/java/eu/wohlben/qits/workspacedaemon/GitStatusMonitor.java:198`
  (`onRawChange` resetting debounce), `:250` (`settle` marker dedup), `:295` (`watchArgv` excludes —
  remote refs stay watched).
- `workspace-daemon/src/main/java/eu/wohlben/qits/workspacedaemon/ControlSocket.java:124` /`:132`
  (`coalesce-ms` = 20 s, `max-wait-ms` = 120 s), `:366` (monitor sink: `send` before
  `sync.onWorkingTreeSettled()` — auto-push strictly after the emitted `GitStatus`).
- `service/src/main/java/eu/wohlben/qits/workspacedaemonhost/WorkspaceDaemonRegistry.java:267`
  (`onGitStatus` — `GIT_STATUS` gated on boolean flip).

## Suggested fix direction

Reduce the lag without reintroducing `index.lock` contention. Candidates, cheapest first:

1. **Exclude remote-tracking refs and fetch bookkeeping from the watch** (`.git/refs/remotes`,
   `.git/FETCH_HEAD`, `.git/ORIG_HEAD`). These never change working-tree cleanliness, so a push /
   auto-push / fetch would no longer re-arm the badge debounce — the commit's clean report would land
   ~20 s after the *commit*, not after the push. Smallest, safest change — but it only removes the
   push-deferral; the baseline ~20 s post-commit lag remains.
2. **Lower `coalesce-ms` and run the recompute with `--no-optional-locks`**
   (`git --no-optional-locks status` does not take `index.lock`), removing the contention that forced
   20 s in the first place. This is the most principled fix — verify `--no-optional-locks` porcelain
   output is identical first.

A two-tier debounce (long window only while `.git/index.lock` exists, short ~1–2 s window otherwise)
is **not** a viable candidate: it gets the resolved bug's causality backwards. The contention was the
monitor's own `git status` *taking* `index.lock` (opportunistic index refresh) and the **commit**
failing on "File exists" — so checking that the lock is absent before firing status does nothing to
stop a commit that starts a moment later from colliding with the status-held lock, and a 1–2 s
window would fire status far more often than today's 20 s, making the collision *more* likely. A
short window is only safe once status stops taking the lock, i.e. combined with candidate 2's
`--no-optional-locks`.

Add regression coverage matched to the direction taken. Under candidate 2, assert a commit (with no
subsequent activity) flips the badge within a bound well under the current 20 s. "A push alone does
not re-arm the badge debounce" is assertable only under candidate 1's watch exclusion; under
candidate 2 a push's `.git/refs/remotes` write still re-arms the (now short) window — harmless, so
bound the post-push flip latency instead of asserting no re-arm.

## Fix

**Candidates 2 + 1, combined** — the principled lock-free recompute plus the cheap watch exclusion:

1. **`git status`/`git diff` now run with `--no-optional-locks`**
   (`GitStatusMonitor.settleFromGit`). The flag makes git skip the opportunistic index refresh, so
   neither read takes `.git/index.lock` — the recompute can no longer race a concurrent commit/push
   for it. Verified byte-identical porcelain/diff output against the unflagged commands. This removes
   the root cause that forced the 20 s window.
2. **The debounce quiet period drops from 20 s to 1.5 s**
   (`qits.workspace-daemon.git-status.coalesce-ms` default in `ControlSocket`). With the lock race
   gone the window is now only a short coalescing gate (collapse a commit's write burst into one
   non-flickering settle), not a lock-avoidance one. The badge flips ~1.5 s after the commit instead
   of ~20 s. The `max-wait-ms` cap stays 120 s.
3. **Remote-tracking and fetch bookkeeping are excluded from the watch**
   (`GitStatusMonitor.watchArgv`): `.git/refs/remotes`, `.git/FETCH_HEAD`, `.git/ORIG_HEAD` join the
   existing `.git/objects`/`.git/logs` exclusions — matched under the top-level `.git/` *and* under a
   submodule's own gitdir (`.git/modules/<name>/…`, via a `(modules/[^/]+/)*` hop). A push /
   auto-push / fetch's ordinary loose-ref writes no longer re-arm the badge debounce, so the deferral
   where a push appeared to *trigger* the flip is gone. (A periodic `packed-refs` rewrite can still
   re-arm, but that is harmless now the recompute is lock-free and the window short.) Local
   `refs/heads`, `index`, and `HEAD` stay watched, so a commit — and a pull/merge that advances the
   branch and rewrites work-tree files — is still observed.

A companion hardening lands with the shorter window: `settle` now **skips a blank `git status`
read** rather than reporting it. A clean tree's `--porcelain=v2 --branch` output always carries the
`# branch.*` headers, so blank output means the read itself failed (non-zero exit → `capture`
returns `""`), which `WorkspaceDescriber.parse` would otherwise read as *not-dirty* and flip the
badge falsely clean. The 20 s window practically guaranteed the read ran on a quiescent tree; the
1.5 s window can land it mid-operation, making that false-clean path reachable — so it is now guarded.

## Tests

`GitStatusMonitorTest` gains three cases (the existing marker/dedup + debounce-timing tests are
unaffected — they inject a settle counter and pass explicit timings, not the shipped defaults):

- `commitBurstFlipsWithinAShortBound` — a commit's event burst that then goes quiet collapses to
  exactly one settle, landing a short multiple of the quiet window later (well under the old 20 s).
- `aBurstAfterTheFirstSettleStillFlipsWithinTheShortWindow` — a later write (e.g. a push landing in
  the window) settles within the short window too, not +20 s: the push-deferral is gone.
- `watchArgvExcludesRemoteAndFetchBookkeeping` — compiles the `--exclude` alternation and asserts it
  matches the top-level `refs/remotes`/`FETCH_HEAD`/`ORIG_HEAD` paths while leaving `refs/heads`,
  `index`, and work-tree files watched.
- `watchArgvExcludesSubmoduleGitdirBookkeeping` — the same exclusion reaches a submodule's own gitdir
  (`.git/modules/<name>/…`, including nested), so a submodule sync doesn't re-arm the debounce.
- `blankStatusFromAFailedReadDoesNotFlipTheBadgeClean` — a blank (failed) `git status` read emits
  nothing and leaves the prior dirty report standing, instead of reporting a false clean.
