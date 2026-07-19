# Streaming GitExecutor.exec: live per-line git output (and an idle-reaper that can't false-fail)

## Introduction

The [streamed repository pull](../../qits-technical-processes/features/2026-07-19_repository-pull-technical-process.md) delivers
each git command's output to its segment **post-hoc**: `GitExecutor.exec` captures the whole blob
and returns it, and only then does `RepositoryService.streamLines` split it into lines and
`appendLine` them. That is the `FakeContainerRuntime` fidelity level, and the pull feature adopted
it deliberately — the segment-open frame already provides the live "now fetching X" signal and
per-repo fetch output is small. But it has two edges the pull feature flagged as deferred:

- **No live progress on a slow fetch.** A large/slow `git fetch` shows nothing in its segment until
  it completes; the user watches an open-but-empty segment with no per-line progress.
- **The idle reaper can false-fail a long fetch.** `TechnicalProcessRegistry`'s idle backstop
  (`qits.process.max-idle-ms`, default 15 min) force-finishes a process that emits **no frame** for
  that long. Because a fetch emits nothing until it returns, a genuinely slow single fetch that
  exceeds the idle window is force-finished to `done failed` while `pullRepository` keeps running —
  a spurious failure.

This feature adds the streaming `exec` overload the pull feature explicitly left as "an optional
later refinement for very slow fetches," mirroring the one `ContainerRuntime` already has. Streaming
per-line output fixes both edges at once: the user sees fetch progress live, and every streamed line
resets the process's activity clock so the idle reaper only trips on a *truly* stalled process.

Related/dependent plans:

- **Modifies the already-shipped**
  [repository-pull-technical-process](../../qits-technical-processes/features/2026-07-19_repository-pull-technical-process.md):
  `RepositoryService.pullRepository` swaps its post-hoc `streamLines(fetchOutput)` for a streaming
  `onLine` tap.
- **Copies the container-side precedent** — `ContainerRuntime.exec(..., Consumer<String> onLine, …)`
  and `WorkspaceService.containerGit(..., onLine, …)` from the
  [technical-process log stream](../../qits-technical-processes/features/2026-07-18_technical-process-log-stream.md), which
  already stream a container `git clone` into its segment via `SegmentLineSink`.
- **Hardens the reaper defined in** that same feature — the idle-window backstop stays, but streamed
  activity keeps a legitimately long-but-active pull from tripping it.

## What exists today (the code being changed)

- `GitExecutor.exec(File cwd, String... command)` runs a `ProcessBuilder` with
  `redirectErrorStream(true)`, drains via `reader.lines().collect(joining("\n"))`, and returns the
  whole `String` only after `waitFor()`. There is **no** `Consumer<String>` overload — the host git
  has no per-line tap (unlike `ContainerRuntime`).
- `RepositoryService.streamLines(process, segment, output)` splits a returned blob and appends each
  line — the post-hoc delivery this feature replaces on the fetch path.
- `SegmentLineSink` already frames chunked output into per-line `appendLine` calls (built for the
  container git tap); the host tap reuses it.
- `TechnicalProcessRegistry.reapIfIdle` re-arms while `millisSinceLastActivity()` stays under the
  window and force-finishes only past it; `broadcast()` stamps `lastActivityMillis` on every frame.

## Design

- Add `GitExecutor.exec(File cwd, Consumer<String> onLine, String... command)` (and an
  `execAllowNonZero` sibling) that reads the merged stdout/stderr **line by line**, calling `onLine`
  as each line arrives, while still accumulating and returning the full output (so existing callers
  and the non-zero-exit error message are unchanged). Route it through `SegmentLineSink` for
  `\r`-stripping and partial-line framing, matching the container tap.
- In `pullRepository`, pass `onLine = line -> process.appendLine(segmentName, line)` to the `git
  fetch` call (guarded to a no-op when `process`/`segmentName` is null, so the synchronous callers
  are untouched). The rest of the verdict/config lines stay post-hoc (they are single lines).
- No registry change is required — streamed lines already stamp `lastActivityMillis`, so a live
  fetch keeps the reaper at bay; the false-fail edge closes as a consequence.
- `FakeContainerRuntime`/host-fake tests keep post-hoc delivery for the paths that don't stream, as
  the container tap does.

## Costs and risks

- Line-buffered reading of a merged stdout/stderr stream can interleave progress and error lines;
  acceptable for a log view (git already writes progress to stderr).
- A partial final line with no trailing newline must still be flushed (the `SegmentLineSink`
  contract) so the last line isn't dropped.

## Testing sketch

- **`GitExecutor` (`@QuarkusTest`):** the streaming overload invokes `onLine` incrementally during a
  command (assert via a command that emits several lines) and returns the same full output as the
  blocking `exec`; a non-zero exit still throws with the captured output.
- **Pull:** the fetch segment receives incremental `line` frames (not one batch after completion).
- **Reaper:** a process that streams a line just under the idle window on each tick is **not**
  force-finished, whereas a genuinely silent one past the window still is.
