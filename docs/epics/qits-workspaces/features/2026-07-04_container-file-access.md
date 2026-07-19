# Container file access: the workspace file browser reads through `docker exec` (Phase 2)

## Introduction

With [workspace containers](2026-07-04_workspace-containers.md) (Phase 1) a workspace's working tree
lives inside its container under `/workspace`, not on the host — but `WorkspaceFilesService` still read
host paths via `java.nio.file`. For a real container-backed workspace that host path doesn't exist, so
the browser only worked in tests (where `FakeContainerRuntime` happens to materialize the container as
a host clone at the old path). This phase reroutes every browser read through `docker exec` so the
tree shows the container's **actual live working tree**, uncommitted changes included. The
exec-per-read latency is an accepted cost; a host mirror was rejected because it can only ever show the
last pushed state.

Related/dependent plans:

- **Phase 1 — [workspace-containers](2026-07-04_workspace-containers.md)** (hard dependency): the
  container, `DockerExecutor`/`ContainerRuntime`, and exec mechanics all come from there. Phase 3
  ([container-agent-sessions](../../qits-coding-agents/features/2026-07-04_container-agent-sessions.md)) is independent of this
  phase.
- Reroutes the read path under the [workspace file browser](../../qits-workspace-detail/features/2026-07-02_workspace-file-browser.md) and
  everything layered on it: [framework-aware display](../../qits-workspace-detail/features/2026-07-03_framework-aware-file-browser.md),
  [lazy directory exploration](../../qits-workspace-detail/features/2026-07-03_lazy-directory-exploration.md),
  [smart file display](../../qits-workspace-detail/features/2026-07-03_workspace-smart-file-display.md),
  [tree path compaction](../../qits-workspace-detail/features/2026-07-03_workspace-tree-path-compaction.md), and the
  [ordered filter rules](../../qits-workspace-detail/features/2026-07-03_workspace-filter-ordered-rules-and-ignorelists.md). All operate on
  the DTOs `WorkspaceFilesService` produces — the goal was that none of them notice the change, and
  none do.
- The [workspace chat dialog](../../qits-workspace-detail/features/2026-07-04_workspace-chat-dialog.md) sits on the same detail route.

## What was built

### The `WorkspaceFileAccess` seam (`domain`)

A new interface `repository.control.WorkspaceFileAccess` owns the small set of read-only primitives the
browser needs, decoupled from *where* the files live:

- `git(repoId, workspaceId, args…)` — a git subcommand in the workspace root (`ls-files` for the eager
  list and the lazy-directory boundary).
- `stat(repoId, workspaceId, path)` — type (`FILE`/`DIRECTORY`/`SYMLINK`/`OTHER`/`MISSING`, symlinks
  **unfollowed**) + byte size of a single path.
- `list(repoId, workspaceId, dir)` — a directory one level deep, each subdirectory carrying its
  immediate `childCount`.
- `childCount(repoId, workspaceId, dir)` — the cheap immediate-child count.
- `read(repoId, workspaceId, path)` — a regular file's **raw bytes**.

The single production impl `ContainerFileAccess` (`@ApplicationScoped`) runs these through
`ContainerRuntime` — the sibling of `WorkspaceService.containerGit`. Every command runs with workdir
`/workspace` and workspace-relative paths, prefixed `./` when handed to `find` so a leading-dash
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

### `WorkspaceFilesService` → pure orchestration + policy (`domain`)

The service no longer touches `java.nio.file` or `GitExecutor`. It injects `WorkspaceFileAccess` and
keeps only orchestration, sorting and path-safety **policy**; the DTOs (`Listing`, `LazyDir`,
`WorkspaceFileContentDto`), the controller, mappers and the whole frontend are byte-identical.

- **Validation** now requires the repo row, an active workspace row, and the workspace's **container to
  exist** (replacing the old on-disk existence check).
- **Path safety** is three layers: a lexical guard (`requireSafeRelativePath`: reject absolute paths,
  any `..` segment, NUL); outright rejection of a **final-segment** symlink via the `stat` lstat
  (`SYMLINK` → 400); and a **full-path containment** check (`resolvesInsideRoot`) that `realpath -e`s
  the whole path — following *every* segment — and rejects it unless it still resolves under the
  workspace root. That last layer is essential: the lstat only vets the final component, but an
  **intermediate** symlinked directory (`linkdir/ -> /etc` in `linkdir/passwd`) is transparently
  followed by the kernel during path resolution, so without it `find`/`cat` would escape the workspace.
  It compares against the *resolved* root (not a literal `/workspace`) so it stays correct under the
  test fake, where the container is a host clone at a different path. (The old host code got this from
  `toRealPath()`; the container reimplementation initially regressed it — restored here, caught by a
  security review.)
- `MAX_CONTENT_BYTES` (2 MB) and the NUL-byte binary heuristic stay host-side, applied to the bytes
  `read` returns; the size cap is enforced from `stat` before any content is streamed.

### `LazyDirectoryStrategy` (`domain`)

The pluggable seam's contract moved from host-oriented `lazyDirectories(Path, GitExecutor)` to
`lazyDirectories(repoId, workspaceId, WorkspaceFileAccess)`. The default `GitignoreLazyDirectoryStrategy`
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

- **`WorkspaceControllerTest` (26 cases) passes unchanged** — the "nothing above notices" proof. It
  creates the main workspace via `FakeContainerRuntime` (a host clone at the workspace path) and writes
  files there; routing through `access` now runs real `find`/`cat`/`git` against that clone. Every
  case still holds: untracked file listed, text content (trailing newline included), NUL→binary,
  `..`→400, symlink-escape→400, missing→404, gitignored lazy stub + `childCount`, one-level lazy
  expand, non-directory→400, `.git`→400.
- **`ContainerFileAccessTest`** unit-tests the pure `parseFindListing`: leading-`./` stripping,
  depth-2 child counting, names with spaces/unicode, symlink/other types, empty dirs, malformed lines.
- **`GitignoreLazyDirectoryStrategyTest`** updated to the new signature via a tiny in-test
  `WorkspaceFileAccess` that shells real git in a `@TempDir`.
- **`ContainerFileBrowserIT`** (extended, `@Tag("extended")`, self-skips without docker) — verified
  against a **real container + the `qits/workspace` image**: `stat`/`list`/`childCount`/`read`/`git`
  match the working tree, a binary file with an embedded NUL round-trips byte-identical, and an
  uncommitted exec-made edit is visible on the next read.
- Full `./mvnw clean test` green across all modules; `docs/openapi.yml` regenerated identically (DTOs
  unchanged).
