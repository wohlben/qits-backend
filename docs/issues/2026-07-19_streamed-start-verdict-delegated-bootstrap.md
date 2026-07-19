# Streamed Start reports `done ok` when it delegates its chain to a concurrent manual run

## Introduction

Fallout from the [workspace bootstrap commands](../features/2026-07-18_workspace-bootstrap-commands.md)
reentrancy design and the [technical-process log stream](../features/2026-07-18_technical-process-log-stream.md).
Related to the `WorkspaceBootstrapRunner` in-flight guard that lets an event-triggered chain yield to
an already-running manual run.

## Observed / suspected repro

1. A user triggers a **manual** "Run all" bootstrap on a workspace whose container is not running.
   `submitManual` takes the per-workspace in-flight guard, then `ensureContainer` fresh-provisions
   the container (process id `null` — a manual run owns no technical process).
2. Almost simultaneously the user triggers a **streamed Start** (`beginEnsureContainer`) for the same
   workspace, which registers technical process `X` and provisions.
3. One of the two provisions wins; the other's `ensureContainer` short-circuits on `isRunning`. The
   `WorkspaceContainerStarted(freshProvision=true, processId=X)` event reaches
   `WorkspaceBootstrapRunner.onContainerStarted`, which finds the guard already held by the manual
   run and takes the **yield branch**.
4. The yield branch cannot observe the manual run (its `WorkspaceReadyForDaemons` carries no process
   id), so to avoid hanging `X`'s SSE stream it settles `X`'s `bootstrap` segment `ok=true` and
   declares an empty daemon set → `X` ends **`done ok`**.
5. The manual chain then **fails**. No daemons start. But the streamed Start already reported green;
   the user only discovers the broken state by opening the Bootstrap tab.

## Current mitigation (this commit)

`onContainerStarted`'s yield branch now streams an explicit line ("A manually triggered bootstrap
run is already in flight and owns this chain — its outcome and the daemon phase are tracked on the
workspace Bootstrap tab.") before closing `X`. The Start's verdict still reflects only the provision
`X` actually watched; the delegated chain's real outcome lives on the workspace Bootstrap surface
(BOOTSTRAP hints over SSE), which does light its failed-warning indicator.

## Suggested real fix (deferred)

Correlate the delegated run back to process `X`: register `X` in a per-workspace hand-off slot in the
yield branch, and have the manual run (which knows `runChain`'s boolean result) settle that process
with the real verdict — `settleSegment("bootstrap", ok)` + `expectDaemons(...)` — instead of the
yield branch guessing `ok=true`. The tricky part is the async delivery race between the observer
registering `X` and the manual run finishing (see the analysis in `onContainerStarted`): the
registration must settle immediately if the manual run already completed, and both settle paths must
`remove` the slot atomically. The scenario is narrow (needs two near-simultaneous provisions of one
workspace), so it is documented here rather than fixed in the review-fix pass.

## Scope note

Independent of the other bootstrap review fixes in the same change (FK cascade, idle backstop, the
`onContainerStarted` catch-all + final BOOTSTRAP hint, throw-records-FAILED, orderIndex slot reuse),
which are applied.
