# `git status` monitor races a commit/push for `.git/index.lock`

## Introduction

Resolved bug in the daemon working-tree watcher. Related plans:

- **Fixes the watcher built in
  [daemon-driven working-tree status](../../epics/qits-workspace-daemon/features/2026-07-24_daemon-git-status-monitoring.md)**
  — the `GitStatusMonitor` `inotifywait` + `git status --porcelain=v2` loop.
- Same contention shape as the parent-qits-in-qits dev note (this workspace is itself supervised by a
  parent qits daemon running the very same monitor).

## Symptom

A `git commit` (and the daemon's own auto-`push`) inside a workspace container intermittently failed
with:

```
fatal: Unable to create '/workspace/.git/index.lock': File exists.
```

## Cause

`GitStatusMonitor` watches `/workspace` with `inotifywait` and, on a change, runs
`git status --porcelain=v2 --branch -uall`. `git status` refreshes and rewrites the index, taking
`.git/index.lock` — the same lock `git commit` needs.

The watch deliberately keeps `.git/index`/`HEAD`/`refs` in scope (excluding only `.git/objects` and
`.git/logs`) so commits are observed. But the debounce was a **fixed 250 ms leading window**: the
first event scheduled a recompute 250 ms out and subsequent events in that window were *absorbed
without extending it*. During a commit — a burst of writes under `.git/index`/`refs` spanning several
hundred ms — the window kept re-opening, so `git status` fired every ~250 ms straight into the
commit, colliding on `index.lock`.

## Fix

Turn the fixed window into a **trailing debounce** (`GitStatusMonitor.onRawChange`): every inotify
event now *cancels and re-arms* the timer, so the recompute runs only once the tree has been quiet
for `qits.workspace-daemon.git-status.coalesce-ms` — raised from 250 ms to **20 s**. A commit/push
burst keeps pushing the recompute out; `git status` lands after the burst releases `index.lock`, not
during it.

A `qits.workspace-daemon.git-status.max-wait-ms` cap (default 120 s) bounds the debounce so a
workspace under sustained churn (autosaving editor, watch-mode task) still refreshes its badge at a
ceiling instead of going silent — the cap is far longer than any commit burst, so it does not
reintroduce the contention. `<= 0` disables the ceiling (pure trailing debounce).

The git forks continue to run outside the debounce lock, so the recompute never blocks the reader
thread.

## Tests

`GitStatusMonitorTest` gains two timing tests driving the package-private `onRawChange` with an
injected settle counter (no real git tree):

- `rapidBurstCollapsesToOneSettleAfterQuiescence` — 50 back-to-back events yield exactly one
  recompute, fired only after the quiet period.
- `sustainedChurnStillSettlesViaTheMaxWaitCap` — unbroken 20 ms-spaced churn never lets the quiet
  period lapse, so the max-wait cap forces periodic settles.
