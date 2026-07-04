# Container file access: the worktree file browser reads through `docker exec` (Phase 2)

## Introduction

With [workspace containers](2026-07-04_workspace-containers.md) (Phase 1) a worktree's working tree
lives inside its container under `/workspace`, not on the host — but `WorktreeFilesService` still read
host paths via `java.nio.file`. For a real container-backed worktree that host path doesn't exist, so
the browser only worked in tests (where `FakeContainerRuntime` happens to materialize the container as
a host clone at the old path). This phase reroutes every browser read through `docker exec` so the
tree shows the container's **actual live working tree**, uncommitted changes included. The
exec-per-read latency is an accepted cost; a host mirror was rejected because it can only ever show the
last pushed state.

Related/dependent plans:

- **Phase 1 — [workspace-containers](2026-07-04_workspace-containers.md)** (hard dependency): the
  container, `DockerExecutor`/`ContainerRuntime`, and exec mechanics all come from there. Phase 3
  ([container-agent-sessions](../feature-ideas/container-agent-sessions.md)) is independent of this
  phase.
- Reroutes the read path under the [worktree file browser](2026-07-02_worktree-file-browser.md) and
  everything layered on it: [framework-aware display](2026-07-03_framework-aware-file-browser.md),
  [lazy directory exploration](2026-07-03_lazy-directory-exploration.md),
  [smart file display](2026-07-03_worktree-smart-file-display.md),
  [tree path compaction](2026-07-03_worktree-tree-path-compaction.md), and the
  [ordered filter rules](2026-07-03_worktree-filter-ordered-rules-and-ignorelists.md). All operate on
  the DTOs `WorktreeFilesService` produces — the goal was that none of them notice the change, and
  none do.
- The [worktree chat dialog](2026-07-04_worktree-chat-dialog.md) sits on the same detail route.

## What was built

### The `WorktreeFileAccess` seam (`domain`)

A new interface `repository.control.WorktreeFileAccess` owns the small set of read-only primitives the
browser needs, decoupled from *where* the files live:

- `git(repoId, worktreeId, args…)` — a git subcommand in the worktree root (`ls-files` for the eager
  list and the lazy-directory boundary).
- `stat(repoId, worktreeId, path)` — type (`FILE`/`DIRECTORY`/`SYMLINK`/`OTHER`/`MISSING`, symlinks
  **unfollowed**) + byte size of a single path.
- `list(repoId, worktreeId, dir)` — a directory one level deep, each subdirectory carrying its
  immediate `childCount`.
- `childCount(repoId, worktreeId, dir)` — the cheap immediate-child count.
- `read(repoId, worktreeId, path)` — a regular file's **raw bytes**.

The single production impl `ContainerFileAccess` (`@ApplicationScoped`) runs these through
`ContainerRuntime` — the sibling of `WorktreeService.containerGit`. Every command runs with workdir
`/workspace` and worktree-relative paths, prefixed `./` when handed to `find` so a leading-dash
filename can't be misread as a flag:

- **Directory listing** is one `find ./<dir> -maxdepth 2 -mindepth 1 -printf '%d\t%y\t%s\t%p\n'` exec;
  a pure static `parseFindListing` groups the depth-1 entries and counts each subdir's depth-2
  grandchildren — so expanding a directory is a single exec, no per-subdir fan-out. `-P` (find's
  default) never follows a symlinked directory, so it can't leak an outside tree.
- **Stat** is `find ./<path> -maxdepth 0 -printf '%y\t%s\n'`; a non-zero exit → `MISSING`.
- **File content** bypasses `ContainerRuntime.exec`'s `String` result (which line-joins and
  re-encodes, corrupting binary bytes and trailing newlines) — it builds a `ProcessBuilder` from
  `execArgv` + `cat -- <path>`, discards stderr, and reads the process's raw stdout. No TTY, so bytes
  survive exactly.

### `WorktreeFilesService` → pure orchestration + policy (`domain`)

The service no longer touches `java.nio.file` or `GitExecutor`. It injects `WorktreeFileAccess` and
keeps only orchestration, sorting and path-safety **policy**; the DTOs (`Listing`, `LazyDir`,
`WorktreeFileContentDto`), the controller, mappers and the whole frontend are byte-identical.

- **Validation** now requires the repo row, an active worktree row, and the worktree's **container to
  exist** (replacing the old on-disk existence check).
- **Path safety** is a lexical guard (`requireSafeRelativePath`: reject absolute paths, any `..`
  segment, NUL) plus **outright symlink rejection** — a committed in-repo symlink is never
  dereferenced (`SYMLINK` → 400), since in-container we can't cheaply prove its target stays inside
  `/workspace` and cloned repos are untrusted. (The old host code followed in-tree symlinks; no test
  relied on that and rejection is strictly safer.)
- `MAX_CONTENT_BYTES` (2 MB) and the NUL-byte binary heuristic stay host-side, applied to the bytes
  `read` returns; the size cap is enforced from `stat` before any content is streamed.

### `LazyDirectoryStrategy` (`domain`)

The pluggable seam's contract moved from host-oriented `lazyDirectories(Path, GitExecutor)` to
`lazyDirectories(repoId, worktreeId, WorktreeFileAccess)`. The default `GitignoreLazyDirectoryStrategy`
becomes one `access.git(… "ls-files","--others","--ignored","--exclude-standard","--directory",
"--no-empty-directory")` call; its trailing-slash filter/strip/sort logic is untouched.

## Explicitly deferred (unchanged from the idea)

- **No git-status overlay.** The idea doc floated a `git status --porcelain` overlay, but the DTOs
  carry no status field and the frontend renders none — adding one would break the byte-identical
  guarantee, so it stays out of scope.
- **Persistent in-container helper** (one long-lived exec speaking line-delimited JSON) — build when
  exec latency measurably annoys.
- **Change push** (inotify-driven live tree refreshes) and **write operations** from the browser (it
  stays read-only).
- **No caching** — per-request freshness, as before.

## Testing

- **`WorktreeControllerTest` (26 cases) passes unchanged** — the "nothing above notices" proof. It
  creates the main worktree via `FakeContainerRuntime` (a host clone at the worktree path) and writes
  files there; routing through `access` now runs real `find`/`cat`/`git` against that clone. Every
  case still holds: untracked file listed, text content (trailing newline included), NUL→binary,
  `..`→400, symlink-escape→400, missing→404, gitignored lazy stub + `childCount`, one-level lazy
  expand, non-directory→400, `.git`→400.
- **`ContainerFileAccessTest`** unit-tests the pure `parseFindListing`: leading-`./` stripping,
  depth-2 child counting, names with spaces/unicode, symlink/other types, empty dirs, malformed lines.
- **`GitignoreLazyDirectoryStrategyTest`** updated to the new signature via a tiny in-test
  `WorktreeFileAccess` that shells real git in a `@TempDir`.
- **`ContainerFileBrowserIT`** (extended, `@Tag("extended")`, self-skips without docker) — verified
  against a **real container + the `qits/workspace` image**: `stat`/`list`/`childCount`/`read`/`git`
  match the working tree, a binary file with an embedded NUL round-trips byte-identical, and an
  uncommitted exec-made edit is visible on the next read.
- Full `./mvnw clean test` green across all modules; `docs/openapi.yml` regenerated identically (DTOs
  unchanged).
