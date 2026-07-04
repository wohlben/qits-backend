# Container file access: the worktree file browser reads through `docker exec` (Phase 2)

## Introduction

With [workspace containers](workspace-containers.md) (Phase 1), a worktree's files live inside
its container — and the entire file-browser feature train reads worktree files from host paths
via `WorktreeFilesService`. This phase reroutes those reads through `docker exec` so the
browser shows the **actual live state** of the container's working tree, uncommitted changes
included.

The obvious cheaper alternative — a host-side mirror checkout fast-forwarded on every push —
was **rejected**: it can only ever show the last pushed state, and seeing actual, uncommitted
changes is the point of the file browser. The latency cost of exec-per-read is accepted for
now; mitigations are listed as deferred.

Related/dependent plans:

- **Phase 1 — [workspace-containers](workspace-containers.md)** (hard dependency): the
  container, `DockerExecutor`, and exec mechanics all come from there. Phase 3
  ([container-agent-sessions](container-agent-sessions.md)) is independent of this phase.
- Reroutes the read path under the
  [worktree file browser](../features/2026-07-02_worktree-file-browser.md) and everything
  layered on it: [framework-aware display](../features/2026-07-03_framework-aware-file-browser.md),
  [lazy directory exploration](../features/2026-07-03_lazy-directory-exploration.md),
  [smart file display](../features/2026-07-03_worktree-smart-file-display.md),
  [tree path compaction](../features/2026-07-03_worktree-tree-path-compaction.md), and the
  [ordered filter rules](../features/2026-07-03_worktree-filter-ordered-rules-and-ignorelists.md).
  All of those operate on the DTOs `WorktreeFilesService` produces — the goal is that none of
  them notice the change.
- The [worktree chat dialog](../features/2026-07-04_worktree-chat-dialog.md) sits on the same
  detail route; a fast file browser next to the chat is why latency matters at all.

## Design

`WorktreeFilesService` (and `GitignoreLazyDirectoryStrategy`) currently walk `java.nio.file`
paths. The primitives they actually need are small: list a directory, stat entries, read a
file, read `.gitignore`s, and overlay git status. Each becomes one exec:

- **Directory listing** — one `docker exec` per lazily-loaded directory, running a single
  shell line that emits `type\tsize\tname` records (`find <dir> -maxdepth 1 -printf …`). The
  UI already lazy-loads per directory, so requests map 1:1 onto execs — no fan-out.
- **Git status overlay** — one `git status --porcelain -z` exec per tree refresh, applied to
  the listing host-side.
- **File content** — `docker exec cat` streaming raw bytes. No `-t`: a TTY would mangle
  binary content and line endings. Binary sniffing and size limits stay host-side, unchanged.
- **Gitignore semantics** — `GitignoreLazyDirectoryStrategy` fetches the relevant
  `.gitignore` files via the same content primitive; its logic is untouched.

The clean seam is an interface under `WorktreeFilesService`'s current path-walking internals
(a `WorktreeFileAccess` with `list/readFile/…`), implemented by exec. Controllers, DTOs,
mappers, and the whole frontend stay byte-identical.

## Latency, stated honestly

Every exec is a docker client round-trip — tens of milliseconds each, per directory expand and
per file open. That is visibly slower than host `Files.list`, and it is **accepted for now**
(explicit decision). If it starts to hurt, the escalation path is below, not a mirror.

## Explicitly deferred

- **Persistent in-container helper**: one long-lived exec'd process speaking line-delimited
  JSON over its stdin/stdout (the registry already owns exactly this shape of channel),
  serving list/read requests without per-request client startup. Build when latency
  measurably annoys.
- **Change push**: inotify-based events from the container driving live tree refreshes.
- **Write operations** from the browser — it is read-only today; keep it that way here.

## Open questions

- Does the exec transport preserve exact bytes for large/binary files under all docker
  versions (exec attach vs. TTY quirks), or should content reads go through
  `docker cp`/`git show` fallbacks past a size threshold?
- Cache invalidation: is per-request freshness fine (current behavior), or do repeated
  expand/collapse cycles warrant a short-lived listing cache?

## Testing sketch

- Unit: `WorktreeFileAccess` faked — existing `WorktreeFilesService` tests keep passing
  against the fake (the "nothing above notices" guarantee).
- Exec-output parsing: listing lines with spaces/unicode in names, symlinks, empty dirs.
- Real-docker IT (behind `skipITs`): containerized fixture repo → tree listing matches the
  known fixture, uncommitted edit made via exec appears in the browser with its status flag,
  binary file round-trips byte-identical.
